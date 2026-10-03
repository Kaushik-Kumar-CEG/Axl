// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmptyNonogramSave,
  createNonogram,
  mergeNonogramSolved,
  NONOGRAM_FIXTURES,
  NonogramSaveError,
  type NonogramState,
  nonogramClues,
  nonogramLineDone,
  nonogramRuns,
  nonogramSaveJson,
  nonogramSolution,
  parseNonogramSave,
  reduceNonogram,
  selectNonogramFixture,
  solveNonogramByLines,
  updateNonogramSave,
} from "../src/index.ts";

function solve(state: NonogramState): NonogramState {
  const solution = nonogramSolution(state.fixtureId);
  const filled = solution.flatMap((cell, index) => (cell === 1 ? [index] : []));
  return reduceNonogram(state, { type: "paint", indices: filled, value: 1 });
}

test("runs read filled cells and ignore the rest", () => {
  assert.deepEqual(nonogramRuns([1, 1, 0, 1, 0, 0, 1, 1, 1]), [2, 1, 3]);
  assert.deepEqual(nonogramRuns([0, 0]), []);
});

test("every fixture solves by line logic alone and matches its clues", () => {
  assert.equal(NONOGRAM_FIXTURES.length, 80);
  for (const fixture of NONOGRAM_FIXTURES) {
    const { rows, columns } = nonogramClues(fixture.id);
    const result = solveNonogramByLines(rows, columns);
    assert.equal(result.solved, true, fixture.id);
    assert.equal(
      result.cells.map((cell) => (cell === 1 ? "1" : "0")).join(""),
      fixture.solution,
      fixture.id,
    );
  }
});

test("the solver reports puzzles it cannot settle", () => {
  assert.equal(solveNonogramByLines([[1], [1]], [[1], [1]]).solved, false);
  assert.equal(solveNonogramByLines([[2], []], [[2], []]).solved, false);
});

test("selection is deterministic and prefers unsolved puzzles", () => {
  const a = selectNonogramFixture(10, 3);
  assert.equal(a.id, selectNonogramFixture(10, 3).id);
  assert.notEqual(selectNonogramFixture(10, 3, [a.id]).id, a.id);
  const all = NONOGRAM_FIXTURES.filter((fixture) => fixture.size === 5).map(({ id }) => id);
  assert.ok(all.includes(selectNonogramFixture(5, 1, all).id));
  assert.throws(() => selectNonogramFixture(5, 1.5), TypeError);
});

test("painting, marking, undo, and clearing behave as expected", () => {
  let state = createNonogram(5, 2);
  state = reduceNonogram(state, { type: "paint", indices: [0, 1], value: 1 });
  assert.deepEqual(state.cells.slice(0, 3), [1, 1, 0]);
  assert.equal(reduceNonogram(state, { type: "paint", indices: [0], value: 1 }), state);
  state = reduceNonogram(state, { type: "paint", indices: [2], value: 2 });
  state = reduceNonogram(state, { type: "undo" });
  assert.equal(state.cells[2], 0);
  state = reduceNonogram(state, { type: "paint", indices: [0, 1], value: 0 });
  assert.ok(state.cells.every((cell) => cell === 0));
  assert.throws(
    () => reduceNonogram(state, { type: "paint", indices: [99], value: 1 }),
    RangeError,
  );
});

test("a hint reveals one cell, locks it, and counts", () => {
  let state = createNonogram(5, 2);
  state = reduceNonogram(state, { type: "hint" });
  const index = state.hinted.indexOf(true);
  assert.ok(index >= 0);
  assert.equal(state.hintCount, 1);
  const locked = reduceNonogram(state, { type: "paint", indices: [index], value: 0 });
  assert.equal(locked, state);
  assert.equal(reduceNonogram(state, { type: "reset" }).cells[index], state.cells[index]);
});

test("filling the solution solves the puzzle and freezes the board", () => {
  const state = solve(createNonogram(10, 4));
  assert.equal(state.status, "solved");
  for (let line = 0; line < state.size; line += 1) {
    assert.equal(nonogramLineDone(state, "row", line), true);
    assert.equal(nonogramLineDone(state, "column", line), true);
  }
  assert.equal(reduceNonogram(state, { type: "undo" }), state);
});

test("saves restore exactly, track solved puzzles, and fail loudly when damaged", () => {
  let state = reduceNonogram(createNonogram(5, 7), { type: "paint", indices: [0, 1, 2], value: 1 });
  state = reduceNonogram(state, { type: "hint" });
  const prefs = { size: 5 } as const;
  const document = updateNonogramSave(createEmptyNonogramSave(), state, prefs);
  const restored = parseNonogramSave(nonogramSaveJson(document));
  assert.deepEqual(restored.state?.cells, state.cells);
  assert.deepEqual(restored.state?.hinted, state.hinted);
  assert.equal(restored.state?.hintCount, 1);

  const done = updateNonogramSave(document, solve(createNonogram(5, 7)), prefs);
  assert.equal(done.solved.length, 1);
  assert.equal(parseNonogramSave(nonogramSaveJson(done)).state?.status, "solved");
  assert.equal(mergeNonogramSolved(document, done).solved.length, 1);

  const broken = nonogramSaveJson(document) as { game: { cells: string } };
  broken.game.cells = "9".repeat(25);
  assert.throws(() => parseNonogramSave(broken as never), NonogramSaveError);
  assert.throws(() => parseNonogramSave({ version: 9 }), { code: "future-version" });
});

test("undoing after a hint keeps the hinted cell and the save still opens", () => {
  let state = reduceNonogram(createNonogram(5, 7), { type: "paint", indices: [0], value: 2 });
  state = reduceNonogram(state, { type: "hint" });
  const hinted = state.hinted.indexOf(true);
  const hintedValue = state.cells[hinted];
  state = reduceNonogram(state, { type: "undo" });
  assert.equal(state.cells[hinted], hintedValue);
  const document = updateNonogramSave(createEmptyNonogramSave(), state, { size: 5 });
  const restored = parseNonogramSave(nonogramSaveJson(document));
  assert.deepEqual(restored.state?.cells, state.cells);
});
