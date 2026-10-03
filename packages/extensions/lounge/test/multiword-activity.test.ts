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
  createMultiword,
  multiwordActivity,
  multiwordTerminalLayout,
  parseMultiwordSave,
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

const key = (
  name: string,
  extra: Partial<ActivityInput & { type: "key" }> = {},
): ActivityInput => ({
  type: "key",
  key: name,
  ctrl: false,
  alt: false,
  shift: false,
  repeat: false,
  ...extra,
});
const text = (frame: ActivityFrame): string =>
  frame.lines.map((spans) => spans.map((span) => span.text).join("")).join("\n");
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function typeWord(instance: TerminalActivityInstance, word: string): void {
  for (const letter of word) instance.handleInput(key(letter));
  instance.handleInput(key("enter"));
}

const selection = { kind: "practice", algorithmVersion: 1, boards: 4, seed: 11 } as const;

test("a started game renders every board with filled evidence tiles", () => {
  const instance = multiwordActivity({ selection }).create(context());
  const answer = createMultiword(selection).answers[0] as string;
  typeWord(instance, answer);
  const frame = instance.render({ width: 80, height: 40 });
  assert.match(text(frame), /Solved 1\/4/);
  const spans = frame.lines.flat();
  assert.ok(spans.some((span) => span.background === "success"));
  assert.ok(spans.some((span) => span.text.startsWith(answer[0]?.toUpperCase() as string)));
});

test("text-only tiles carry evidence in symbols", () => {
  const instance = multiwordActivity({ selection }).create(context(undefined, true));
  const answer = createMultiword(selection).answers[0] as string;
  typeWord(instance, answer);
  assert.match(text(instance.render({ width: 80, height: 40 })), /✓/);
});

test("the layout falls back to fewer columns and then reports the size it needs", () => {
  assert.equal(multiwordTerminalLayout({ width: 80, height: 40 }, 8, 13).columns, 4);
  assert.equal(multiwordTerminalLayout({ width: 35, height: 40 }, 8, 13).columns, 2);
  const tooSmall = multiwordTerminalLayout({ width: 30, height: 14 }, 8, 13);
  assert.equal(tooSmall.fits, false);
  const instance = multiwordActivity({
    selection: { ...selection, boards: 8 },
  }).create(context());
  assert.match(text(instance.render({ width: 30, height: 14 })), /need \d+x\d+ cells/);
});

test("invalid guesses show a message and are not saved as guesses", () => {
  const instance = multiwordActivity({ selection }).create(context());
  typeWord(instance, "zzzzz");
  assert.match(text(instance.render({ width: 80, height: 40 })), /Not in the accepted word list/);
});

test("progress saves, restores, and replays exactly", async () => {
  const storage = new MemoryStorage();
  const first = multiwordActivity().create(context(storage));
  await settle();
  first.handleInput(key("enter"));
  first.handleInput(key("enter"));
  first.handleInput(key("enter"));
  typeWord(first, "crane");
  await first.dispose();
  const saved = parseMultiwordSave(storage.stored?.value as JsonValue);
  assert.equal(saved.state?.guesses.length, 1);
  const second = multiwordActivity().create(context(storage));
  await settle();
  assert.match(text(second.render({ width: 80, height: 40 })), /Guess 2\//);
});

test("a corrupt save is surfaced and can be erased", async () => {
  const storage = new MemoryStorage();
  storage.stored = { revision: 1, schemaVersion: 1, value: { version: 1 } };
  const instance = multiwordActivity().create(context(storage));
  await settle();
  assert.match(text(instance.render({ width: 80, height: 20 })), /CANNOT BE OPENED/);
  instance.handleInput(key("r"));
  await settle();
  assert.equal(storage.stored, undefined);
  assert.match(text(instance.render({ width: 80, height: 20 })), /MULTIWORD/);
});
