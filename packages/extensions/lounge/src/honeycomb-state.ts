// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import type { JsonValue } from "@axl/extension-api";

import {
  createHoneycomb,
  HONEYCOMB_WORD_LIST_REVISION,
  type HoneycombSelection,
  type HoneycombState,
  isHoneycombPangram,
  reduceHoneycomb,
} from "./honeycomb.ts";

export const HONEYCOMB_STORAGE_SCHEMA_VERSION = 1;
export const HONEYCOMB_MAX_HISTORY = 2_048;

export interface HoneycombPreferences {
  readonly puzzle: "daily" | "practice";
}

interface SavedGame {
  readonly wordListRevision: string;
  readonly selection: HoneycombSelection;
  readonly shuffles: number;
  readonly currentWord: string;
  readonly found: readonly string[];
}

export interface HoneycombHistoryRecord {
  readonly key: string;
  readonly score: number;
  readonly maxScore: number;
  readonly words: number;
  readonly pangrams: number;
}

export interface HoneycombSaveDocument {
  readonly version: 1;
  readonly preferences: HoneycombPreferences;
  readonly game?: SavedGame;
  readonly history: readonly HoneycombHistoryRecord[];
}

export interface HoneycombStatistics {
  readonly played: number;
  /** Mean share of the maximum score, from 0 to 1. */
  readonly averageShare: number;
  /** Puzzles that reached at least half of the maximum score. */
  readonly great: number;
  readonly pangrams: number;
  readonly words: number;
}

export type HoneycombSaveErrorCode = "corrupt" | "future-version" | "word-list-mismatch";

export class HoneycombSaveError extends Error {
  readonly code: HoneycombSaveErrorCode;

  constructor(code: HoneycombSaveErrorCode, message: string) {
    super(message);
    this.name = "HoneycombSaveError";
    this.code = code;
  }
}

const corrupt = (message: string): HoneycombSaveError => new HoneycombSaveError("corrupt", message);

export function createEmptyHoneycombSave(): HoneycombSaveDocument {
  return Object.freeze({
    version: 1,
    preferences: Object.freeze({ puzzle: "daily" }),
    history: Object.freeze([]),
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

function selection(value: unknown): HoneycombSelection {
  const input = object(value, "game.selection");
  if (input.kind === "daily") {
    exactKeys(input, ["kind", "algorithmVersion", "utcDate"], "game.selection");
    if (input.algorithmVersion !== 1 || typeof input.utcDate !== "string")
      throw corrupt("game.selection is invalid");
    return { kind: "daily", algorithmVersion: 1, utcDate: input.utcDate };
  }
  if (input.kind === "practice") {
    exactKeys(input, ["kind", "algorithmVersion", "seed"], "game.selection");
    if (input.algorithmVersion !== 1 || !Number.isSafeInteger(input.seed))
      throw corrupt("game.selection is invalid");
    return { kind: "practice", algorithmVersion: 1, seed: input.seed as number };
  }
  throw corrupt("game.selection kind is invalid");
}

export function honeycombHistoryKey(state: Pick<HoneycombState, "selection">): string {
  const chosen = state.selection;
  return chosen.kind === "daily"
    ? `daily:${chosen.utcDate}`
    : `practice:${HONEYCOMB_WORD_LIST_REVISION}:${chosen.algorithmVersion}:${chosen.seed}`;
}

function restoreGame(value: unknown): HoneycombState {
  const game = object(value, "game");
  exactKeys(game, ["wordListRevision", "selection", "shuffles", "currentWord", "found"], "game");
  if (game.wordListRevision !== HONEYCOMB_WORD_LIST_REVISION)
    throw new HoneycombSaveError(
      "word-list-mismatch",
      `Saved word list ${String(game.wordListRevision)} does not match ${HONEYCOMB_WORD_LIST_REVISION}`,
    );
  if (!Array.isArray(game.found) || !game.found.every((word) => typeof word === "string"))
    throw corrupt("game.found is invalid");
  if (
    !Number.isSafeInteger(game.shuffles) ||
    (game.shuffles as number) < 0 ||
    (game.shuffles as number) > 1_000_000
  )
    throw corrupt("game.shuffles is invalid");
  if (typeof game.currentWord !== "string") throw corrupt("game.currentWord is invalid");
  let state: HoneycombState;
  try {
    state = createHoneycomb(selection(game.selection));
  } catch (cause) {
    if (cause instanceof HoneycombSaveError) throw cause;
    throw corrupt(cause instanceof Error ? cause.message : "game selection is invalid");
  }
  for (const word of game.found as string[]) {
    for (const letter of word) state = reduceHoneycomb(state, { type: "enter", letter });
    state = reduceHoneycomb(state, { type: "submit" });
    if (state.issue !== undefined) throw corrupt(`game word ${word} is invalid`);
  }
  for (let index = 0; index < (game.shuffles as number); index += 1)
    state = reduceHoneycomb(state, { type: "shuffle" });
  for (const letter of game.currentWord) state = reduceHoneycomb(state, { type: "enter", letter });
  if (state.issue !== undefined) throw corrupt("game current word is invalid");
  return state;
}

function historyRecord(value: unknown, index: number): HoneycombHistoryRecord {
  const label = `history[${index}]`;
  const record = object(value, label);
  exactKeys(record, ["key", "score", "maxScore", "words", "pangrams"], label);
  if (typeof record.key !== "string" || record.key.length === 0 || record.key.length > 256)
    throw corrupt(`${label}.key is invalid`);
  for (const field of ["score", "maxScore", "words", "pangrams"] as const)
    if (!Number.isSafeInteger(record[field]) || (record[field] as number) < 0)
      throw corrupt(`${label}.${field} is invalid`);
  if (
    (record.score as number) > (record.maxScore as number) ||
    (record.pangrams as number) > (record.words as number)
  )
    throw corrupt(`${label} is inconsistent`);
  return Object.freeze({
    key: record.key,
    score: record.score as number,
    maxScore: record.maxScore as number,
    words: record.words as number,
    pangrams: record.pangrams as number,
  });
}

export function parseHoneycombSave(value: JsonValue): {
  readonly document: HoneycombSaveDocument;
  readonly state?: HoneycombState;
} {
  const input = object(value, "Honeycomb save");
  if (typeof input.version === "number" && input.version > HONEYCOMB_STORAGE_SCHEMA_VERSION)
    throw new HoneycombSaveError(
      "future-version",
      `Unsupported Honeycomb save version ${input.version}`,
    );
  if (input.version !== HONEYCOMB_STORAGE_SCHEMA_VERSION)
    throw corrupt("Honeycomb save version is invalid");
  exactKeys(input, ["version", "preferences", "game", "history"], "Honeycomb save");
  const preferences = object(input.preferences, "preferences");
  exactKeys(preferences, ["puzzle"], "preferences");
  if (preferences.puzzle !== "daily" && preferences.puzzle !== "practice")
    throw corrupt("Honeycomb preferences are invalid");
  if (!Array.isArray(input.history) || input.history.length > HONEYCOMB_MAX_HISTORY)
    throw corrupt("Honeycomb history is invalid");
  const history = input.history.map(historyRecord);
  if (new Set(history.map(({ key }) => key)).size !== history.length)
    throw corrupt("Honeycomb history keys must be unique");
  const state = input.game === undefined ? undefined : restoreGame(input.game);
  return {
    document: Object.freeze({
      version: 1,
      preferences: Object.freeze({ puzzle: preferences.puzzle }),
      ...(state === undefined ? {} : { game: gameRecord(state) }),
      history: Object.freeze(history),
    }),
    ...(state === undefined ? {} : { state }),
  };
}

function gameRecord(state: HoneycombState): SavedGame {
  return Object.freeze({
    wordListRevision: state.wordListRevision,
    selection: state.selection,
    shuffles: state.shuffles,
    currentWord: state.currentWord,
    found: state.found,
  });
}

export function updateHoneycombSave(
  document: HoneycombSaveDocument,
  state: HoneycombState,
  preferences: HoneycombPreferences,
): HoneycombSaveDocument {
  const key = honeycombHistoryKey(state);
  const record: HoneycombHistoryRecord = Object.freeze({
    key,
    score: state.score,
    maxScore: state.maxScore,
    words: state.found.length,
    pangrams: state.found.filter((word) => isHoneycombPangram(word, state.letters)).length,
  });
  const others = document.history.filter((entry) => entry.key !== key);
  const history = state.found.length === 0 ? others : [...others, record];
  return Object.freeze({
    version: 1,
    preferences: Object.freeze({ ...preferences }),
    game: gameRecord(state),
    history: Object.freeze(history.slice(-HONEYCOMB_MAX_HISTORY)),
  });
}

/** Joins the history of two copies of a save. A puzzle keeps its higher score. */
export function mergeHoneycombHistory(
  latest: HoneycombSaveDocument,
  proposed: HoneycombSaveDocument,
): HoneycombSaveDocument {
  const byKey = new Map(latest.history.map((record) => [record.key, record]));
  for (const record of proposed.history) {
    const existing = byKey.get(record.key);
    if (existing === undefined || record.score > existing.score) byKey.set(record.key, record);
  }
  return Object.freeze({
    ...latest,
    history: Object.freeze([...byKey.values()].slice(-HONEYCOMB_MAX_HISTORY)),
  });
}

export function honeycombStatistics(document: HoneycombSaveDocument): HoneycombStatistics {
  const records = document.history;
  const shares = records.map((record) =>
    record.maxScore === 0 ? 0 : record.score / record.maxScore,
  );
  return Object.freeze({
    played: records.length,
    averageShare:
      records.length === 0 ? 0 : shares.reduce((total, share) => total + share, 0) / records.length,
    great: shares.filter((share) => share >= 0.5).length,
    pangrams: records.reduce((total, record) => total + record.pangrams, 0),
    words: records.reduce((total, record) => total + record.words, 0),
  });
}

export function honeycombSaveJson(document: HoneycombSaveDocument): JsonValue {
  return JSON.parse(JSON.stringify(document)) as JsonValue;
}
