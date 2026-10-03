// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import type { JsonValue } from "@axl/extension-api";

import {
  NONOGRAM_FIXTURE_SET_REVISION,
  NONOGRAM_SIZES,
  type NonogramSize,
  type NonogramState,
  nonogramFixture,
  restoreNonogram,
} from "./nonogram.ts";

export const NONOGRAM_STORAGE_SCHEMA_VERSION = 1;
export const NONOGRAM_MAX_SOLVED = 512;

export interface NonogramPreferences {
  readonly size: NonogramSize;
}

interface SavedGame {
  readonly fixtureSetRevision: string;
  readonly fixtureId: string;
  /** One character per cell: 0 unknown, 1 filled, 2 marked empty. */
  readonly cells: string;
  /** One character per cell: 1 when a hint revealed it. */
  readonly hinted: string;
  readonly hintCount: number;
}

export interface NonogramSaveDocument {
  readonly version: 1;
  readonly preferences: NonogramPreferences;
  readonly game?: SavedGame;
  /** Fixture ids the player has solved, so new puzzles avoid them. */
  readonly solved: readonly string[];
}

export type NonogramSaveErrorCode = "corrupt" | "future-version" | "fixture-mismatch";

export class NonogramSaveError extends Error {
  readonly code: NonogramSaveErrorCode;

  constructor(code: NonogramSaveErrorCode, message: string) {
    super(message);
    this.name = "NonogramSaveError";
    this.code = code;
  }
}

const corrupt = (message: string): NonogramSaveError => new NonogramSaveError("corrupt", message);

export function createEmptyNonogramSave(): NonogramSaveDocument {
  return Object.freeze({
    version: 1,
    preferences: Object.freeze({ size: 10 }),
    solved: Object.freeze([]),
  });
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw corrupt(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) throw corrupt(`${label}.${unknown} is unknown`);
}

function restoreGame(value: unknown): NonogramState {
  const game = object(value, "game");
  exactKeys(game, ["fixtureSetRevision", "fixtureId", "cells", "hinted", "hintCount"], "game");
  if (game.fixtureSetRevision !== NONOGRAM_FIXTURE_SET_REVISION)
    throw new NonogramSaveError(
      "fixture-mismatch",
      `Saved puzzle set ${String(game.fixtureSetRevision)} does not match ${NONOGRAM_FIXTURE_SET_REVISION}`,
    );
  if (
    typeof game.fixtureId !== "string" ||
    typeof game.cells !== "string" ||
    typeof game.hinted !== "string"
  )
    throw corrupt("game is invalid");
  if (!/^[012]+$/u.test(game.cells) || !/^[01]+$/u.test(game.hinted))
    throw corrupt("game board has invalid characters");
  try {
    nonogramFixture(game.fixtureId);
    return restoreNonogram(
      game.fixtureId,
      [...game.cells].map(Number),
      [...game.hinted].map((flag) => flag === "1"),
      game.hintCount as number,
    );
  } catch (cause) {
    throw corrupt(cause instanceof Error ? cause.message : "game is invalid");
  }
}

export function parseNonogramSave(value: JsonValue): {
  readonly document: NonogramSaveDocument;
  readonly state?: NonogramState;
} {
  const input = object(value, "Nonogram save");
  if (typeof input.version === "number" && input.version > NONOGRAM_STORAGE_SCHEMA_VERSION)
    throw new NonogramSaveError(
      "future-version",
      `Unsupported Nonogram save version ${input.version}`,
    );
  if (input.version !== NONOGRAM_STORAGE_SCHEMA_VERSION)
    throw corrupt("Nonogram save version is invalid");
  exactKeys(input, ["version", "preferences", "game", "solved"], "Nonogram save");
  const preferences = object(input.preferences, "preferences");
  exactKeys(preferences, ["size"], "preferences");
  if (!NONOGRAM_SIZES.includes(preferences.size as NonogramSize))
    throw corrupt("Nonogram preferences are invalid");
  if (
    !Array.isArray(input.solved) ||
    input.solved.length > NONOGRAM_MAX_SOLVED ||
    !input.solved.every((id) => typeof id === "string" && id.length <= 32)
  )
    throw corrupt("Nonogram solved list is invalid");
  if (new Set(input.solved as string[]).size !== input.solved.length)
    throw corrupt("Nonogram solved ids must be unique");
  const state = input.game === undefined ? undefined : restoreGame(input.game);
  return {
    document: Object.freeze({
      version: 1,
      preferences: Object.freeze({ size: preferences.size as NonogramSize }),
      ...(state === undefined ? {} : { game: gameRecord(state) }),
      solved: Object.freeze([...(input.solved as string[])]),
    }),
    ...(state === undefined ? {} : { state }),
  };
}

function gameRecord(state: NonogramState): SavedGame {
  return Object.freeze({
    fixtureSetRevision: state.fixtureSetRevision,
    fixtureId: state.fixtureId,
    cells: state.cells.join(""),
    hinted: state.hinted.map((flag) => (flag ? "1" : "0")).join(""),
    hintCount: state.hintCount,
  });
}

export function updateNonogramSave(
  document: NonogramSaveDocument,
  state: NonogramState,
  preferences: NonogramPreferences,
): NonogramSaveDocument {
  const solved =
    state.status === "solved" && !document.solved.includes(state.fixtureId)
      ? [...document.solved, state.fixtureId].slice(-NONOGRAM_MAX_SOLVED)
      : document.solved;
  return Object.freeze({
    version: 1,
    preferences: Object.freeze({ ...preferences }),
    game: gameRecord(state),
    solved: Object.freeze([...solved]),
  });
}

/** Unions the solved lists of two copies of a save. The newest board and preferences win. */
export function mergeNonogramSolved(
  latest: NonogramSaveDocument,
  proposed: NonogramSaveDocument,
): NonogramSaveDocument {
  const solved = [...new Set([...latest.solved, ...proposed.solved])].slice(-NONOGRAM_MAX_SOLVED);
  return Object.freeze({ ...latest, solved: Object.freeze(solved) });
}

export function nonogramSaveJson(document: NonogramSaveDocument): JsonValue {
  return JSON.parse(JSON.stringify(document)) as JsonValue;
}
