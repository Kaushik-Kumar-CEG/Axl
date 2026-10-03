// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";

import type {
  ActivityContext,
  ActivityFrame,
  ActivityInput,
  ActivityStorage,
  ActivityStoredValue,
  JsonValue,
  TerminalActivityInstance,
} from "@axl/extension-api";

import {
  createNonogram,
  nonogramActivity,
  nonogramSolution,
  nonogramTerminalSize,
  parseNonogramSave,
} from "../src/index.ts";

class MemoryStorage implements ActivityStorage {
  stored: ActivityStoredValue | undefined;
  read() {
    return Promise.resolve(this.stored);
  }
  write(expected: number | null, schemaVersion: number, value: JsonValue) {
    assert.equal(this.stored?.revision ?? null, expected);
    this.stored = { revision: (this.stored?.revision ?? 0) + 1, schemaVersion, value };
    return Promise.resolve(this.stored);
  }
  reset() {
    this.stored = undefined;
    return Promise.resolve();
  }
}

const context = (storage?: MemoryStorage, textOnly = false): ActivityContext => ({
  signal: new AbortController().signal,
  now: () => 0,
  status: () => ({
    operation: "idle",
    activeToolCount: 0,
    queuedInput: { steer: 0, followUp: 0, interrupt: 0 },
  }),
  presentation: () => ({ reducedMotion: true, textOnly }),
  invalidate: () => undefined,
  schedule: () => () => undefined,
  ...(storage === undefined ? {} : { storage }),
});

const key = (name: string): ActivityInput => ({
  type: "key",
  key: name,
  ctrl: false,
  alt: false,
  shift: false,
  repeat: false,
});
const text = (frame: ActivityFrame): string =>
  frame.lines.map((spans) => spans.map((span) => span.text).join("")).join("\n");
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function play(instance: TerminalActivityInstance, size: 5 | 10 | 15, seed: number): void {
  const state = createNonogram(size, seed);
  const solution = nonogramSolution(state.fixtureId);
  let at = 0;
  const goTo = (target: number): void => {
    while (Math.floor(at / size) < Math.floor(target / size)) {
      instance.handleInput(key("down"));
      at += size;
    }
    while (at % size < target % size) {
      instance.handleInput(key("right"));
      at += 1;
    }
    while (at % size > target % size) {
      instance.handleInput(key("left"));
      at -= 1;
    }
  };
  solution.forEach((cell, index) => {
    if (cell !== 1) return;
    goTo(index);
    instance.handleInput(key(" "));
  });
}

test("a puzzle renders clues and fills cells with the keyboard", () => {
  const instance = nonogramActivity({ size: 5, seed: () => 3 }).create(context());
  const state = createNonogram(5, 3);
  const need = nonogramTerminalSize(state);
  const frame = instance.render({ width: 80, height: 40 });
  assert.match(text(frame), /Nonogram · 5×5/);
  assert.ok(frame.lines.length <= 40);
  instance.handleInput(key(" "));
  assert.ok(
    instance
      .render({ width: 80, height: 40 })
      .lines.flat()
      .some((span) => span.background === "accent"),
  );
  assert.ok(need.width <= 30);
});

test("solving the picture is reported", () => {
  const instance = nonogramActivity({ size: 5, seed: () => 3 }).create(context());
  play(instance, 5, 3);
  assert.match(text(instance.render({ width: 80, height: 40 })), /SOLVED/);
});

test("text-only mode marks filled cells with symbols", () => {
  const instance = nonogramActivity({ size: 5, seed: () => 3 }).create(context(undefined, true));
  instance.handleInput(key(" "));
  assert.match(text(instance.render({ width: 80, height: 40 })), /\[#\]/);
});

test("a terminal that is too small says what the puzzle needs", () => {
  const instance = nonogramActivity({ size: 15, seed: () => 3 }).create(context());
  const need = nonogramTerminalSize(createNonogram(15, 3));
  assert.match(
    text(instance.render({ width: 30, height: 12 })),
    new RegExp(`${need.width}x${need.height}`),
  );
  assert.ok(need.width <= 80 && need.height <= 40);
});

test("progress saves and restores exactly", async () => {
  const storage = new MemoryStorage();
  const first = nonogramActivity({ seed: () => 5 }).create(context(storage));
  await settle();
  first.handleInput(key("enter"));
  await settle();
  first.handleInput(key(" "));
  first.handleInput(key("right"));
  first.handleInput(key("x"));
  await first.dispose();
  const saved = parseNonogramSave(storage.stored?.value as JsonValue);
  assert.equal(saved.state?.cells[0], 1);
  assert.equal(saved.state?.cells[1], 2);
  const second = nonogramActivity().create(context(storage));
  await settle();
  assert.match(text(second.render({ width: 80, height: 40 })), /Nonogram ·/);
});

test("a corrupt save is surfaced and can be erased", async () => {
  const storage = new MemoryStorage();
  storage.stored = { revision: 1, schemaVersion: 1, value: { version: 1 } };
  const instance = nonogramActivity().create(context(storage));
  await settle();
  assert.match(text(instance.render({ width: 80, height: 20 })), /CANNOT BE OPENED/);
  instance.handleInput(key("r"));
  await settle();
  assert.equal(storage.stored, undefined);
  assert.match(text(instance.render({ width: 80, height: 20 })), /NONOGRAM/);
});
