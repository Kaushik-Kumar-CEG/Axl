// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";

import {
  type ActivityStorageAdapter,
  ActivityStorageError,
  type ActivityStoredValue,
  type JsonValue,
} from "@axl/extension-api";

import { type SlotNotice, SaveSlot } from "../src/lounge/save-slot.ts";

function fakeStorage(): ActivityStorageAdapter & { stored?: ActivityStoredValue } {
  const adapter: ActivityStorageAdapter & { stored?: ActivityStoredValue } = {
    async read() {
      return adapter.stored;
    },
    async write(_scope, expected, schemaVersion, value) {
      const current = adapter.stored?.revision ?? null;
      if (current !== expected) throw new ActivityStorageError("conflict", "stale");
      adapter.stored = { revision: (current ?? 0) + 1, schemaVersion, value };
      return adapter.stored;
    },
    async reset() {
      adapter.stored = undefined;
    },
  };
  return adapter;
}

const scope = { extensionId: "axl.lounge", activityId: "test" };

test("writes are ordered and the last value wins", async () => {
  const storage = fakeStorage();
  const slot = new SaveSlot({ storage, scope, schemaVersion: 1, onNotice: () => {} });
  await slot.load();
  slot.save({ n: 1 });
  slot.save({ n: 2 });
  slot.save({ n: 3 });
  slot.save({ n: 4 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await new SaveSlot({ storage, scope, schemaVersion: 1, onNotice: () => {} }).load();
  assert.deepEqual(storage.stored?.value, { n: 4 });
});

test("a conflict keeps the newer save and merges only important values", async () => {
  const storage = fakeStorage();
  const notices: (SlotNotice | undefined)[] = [];
  const slot = new SaveSlot({
    storage,
    scope,
    schemaVersion: 1,
    merge: (latest, mine) => ({
      ...(latest as object),
      done: [...(latest as { done: string[] }).done, ...(mine as { done: string[] }).done],
    }),
    onNotice: (notice) => notices.push(notice),
  });
  assert.equal(await slot.load(), undefined);
  storage.stored = { revision: 1, schemaVersion: 1, value: { board: "theirs", done: ["a"] } };
  slot.save({ board: "mine", done: ["b"] }, true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(storage.stored?.value, { board: "theirs", done: ["a", "b"] });
  assert.equal(notices.at(-1)?.kind, "conflict");
  slot.save({ board: "later", done: [] });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((storage.stored?.value as { board: string }).board, "theirs");
});

test("a future schema fails loudly", async () => {
  const storage = fakeStorage();
  storage.stored = { revision: 1, schemaVersion: 9, value: {} as JsonValue };
  const slot = new SaveSlot({ storage, scope, schemaVersion: 1, onNotice: () => {} });
  await assert.rejects(slot.load(), { code: "future-version" });
});
