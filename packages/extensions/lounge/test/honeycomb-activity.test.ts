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
  createHoneycomb,
  honeycombActivity,
  honeycombAnswers,
  parseHoneycombSave,
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

const context = (storage?: MemoryStorage): ActivityContext => ({
  signal: new AbortController().signal,
  now: () => 0,
  status: () => ({
    operation: "idle",
    activeToolCount: 0,
    queuedInput: { steer: 0, followUp: 0, interrupt: 0 },
  }),
  presentation: () => ({ reducedMotion: true, textOnly: false }),
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

function typeWord(instance: TerminalActivityInstance, word: string): void {
  for (const letter of word) instance.handleInput(key(letter));
  instance.handleInput(key("enter"));
}

const selection = { kind: "practice", algorithmVersion: 1, seed: 21 } as const;

test("a found word scores and lists, and the center letter is highlighted", () => {
  const instance = honeycombActivity({ selection }).create(context());
  const state = createHoneycomb(selection);
  const word = honeycombAnswers(state.letters, state.center)[0] as string;
  typeWord(instance, word);
  const frame = instance.render({ width: 60, height: 20 });
  assert.match(text(frame), new RegExp(`1 of ${state.wordCount} words`));
  assert.ok(text(frame).includes(word));
  assert.ok(frame.lines.flat().some((span) => span.background === "accent"));
});

test("rejections explain themselves and are not saved as words", () => {
  const instance = honeycombActivity({ selection }).create(context());
  typeWord(instance, "abc");
  assert.match(text(instance.render({ width: 60, height: 20 })), /four letters|not in the hive/);
});

test("a short terminal keeps the help row", () => {
  const instance = honeycombActivity({ selection }).create(context());
  const state = createHoneycomb(selection);
  for (const word of honeycombAnswers(state.letters, state.center).slice(0, 25))
    typeWord(instance, word);
  const frame = instance.render({ width: 40, height: 12 });
  assert.ok(frame.lines.length <= 12);
  assert.match(text(frame), /Ctrl\+P menu/);
});

test("progress saves and restores exactly", async () => {
  const storage = new MemoryStorage();
  const first = honeycombActivity().create(context(storage));
  await settle();
  first.handleInput(key("enter"));
  await settle();
  const state = createHoneycomb(
    parseHoneycombSave(storage.stored?.value as JsonValue).state?.selection ?? selection,
  );
  const word = honeycombAnswers(state.letters, state.center)[0] as string;
  typeWord(first, word);
  await first.dispose();
  const saved = parseHoneycombSave(storage.stored?.value as JsonValue);
  assert.deepEqual(saved.state?.found, [word]);
  const second = honeycombActivity().create(context(storage));
  await settle();
  assert.match(text(second.render({ width: 60, height: 20 })), /1 of \d+ words/);
});

test("a corrupt save is surfaced and can be erased", async () => {
  const storage = new MemoryStorage();
  storage.stored = { revision: 1, schemaVersion: 1, value: { version: 1 } };
  const instance = honeycombActivity().create(context(storage));
  await settle();
  assert.match(text(instance.render({ width: 60, height: 20 })), /CANNOT BE OPENED/);
  instance.handleInput(key("r"));
  await settle();
  assert.equal(storage.stored, undefined);
  assert.match(text(instance.render({ width: 60, height: 20 })), /HONEYCOMB/);
});
