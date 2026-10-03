// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

export interface MultiwordLayout {
  /** Boards per row. */
  readonly columns: number;
  /** Tile edge length in pixels. */
  readonly tile: number;
}

const TILE_GAP = 2;
const BOARD_GAP = 10;
const LETTERS = 5;

/**
 * Picks the column count that gives the largest tiles for `boards` boards of `attempts` rows
 * inside `width` by `height` pixels. Tiles never fall below `minimum`, so a small area scrolls
 * instead of becoming unreadable.
 */
export function multiwordLayout(
  width: number,
  height: number,
  boards: number,
  attempts: number,
  minimum = 12,
  maximum = 44,
): MultiwordLayout {
  let best: MultiwordLayout | undefined;
  for (let columns = 1; columns <= boards; columns += 1) {
    if (boards % columns !== 0) continue;
    const rows = boards / columns;
    const byWidth = (width - (columns - 1) * BOARD_GAP) / (columns * LETTERS) - TILE_GAP;
    const byHeight = (height - (rows - 1) * BOARD_GAP) / (rows * attempts) - TILE_GAP;
    const tile = Math.floor(Math.min(byWidth, byHeight, maximum));
    if (best === undefined || tile > best.tile) best = { columns, tile };
  }
  if (best === undefined) throw new RangeError("Multiword needs at least one board");
  return { columns: best.columns, tile: Math.max(minimum, best.tile) };
}
