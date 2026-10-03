// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";

import { multiwordLayout } from "../src/lounge/multiword-layout.ts";

test("a wide area puts octet boards in a row of four", () => {
  const layout = multiwordLayout(700, 560, 8, 13);
  assert.equal(layout.columns, 4);
  assert.ok(layout.tile >= 12 && layout.tile <= 44);
});

test("a tall narrow area uses fewer columns", () => {
  assert.ok(multiwordLayout(300, 800, 8, 13).columns <= 2);
});

test("small areas keep a readable minimum tile instead of shrinking further", () => {
  assert.equal(multiwordLayout(200, 100, 8, 13).tile, 12);
});

test("two boards use large tiles", () => {
  assert.equal(multiwordLayout(700, 560, 2, 7).tile, 44);
});

test("zero boards fail loudly", () => {
  assert.throws(() => multiwordLayout(700, 560, 0, 7), RangeError);
});
