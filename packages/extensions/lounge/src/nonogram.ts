// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import {
  NONOGRAM_FIXTURE_SET_REVISION,
  NONOGRAM_FIXTURES,
  type NonogramFixture,
  type NonogramSize,
} from "./nonogram-fixtures.generated.ts";
import { nonogramRuns } from "./nonogram-solver.ts";

export const NONOGRAM_ALGORITHM_VERSION = 1;
export const NONOGRAM_MAX_UNDO = 128;
export const NONOGRAM_SIZES = Object.freeze([5, 10, 15] as const);
export {
  NONOGRAM_FIXTURE_SET_REVISION,
  NONOGRAM_FIXTURES,
  type NonogramFixture,
  type NonogramSize,
};

/** 0 unknown, 1 filled, 2 marked empty. */
export type NonogramCell = 0 | 1 | 2;
export type NonogramStatus = "active" | "solved";

export interface NonogramState {
  readonly fixtureSetRevision: typeof NONOGRAM_FIXTURE_SET_REVISION;
  readonly fixtureId: string;
  readonly size: NonogramSize;
  readonly cells: readonly NonogramCell[];
  /** Cells a hint revealed. They cannot be changed. */
  readonly hinted: readonly boolean[];
  readonly hintCount: number;
  readonly status: NonogramStatus;
  /** Earlier boards, newest last. Not saved. */
  readonly history: readonly (readonly NonogramCell[])[];
}

export type NonogramAction =
  | { readonly type: "paint"; readonly indices: readonly number[]; readonly value: NonogramCell }
  | { readonly type: "undo" }
  | { readonly type: "hint" }
  | { readonly type: "reset" }
  | {
      readonly type: "restart";
      readonly size: NonogramSize;
      readonly seed: number;
      readonly exclude?: readonly string[];
    };

function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function nonogramFixture(id: string): NonogramFixture {
  const fixture = NONOGRAM_FIXTURES.find((entry) => entry.id === id);
  if (fixture === undefined) throw new Error(`Unknown Nonogram fixture ${id}`);
  return fixture;
}

/** Picks a fixture of `size` from `seed`, preferring puzzles that are not in `exclude`. */
export function selectNonogramFixture(
  size: NonogramSize,
  seed: number,
  exclude: readonly string[] = [],
): NonogramFixture {
  if (!Number.isSafeInteger(seed)) throw new TypeError("Nonogram seed must be a safe integer");
  const sized = NONOGRAM_FIXTURES.filter((fixture) => fixture.size === size);
  if (sized.length === 0) throw new Error(`No Nonogram fixtures of size ${size}`);
  const fresh = sized.filter((fixture) => !exclude.includes(fixture.id));
  const pool = fresh.length === 0 ? sized : fresh;
  return pool[
    hash32(`nonogram:${NONOGRAM_FIXTURE_SET_REVISION}:${size}:${seed}`) % pool.length
  ] as NonogramFixture;
}

const clueCache = new Map<
  string,
  {
    readonly rows: readonly (readonly number[])[];
    readonly columns: readonly (readonly number[])[];
  }
>();

export function nonogramClues(fixtureId: string) {
  const cached = clueCache.get(fixtureId);
  if (cached !== undefined) return cached;
  const fixture = nonogramFixture(fixtureId);
  const size = fixture.size;
  const cells = [...fixture.solution].map(Number);
  const result = Object.freeze({
    rows: Object.freeze(
      Array.from({ length: size }, (_, row) =>
        nonogramRuns(cells.slice(row * size, row * size + size)),
      ),
    ),
    columns: Object.freeze(
      Array.from({ length: size }, (_, column) =>
        nonogramRuns(
          Array.from({ length: size }, (_, row) => cells[row * size + column] as number),
        ),
      ),
    ),
  });
  clueCache.set(fixtureId, result);
  return result;
}

export function nonogramSolution(fixtureId: string): readonly NonogramCell[] {
  return Object.freeze(
    [...nonogramFixture(fixtureId).solution].map((cell) => Number(cell) as NonogramCell),
  );
}

/** A line is done when its filled runs match its clue. It says nothing about the empty marks. */
export function nonogramLineDone(
  state: Pick<NonogramState, "size" | "cells" | "fixtureId">,
  axis: "row" | "column",
  index: number,
): boolean {
  const line = Array.from({ length: state.size }, (_, step) =>
    state.cells[axis === "row" ? index * state.size + step : step * state.size + index] === 1
      ? 1
      : 0,
  );
  const clue = (
    axis === "row" ? nonogramClues(state.fixtureId).rows : nonogramClues(state.fixtureId).columns
  )[index];
  const runs = nonogramRuns(line);
  return (
    clue !== undefined &&
    runs.length === clue.length &&
    runs.every((run, position) => run === clue[position])
  );
}

function isSolved(state: Pick<NonogramState, "size" | "cells" | "fixtureId">): boolean {
  for (let line = 0; line < state.size; line += 1)
    if (!nonogramLineDone(state, "row", line) || !nonogramLineDone(state, "column", line))
      return false;
  return true;
}

function freeze(state: NonogramState): NonogramState {
  return Object.freeze({
    ...state,
    cells: Object.freeze([...state.cells]),
    hinted: Object.freeze([...state.hinted]),
    history: Object.freeze(state.history.map((board) => Object.freeze([...board]))),
  });
}

export function createNonogram(
  size: NonogramSize = 5,
  seed = 1,
  exclude: readonly string[] = [],
): NonogramState {
  const fixture = selectNonogramFixture(size, seed, exclude);
  return restoreNonogram(fixture.id, Array(size * size).fill(0), Array(size * size).fill(false), 0);
}

/** Rebuilds a state from saved parts. Throws when they do not fit the fixture. */
export function restoreNonogram(
  fixtureId: string,
  cells: readonly number[],
  hinted: readonly boolean[],
  hintCount: number,
): NonogramState {
  const fixture = nonogramFixture(fixtureId);
  const count = fixture.size * fixture.size;
  if (cells.length !== count || hinted.length !== count)
    throw new RangeError("Nonogram board does not match its puzzle");
  if (!cells.every((cell) => cell === 0 || cell === 1 || cell === 2))
    throw new RangeError("Nonogram board has an invalid cell");
  const solution = nonogramSolution(fixtureId);
  hinted.forEach((flag, index) => {
    if (flag && cells[index] !== (solution[index] === 1 ? 1 : 2))
      throw new RangeError("A hinted Nonogram cell does not match the solution");
  });
  if (!Number.isSafeInteger(hintCount) || hintCount < hinted.filter(Boolean).length)
    throw new RangeError("Nonogram hint count is invalid");
  const partial = { fixtureId, size: fixture.size, cells: cells as readonly NonogramCell[] };
  return freeze({
    fixtureSetRevision: NONOGRAM_FIXTURE_SET_REVISION,
    fixtureId,
    size: fixture.size,
    cells: cells as readonly NonogramCell[],
    hinted,
    hintCount,
    status: isSolved(partial) ? "solved" : "active",
    history: [],
  });
}

export function reduceNonogram(state: NonogramState, action: NonogramAction): NonogramState {
  if (action.type === "restart") return createNonogram(action.size, action.seed, action.exclude);
  if (state.status === "solved") return state;
  if (action.type === "undo") {
    const previous = state.history.at(-1);
    if (previous === undefined) return state;
    return restoreFrom(state, previous, state.history.slice(0, -1), state.hintCount);
  }
  if (action.type === "reset") {
    const cells = state.cells.map((cell, index) =>
      state.hinted[index] ? cell : 0,
    ) as NonogramCell[];
    if (cells.every((cell, index) => cell === state.cells[index])) return state;
    return restoreFrom(state, cells, push(state), state.hintCount);
  }
  if (action.type === "hint") {
    const solution = nonogramSolution(state.fixtureId);
    const index = state.cells.findIndex(
      (cell, position) => cell !== (solution[position] === 1 ? 1 : 2),
    );
    if (index < 0) return state;
    const cells = [...state.cells];
    cells[index] = solution[index] === 1 ? 1 : 2;
    const hinted = [...state.hinted];
    hinted[index] = true;
    return restoreFrom(state, cells, push(state), state.hintCount + 1, hinted);
  }
  const cells = [...state.cells];
  let changed = false;
  for (const index of action.indices) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= cells.length)
      throw new RangeError("Nonogram cell is out of range");
    if (state.hinted[index] || cells[index] === action.value) continue;
    cells[index] = action.value;
    changed = true;
  }
  return changed ? restoreFrom(state, cells, push(state), state.hintCount) : state;
}

const push = (state: NonogramState): readonly (readonly NonogramCell[])[] =>
  [...state.history, state.cells].slice(-NONOGRAM_MAX_UNDO);

function restoreFrom(
  state: NonogramState,
  cells: readonly NonogramCell[],
  history: readonly (readonly NonogramCell[])[],
  hintCount: number,
  hinted: readonly boolean[] = state.hinted,
): NonogramState {
  return freeze({
    ...state,
    cells,
    hinted,
    hintCount,
    history,
    status: isSolved({ fixtureId: state.fixtureId, size: state.size, cells }) ? "solved" : "active",
  });
}
