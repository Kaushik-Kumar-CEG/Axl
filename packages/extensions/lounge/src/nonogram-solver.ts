// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

/** Cell values while solving: 0 unknown, 1 filled, 2 empty. */
export type NonogramLineCell = 0 | 1 | 2;

/** Run lengths of filled cells in a line of 0s and 1s. An empty line has no runs. */
export function nonogramRuns(line: readonly number[]): readonly number[] {
  const runs: number[] = [];
  let length = 0;
  for (const cell of line) {
    if (cell === 1) length += 1;
    else if (length > 0) {
      runs.push(length);
      length = 0;
    }
  }
  if (length > 0) runs.push(length);
  return Object.freeze(runs);
}

/**
 * Line logic: returns the cells every arrangement of `clue` agrees on, given what is known, or
 * undefined when no arrangement fits.
 */
function solveLine(
  clue: readonly number[],
  line: readonly NonogramLineCell[],
): NonogramLineCell[] | undefined {
  const length = line.length;
  const memo = new Map<number, boolean>();
  const filledAfter: number[] = Array(length + 1).fill(0);
  for (let index = length - 1; index >= 0; index -= 1)
    filledAfter[index] = (filledAfter[index + 1] as number) + (line[index] === 1 ? 1 : 0);
  /** Can clue[run..] be placed in line[from..]? */
  const fits = (run: number, from: number): boolean => {
    const key = run * (length + 2) + from;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result = false;
    if (run === clue.length) result = (filledAfter[Math.min(from, length)] as number) === 0;
    else {
      const size = clue[run] as number;
      for (let start = from; start + size <= length && !result; start += 1) {
        if (line.slice(from, start).includes(1)) break;
        const block = line.slice(start, start + size);
        const next = start + size;
        if (block.includes(2) || line[next] === 1) continue;
        if (fits(run + 1, next + 1)) result = true;
      }
    }
    memo.set(key, result);
    return result;
  };
  if (!fits(0, 0)) return undefined;
  const canFill = Array<boolean>(length).fill(false);
  const canEmpty = Array<boolean>(length).fill(false);
  const place = (run: number, from: number, filled: number[]): void => {
    if (run === clue.length) {
      if ((filledAfter[Math.min(from, length)] as number) !== 0) return;
      const marked = new Set(filled);
      for (let index = 0; index < length; index += 1)
        if (marked.has(index)) canFill[index] = true;
        else canEmpty[index] = true;
      return;
    }
    const size = clue[run] as number;
    for (let start = from; start + size <= length; start += 1) {
      if (line.slice(from, start).includes(1)) break;
      const next = start + size;
      if (line.slice(start, next).includes(2) || line[next] === 1) continue;
      if (!fits(run + 1, next + 1)) continue;
      place(run + 1, next + 1, [...filled, ...Array.from({ length: size }, (_, i) => start + i)]);
    }
  };
  // Enumerating every arrangement is exponential in theory but lines here are at most 20 long.
  place(0, 0, []);
  return line.map((cell, index) => {
    if (cell !== 0) return cell;
    if (canFill[index] && !canEmpty[index]) return 1;
    if (canEmpty[index] && !canFill[index]) return 2;
    return 0;
  });
}

export interface NonogramSolveResult {
  readonly solved: boolean;
  /** Cells the line logic could settle: 1 filled, 2 empty, 0 unknown. */
  readonly cells: readonly NonogramLineCell[];
}

/** Solves with line logic only. A puzzle that solves this way has exactly one solution. */
export function solveNonogramByLines(
  rowClues: readonly (readonly number[])[],
  columnClues: readonly (readonly number[])[],
): NonogramSolveResult {
  const height = rowClues.length;
  const width = columnClues.length;
  const cells: NonogramLineCell[] = Array(width * height).fill(0);
  for (let changed = true; changed; ) {
    changed = false;
    for (let row = 0; row < height; row += 1) {
      const line = cells.slice(row * width, row * width + width) as NonogramLineCell[];
      const solved = solveLine(rowClues[row] as readonly number[], line);
      if (solved === undefined) return { solved: false, cells };
      solved.forEach((cell, column) => {
        if (cell !== cells[row * width + column]) {
          cells[row * width + column] = cell;
          changed = true;
        }
      });
    }
    for (let column = 0; column < width; column += 1) {
      const line = Array.from(
        { length: height },
        (_, row) => cells[row * width + column] as NonogramLineCell,
      );
      const solved = solveLine(columnClues[column] as readonly number[], line);
      if (solved === undefined) return { solved: false, cells };
      solved.forEach((cell, row) => {
        if (cell !== cells[row * width + column]) {
          cells[row * width + column] = cell;
          changed = true;
        }
      });
    }
  }
  return { solved: cells.every((cell) => cell !== 0), cells };
}
