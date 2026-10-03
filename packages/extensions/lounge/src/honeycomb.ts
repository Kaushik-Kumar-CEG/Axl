// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import {
  HONEYCOMB_PUZZLES,
  HONEYCOMB_WORD_LIST_REVISION,
  HONEYCOMB_WORDS,
} from "./honeycomb-data.generated.ts";

export const HONEYCOMB_SELECTION_VERSION = 1;
export const HONEYCOMB_MIN_LENGTH = 4;
export const HONEYCOMB_MAX_LENGTH = 12;
export const HONEYCOMB_PANGRAM_BONUS = 7;
export { HONEYCOMB_WORD_LIST_REVISION };

export type HoneycombSelection =
  | {
      readonly kind: "daily";
      readonly algorithmVersion: typeof HONEYCOMB_SELECTION_VERSION;
      readonly utcDate: string;
    }
  | {
      readonly kind: "practice";
      readonly algorithmVersion: typeof HONEYCOMB_SELECTION_VERSION;
      readonly seed: number;
    };

export type HoneycombIssue =
  | "invalid-letter"
  | "word-full"
  | "too-short"
  | "missing-center"
  | "not-in-list"
  | "already-found";

export interface HoneycombState {
  readonly wordListRevision: typeof HONEYCOMB_WORD_LIST_REVISION;
  readonly selection: HoneycombSelection;
  /** All seven letters, sorted. */
  readonly letters: string;
  readonly center: string;
  /** The six outer letters in their current display order. */
  readonly outer: readonly string[];
  readonly shuffles: number;
  readonly currentWord: string;
  readonly found: readonly string[];
  readonly score: number;
  readonly maxScore: number;
  readonly wordCount: number;
  readonly issue?: HoneycombIssue;
}

export type HoneycombAction =
  | { readonly type: "enter"; readonly letter: string }
  | { readonly type: "erase" }
  | { readonly type: "submit" }
  | { readonly type: "shuffle" }
  | { readonly type: "restart"; readonly selection: HoneycombSelection };

const dictionary = new Set<string>(HONEYCOMB_WORDS);

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

function selectionKey(selection: HoneycombSelection): string {
  const identity = selection.kind === "daily" ? selection.utcDate : String(selection.seed);
  return [selection.kind, selection.algorithmVersion, HONEYCOMB_WORD_LIST_REVISION, identity].join(
    ":",
  );
}

function validateSelection(selection: HoneycombSelection): void {
  if (selection.algorithmVersion !== HONEYCOMB_SELECTION_VERSION)
    throw new RangeError(`Unsupported Honeycomb selection version ${selection.algorithmVersion}`);
  if (selection.kind === "daily") {
    const date = new Date(`${selection.utcDate}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/u.test(selection.utcDate) ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== selection.utcDate
    )
      throw new TypeError("UTC puzzle date must be a valid YYYY-MM-DD date");
  } else if (!Number.isSafeInteger(selection.seed))
    throw new TypeError("Practice seed must be a safe integer");
}

export function isHoneycombPangram(word: string, letters: string): boolean {
  return [...letters].every((letter) => word.includes(letter));
}

/** One point for a four-letter word, the length otherwise, and a bonus for using every letter. */
export function honeycombPoints(word: string, letters: string): number {
  return (
    (word.length === HONEYCOMB_MIN_LENGTH ? 1 : word.length) +
    (isHoneycombPangram(word, letters) ? HONEYCOMB_PANGRAM_BONUS : 0)
  );
}

const answerCache = new Map<string, readonly string[]>();

/** Every valid word for a puzzle, sorted. */
export function honeycombAnswers(letters: string, center: string): readonly string[] {
  const key = `${letters}:${center}`;
  const cached = answerCache.get(key);
  if (cached !== undefined) return cached;
  const allowed = new Set(letters);
  const answers = Object.freeze(
    HONEYCOMB_WORDS.filter(
      (word) => word.includes(center) && [...word].every((letter) => allowed.has(letter)),
    ),
  );
  answerCache.set(key, answers);
  return answers;
}

/** Orders letters with a permutation that depends only on `seed`. */
function arranged(letters: readonly string[], seed: string): readonly string[] {
  const result = [...letters];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = hash32(`${seed}:${index}`) % (index + 1);
    [result[index], result[other]] = [result[other] as string, result[index] as string];
  }
  return Object.freeze(result);
}

function freeze(state: HoneycombState): HoneycombState {
  const { issue, ...rest } = state;
  return Object.freeze({
    ...rest,
    selection: Object.freeze({ ...state.selection }),
    outer: Object.freeze([...state.outer]),
    found: Object.freeze([...state.found]),
    ...(issue === undefined ? {} : { issue }),
  });
}

export function honeycombPuzzle(selection: HoneycombSelection): {
  readonly letters: string;
  readonly center: string;
} {
  validateSelection(selection);
  const entry = HONEYCOMB_PUZZLES[
    hash32(selectionKey(selection)) % HONEYCOMB_PUZZLES.length
  ] as string;
  return { letters: entry.slice(0, 7), center: entry.slice(7) };
}

export function createHoneycomb(selection: HoneycombSelection): HoneycombState {
  const { letters, center } = honeycombPuzzle(selection);
  const answers = honeycombAnswers(letters, center);
  const outer = [...letters].filter((letter) => letter !== center);
  return freeze({
    wordListRevision: HONEYCOMB_WORD_LIST_REVISION,
    selection,
    letters,
    center,
    outer: arranged(outer, `${selectionKey(selection)}:0`),
    shuffles: 0,
    currentWord: "",
    found: [],
    score: 0,
    maxScore: answers.reduce((total, word) => total + honeycombPoints(word, letters), 0),
    wordCount: answers.length,
  });
}

const withIssue = (state: HoneycombState, issue: HoneycombIssue): HoneycombState =>
  freeze({ ...state, issue });

function clearIssue(state: HoneycombState): Omit<HoneycombState, "issue"> {
  const { issue: _issue, ...rest } = state;
  return rest;
}

export function reduceHoneycomb(state: HoneycombState, action: HoneycombAction): HoneycombState {
  if (action.type === "restart") return createHoneycomb(action.selection);
  if (action.type === "shuffle") {
    const shuffles = state.shuffles + 1;
    return freeze({
      ...clearIssue(state),
      shuffles,
      outer: arranged([...state.outer].sort(), `${selectionKey(state.selection)}:${shuffles}`),
    });
  }
  if (action.type === "enter") {
    const letter = action.letter.toLowerCase();
    if ([...action.letter].length !== 1 || !state.letters.includes(letter))
      return withIssue(state, "invalid-letter");
    if (state.currentWord.length === HONEYCOMB_MAX_LENGTH) return withIssue(state, "word-full");
    return freeze({ ...clearIssue(state), currentWord: `${state.currentWord}${letter}` });
  }
  if (action.type === "erase")
    return freeze({ ...clearIssue(state), currentWord: state.currentWord.slice(0, -1) });

  const word = state.currentWord;
  if (word.length < HONEYCOMB_MIN_LENGTH) return withIssue(state, "too-short");
  if (!word.includes(state.center)) return withIssue(state, "missing-center");
  if (state.found.includes(word)) return withIssue(state, "already-found");
  if (!dictionary.has(word)) return withIssue(state, "not-in-list");
  return freeze({
    ...clearIssue(state),
    currentWord: "",
    found: [...state.found, word],
    score: state.score + honeycombPoints(word, state.letters),
  });
}

const RANKS = Object.freeze([
  { name: "Newcomer", share: 0 },
  { name: "Warming up", share: 0.02 },
  { name: "Getting going", share: 0.05 },
  { name: "Good", share: 0.1 },
  { name: "Solid", share: 0.2 },
  { name: "Strong", share: 0.35 },
  { name: "Great", share: 0.5 },
  { name: "Excellent", share: 0.7 },
  { name: "Master", share: 0.85 },
  { name: "Complete", share: 1 },
] as const);

export interface HoneycombRank {
  readonly index: number;
  readonly name: string;
  /** Score needed for the next rank, or null at the top. */
  readonly nextAt: number | null;
}

export function honeycombRank(score: number, maxScore: number): HoneycombRank {
  let index = 0;
  for (let candidate = 0; candidate < RANKS.length; candidate += 1)
    if (
      score >= Math.ceil((RANKS[candidate]?.share ?? 0) * maxScore) &&
      (candidate === 0 || score > 0)
    )
      index = candidate;
  const next = RANKS[index + 1];
  return Object.freeze({
    index,
    name: (RANKS[index] as (typeof RANKS)[number]).name,
    nextAt: next === undefined ? null : Math.ceil(next.share * maxScore),
  });
}

export const HONEYCOMB_RANK_COUNT = RANKS.length;
/** Share of the maximum score where each rank after the first begins. */
export const HONEYCOMB_RANK_SHARES: readonly number[] = Object.freeze(
  RANKS.slice(1).map(({ share }) => share),
);
