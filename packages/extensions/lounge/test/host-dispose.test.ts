// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";

import {
  type ActivityStorageAdapter,
  type ActivityStoredValue,
  TerminalExtensionHost,
} from "@axl/extension-api";

import { createLoungeExtension } from "../src/index.ts";

test("every activity disposes cleanly through the real host after rendering", async () => {
  const saved = new Map<string, ActivityStoredValue>();
  const storage: ActivityStorageAdapter = {
    async read(scope) {
      return saved.get(scope.activityId);
    },
    async write(scope, _expected, schemaVersion, value) {
      const stored = {
        revision: (saved.get(scope.activityId)?.revision ?? 0) + 1,
        schemaVersion,
        value,
      };
      saved.set(scope.activityId, stored);
      return stored;
    },
    async reset() {},
  };
  const host = new TerminalExtensionHost([createLoungeExtension()]);
  await host.activate();
  try {
    assert.ok(host.activities().length >= 5);
    for (const activity of host.activities()) {
      const instance = host.createActivity(activity.id, {
        now: () => performance.now(),
        schedule: (delayMs, callback) => {
          const timer = setTimeout(callback, delayMs);
          return () => clearTimeout(timer);
        },
        invalidate: () => undefined,
        status: () => ({
          operation: "idle",
          activeToolCount: 0,
          queuedInput: { steer: 0, followUp: 0, interrupt: 0 },
        }),
        presentation: () => ({ reducedMotion: true, textOnly: false }),
        storage,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      instance.render(instance.epoch, { width: 80, height: 30 });
      await instance.dispose();
    }
  } finally {
    await host.dispose();
  }
});
