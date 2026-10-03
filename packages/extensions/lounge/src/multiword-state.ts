// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import type { JsonValue } from "@axl/extension-api";

import { CODEWORD_DICTIONARY_REVISION } from "./codeword.ts";
import {
  createMultiword,
  MULTIWORD_BOARD_COUNTS,
  type MultiwordBoards,
  type MultiwordSelection,
  type MultiwordState,
  multiwordAttempts,
  reduceMultiword,
} from "./multiword.ts";

export const MULTIWORD_STORAGE_SCHEMA_VERSION = 1;
export const MULTIWORD_MAX_COMPLETIONS = 2_048;

export interface MultiwordPreferences {
  readonly puzzle: "daily" | "practice";
  readonly boards: MultiwordBoards;
}

interface SavedGame {
  readonly dictionaryRevision: string;
  readonly selection: MultiwordSelection;
  readonly currentGuess: string;
  readonly guesses: readonly string[];
  readonly status: "active" | "won" | "lost";
  readonly completionRecorded: boolean;
}

export interface MultiwordCompletion {
  readonly key: string;
  readonly boards: MultiwordBoards;
  readonly won: boolean;
  /** Guesses used. */
  readonly attempts: number;
  /** Boards solved when the game ended. */
  readonly solved: number;
  readonly dailyDate?: string;
}

export interface MultiwordSaveDocument {
  readonly version: 1;
  readonly preferences: MultiwordPreferences;
  readonly game?: SavedGame;
  readonly completions: readonly MultiwordCompletion[];
}

export interface MultiwordStatistics {
  readonly played: number;
  readonly wins: number;
  readonly winRate: number;
  readonly currentStreak: number;
  readonly maximumStreak: number;
  /** Fewest guesses in a win, or null before the first win. */
  readonly bestAttempts: number | null;
  /** Mean boards solved per game, as a fraction of the board count (0 to 1). */
  readonly solvedShare: number;
}

export type MultiwordSaveErrorCode = "corrupt" | "future-version" | "dictionary-mismatch";

export class MultiwordSaveError extends Error {
  readonly code: MultiwordSaveErrorCode;

  constructor(code: MultiwordSaveErrorCode, message: string) {
    super(message);
    this.name = "MultiwordSaveError";
    this.code = code;
  }
}

export function createEmptyMultiwordSave(): MultiwordSaveDocument {
  return Object.freeze({
    version: 1,
    preferences: Object.freeze({ puzzle: "daily", boards: 8 }),
    completions: Object.freeze([]),
  });
}

const corrupt = (message: string): MultiwordSaveError => new MultiwordSaveError("corrupt", message);

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw corrupt(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) throw corrupt(`${label}.${unknown} is unknown`);
}

function boardCount(value: unknown, label: string): MultiwordBoards {
  if (!MULTIWORD_BOARD_COUNTS.includes(value as MultiwordBoards))
    throw corrupt(`${label} must be 2, 4, or 8`);
  return value as MultiwordBoards;
}

function selection(value: unknown): MultiwordSelection {
  const input = object(value, "game.selection");
  const boards = boardCount(input.boards, "game.selection.boards");
  if (input.kind === "daily") {
    exactKeys(input, ["kind", "algorithmVersion", "boards", "utcDate"], "game.selection");
    if (input.algorithmVersion !== 1 || typeof input.utcDate !== "string")
      throw corrupt("game.selection is invalid");
    return { kind: "daily", algorithmVersion: 1, boards, utcDate: input.utcDate };
  }
  if (input.kind === "practice") {
    exactKeys(input, ["kind", "algorithmVersion", "boards", "seed"], "game.selection");
    if (input.algorithmVersion !== 1 || !Number.isSafeInteger(input.seed))
      throw corrupt("game.selection is invalid");
    return { kind: "practice", algorithmVersion: 1, boards, seed: input.seed as number };
  }
  throw corrupt("game.selection kind is invalid");
}

export function multiwordCompletionKey(state: Pick<MultiwordState, "selection">): string {
  const chosen = state.selection;
  return chosen.kind === "daily"
    ? `daily:${chosen.boards}:${chosen.utcDate}`
    : `practice:${CODEWORD_DICTIONARY_REVISION}:${chosen.algorithmVersion}:${chosen.boards}:${chosen.seed}`;
}

function restoreGame(value: unknown): {
  readonly state: MultiwordState;
  readonly recorded: boolean;
} {
  const game = object(value, "game");
  exactKeys(
    game,
    ["dictionaryRevision", "selection", "currentGuess", "guesses", "status", "completionRecorded"],
    "game",
  );
  if (game.dictionaryRevision !== CODEWORD_DICTIONARY_REVISION)
    throw new MultiwordSaveError(
      "dictionary-mismatch",
      `Saved dictionary ${String(game.dictionaryRevision)} does not match ${CODEWORD_DICTIONARY_REVISION}`,
    );
  if (!Array.isArray(game.guesses) || !game.guesses.every((guess) => typeof guess === "string"))
    throw corrupt("game.guesses is invalid");
  if (typeof game.currentGuess !== "string" || typeof game.completionRecorded !== "boolean")
    throw corrupt("game state is invalid");
  let state: MultiwordState;
  try {
    state = createMultiword(selection(game.selection));
  } catch (cause) {
    if (cause instanceof MultiwordSaveError) throw cause;
    throw corrupt(cause instanceof Error ? cause.message : "game selection is invalid");
  }
  for (const guess of game.guesses as string[]) {
    for (const letter of guess) state = reduceMultiword(state, { type: "enter", letter });
    state = reduceMultiword(state, { type: "submit" });
    if (state.issue !== undefined) throw corrupt("game guess is invalid");
  }
  for (const letter of game.currentGuess) state = reduceMultiword(state, { type: "enter", letter });
  if (state.issue !== undefined || state.status !== game.status)
    throw corrupt("game outcome does not match its guesses");
  return { state, recorded: game.completionRecorded };
}

function completion(value: unknown, index: number): MultiwordCompletion {
  const label = `completions[${index}]`;
  const record = object(value, label);
  exactKeys(record, ["key", "boards", "won", "attempts", "solved", "dailyDate"], label);
  const boards = boardCount(record.boards, `${label}.boards`);
  if (typeof record.key !== "string" || record.key.length === 0 || record.key.length > 256)
    throw corrupt(`${label}.key is invalid`);
  if (typeof record.won !== "boolean") throw corrupt(`${label}.won is invalid`);
  if (
    !Number.isSafeInteger(record.attempts) ||
    (record.attempts as number) < 1 ||
    (record.attempts as number) > multiwordAttempts(boards)
  )
    throw corrupt(`${label}.attempts is invalid`);
  if (
    !Number.isSafeInteger(record.solved) ||
    (record.solved as number) < 0 ||
    (record.solved as number) > boards ||
    record.won !== (record.solved === boards)
  )
    throw corrupt(`${label}.solved is invalid`);
  if (record.dailyDate !== undefined) {
    if (
      typeof record.dailyDate !== "string" ||
      record.key !== `daily:${boards}:${record.dailyDate}` ||
      new Date(`${record.dailyDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== record.dailyDate
    )
      throw corrupt(`${label}.dailyDate is invalid`);
  } else if (!/^practice:[a-z0-9._-]{1,128}:\d+:\d+:-?\d+$/u.test(record.key))
    throw corrupt(`${label}.key is invalid`);
  return Object.freeze({
    key: record.key,
    boards,
    won: record.won,
    attempts: record.attempts as number,
    solved: record.solved as number,
    ...(record.dailyDate === undefined ? {} : { dailyDate: record.dailyDate }),
  });
}

export function parseMultiwordSave(value: JsonValue): {
  readonly document: MultiwordSaveDocument;
  readonly state?: MultiwordState;
  readonly completionRecorded: boolean;
} {
  const input = object(value, "Multiword save");
  if (typeof input.version === "number" && input.version > MULTIWORD_STORAGE_SCHEMA_VERSION)
    throw new MultiwordSaveError(
      "future-version",
      `Unsupported Multiword save version ${input.version}`,
    );
  if (input.version !== MULTIWORD_STORAGE_SCHEMA_VERSION)
    throw corrupt("Multiword save version is invalid");
  exactKeys(input, ["version", "preferences", "game", "completions"], "Multiword save");
  const preferences = object(input.preferences, "preferences");
  exactKeys(preferences, ["puzzle", "boards"], "preferences");
  if (preferences.puzzle !== "daily" && preferences.puzzle !== "practice")
    throw corrupt("Multiword preferences are invalid");
  const boards = boardCount(preferences.boards, "preferences.boards");
  if (!Array.isArray(input.completions) || input.completions.length > MULTIWORD_MAX_COMPLETIONS)
    throw corrupt("Multiword completions are invalid");
  const completions = input.completions.map(completion);
  if (new Set(completions.map(({ key }) => key)).size !== completions.length)
    throw corrupt("Multiword completion keys must be unique");
  const restored = input.game === undefined ? undefined : restoreGame(input.game);
  if (restored !== undefined) {
    const recorded = completions.some(({ key }) => key === multiwordCompletionKey(restored.state));
    if (restored.recorded !== (restored.state.status !== "active" && recorded))
      throw corrupt("game completion marker does not match statistics");
  }
  const document: MultiwordSaveDocument = Object.freeze({
    version: 1,
    preferences: Object.freeze({ puzzle: preferences.puzzle, boards }),
    ...(restored === undefined ? {} : { game: gameRecord(restored.state, restored.recorded) }),
    completions: Object.freeze(completions),
  });
  return {
    document,
    ...(restored === undefined ? {} : { state: restored.state }),
    completionRecorded: restored?.recorded ?? false,
  };
}

function gameRecord(state: MultiwordState, completionRecorded: boolean): SavedGame {
  return Object.freeze({
    dictionaryRevision: state.dictionaryRevision,
    selection: state.selection,
    currentGuess: state.currentGuess,
    guesses: state.guesses,
    status: state.status,
    completionRecorded,
  });
}

export function updateMultiwordSave(
  document: MultiwordSaveDocument,
  state: MultiwordState,
  preferences: MultiwordPreferences,
): { readonly document: MultiwordSaveDocument; readonly completionAdded: boolean } {
  const key = multiwordCompletionKey(state);
  const alreadyRecorded = document.completions.some((record) => record.key === key);
  const completionAdded = state.status !== "active" && !alreadyRecorded;
  if (completionAdded && document.completions.length >= MULTIWORD_MAX_COMPLETIONS)
    throw corrupt("Multiword completion history is full");
  const completions = completionAdded
    ? [
        ...document.completions,
        Object.freeze({
          key,
          boards: state.boards,
          won: state.status === "won",
          attempts: state.guesses.length,
          solved: state.solvedAt.filter((solved) => solved !== null).length,
          ...(state.selection.kind === "daily" ? { dailyDate: state.selection.utcDate } : {}),
        }),
      ]
    : document.completions;
  return {
    document: Object.freeze({
      version: 1,
      preferences: Object.freeze({ ...preferences }),
      game: gameRecord(state, state.status !== "active" && (alreadyRecorded || completionAdded)),
      completions: Object.freeze(completions),
    }),
    completionAdded,
  };
}

/** Joins completion records from two copies of a save. The newest board and preferences win. */
export function mergeMultiwordCompletions(
  latest: MultiwordSaveDocument,
  proposed: MultiwordSaveDocument,
): MultiwordSaveDocument {
  const byKey = new Map(latest.completions.map((record) => [record.key, record]));
  for (const record of proposed.completions)
    if (!byKey.has(record.key)) byKey.set(record.key, record);
  const completions = [...byKey.values()].sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  );
  if (completions.length > MULTIWORD_MAX_COMPLETIONS)
    throw corrupt("Multiword completion history is full");
  return Object.freeze({ ...latest, completions: Object.freeze(completions) });
}

const utcDay = (value: string): number =>
  Math.floor(Date.parse(`${value}T00:00:00.000Z`) / 86_400_000);

export function multiwordStatistics(
  document: MultiwordSaveDocument,
  boards: MultiwordBoards,
): MultiwordStatistics {
  const records = document.completions.filter((record) => record.boards === boards);
  const wins = records.filter(({ won }) => won);
  const daily = records
    .filter((record): record is MultiwordCompletion & { readonly dailyDate: string } =>
      Boolean(record.dailyDate),
    )
    .sort((left, right) => (left.dailyDate < right.dailyDate ? -1 : 1));
  let currentStreak = 0;
  let maximumStreak = 0;
  let previousDay: number | undefined;
  for (const record of daily) {
    const day = utcDay(record.dailyDate);
    currentStreak =
      record.won && (previousDay === undefined || day === previousDay + 1)
        ? currentStreak + 1
        : record.won
          ? 1
          : 0;
    maximumStreak = Math.max(maximumStreak, currentStreak);
    previousDay = day;
  }
  const solved = records.reduce((total, record) => total + record.solved, 0);
  return Object.freeze({
    played: records.length,
    wins: wins.length,
    winRate: records.length === 0 ? 0 : Math.round((wins.length / records.length) * 100),
    currentStreak,
    maximumStreak,
    bestAttempts: wins.length === 0 ? null : Math.min(...wins.map(({ attempts }) => attempts)),
    solvedShare: records.length === 0 ? 0 : solved / (records.length * boards),
  });
}

export function multiwordSaveJson(document: MultiwordSaveDocument): JsonValue {
  return JSON.parse(JSON.stringify(document)) as JsonValue;
}
