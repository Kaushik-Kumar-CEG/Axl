// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import {
  CODEWORD_ACCEPTED_GUESSES,
  CODEWORD_ANSWERS,
  CODEWORD_DICTIONARY_REVISION,
  CODEWORD_LENGTH,
  type CodewordScore,
  scoreCodewordGuess,
} from "./codeword.ts";

export const MULTIWORD_SELECTION_VERSION = 1;
export const MULTIWORD_BOARD_COUNTS = Object.freeze([2, 4, 8] as const);

export type MultiwordBoards = (typeof MULTIWORD_BOARD_COUNTS)[number];
export type MultiwordStatus = "active" | "won" | "lost";

/** Guesses allowed for each board count. */
const ATTEMPTS: Readonly<Record<MultiwordBoards, number>> = Object.freeze({ 2: 7, 4: 9, 8: 13 });

export type MultiwordSelection =
  | {
      readonly kind: "daily";
      readonly algorithmVersion: typeof MULTIWORD_SELECTION_VERSION;
      readonly boards: MultiwordBoards;
      readonly utcDate: string;
    }
  | {
      readonly kind: "practice";
      readonly algorithmVersion: typeof MULTIWORD_SELECTION_VERSION;
      readonly boards: MultiwordBoards;
      readonly seed: number;
    };

export type MultiwordIssue =
  | "invalid-letter"
  | "row-full"
  | "incomplete-guess"
  | "invalid-guess"
  | "game-complete";

export interface MultiwordState {
  readonly dictionaryRevision: typeof CODEWORD_DICTIONARY_REVISION;
  readonly selection: MultiwordSelection;
  readonly boards: MultiwordBoards;
  readonly attempts: number;
  readonly answers: readonly string[];
  readonly currentGuess: string;
  /** Every submitted word, shared by all boards. */
  readonly guesses: readonly string[];
  /** Index into `guesses` of the guess that solved each board, or null while unsolved. */
  readonly solvedAt: readonly (number | null)[];
  readonly status: MultiwordStatus;
  readonly issue?: MultiwordIssue;
}

export type MultiwordAction =
  | { readonly type: "enter"; readonly letter: string }
  | { readonly type: "erase" }
  | { readonly type: "submit" }
  | { readonly type: "restart"; readonly selection: MultiwordSelection };

export interface MultiwordBoardView {
  readonly solved: boolean;
  /** Guesses this board has seen. A solved board stops after the guess that solved it. */
  readonly rows: readonly { readonly word: string; readonly score: readonly CodewordScore[] }[];
}

const LETTER = /^[a-z]$/u;
const accepted = new Set<string>(CODEWORD_ACCEPTED_GUESSES);

export function multiwordAttempts(boards: MultiwordBoards): number {
  return ATTEMPTS[boards];
}

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

function validateSelection(selection: MultiwordSelection): void {
  if (selection.algorithmVersion !== MULTIWORD_SELECTION_VERSION)
    throw new RangeError(`Unsupported Multiword selection version ${selection.algorithmVersion}`);
  if (!MULTIWORD_BOARD_COUNTS.includes(selection.boards))
    throw new RangeError("Multiword boards must be 2, 4, or 8");
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

/** Answers are distinct and depend only on the selection and the dictionary revision. */
export function multiwordAnswers(selection: MultiwordSelection): readonly string[] {
  validateSelection(selection);
  const identity = selection.kind === "daily" ? selection.utcDate : String(selection.seed);
  const base = [
    selection.kind,
    selection.algorithmVersion,
    CODEWORD_DICTIONARY_REVISION,
    selection.boards,
    identity,
  ].join(":");
  const answers: string[] = [];
  for (let board = 0; board < selection.boards; board += 1) {
    for (let salt = 0; ; salt += 1) {
      const word = CODEWORD_ANSWERS[
        hash32(`${base}:${board}:${salt}`) % CODEWORD_ANSWERS.length
      ] as string;
      if (!answers.includes(word)) {
        answers.push(word);
        break;
      }
    }
  }
  return Object.freeze(answers);
}

function freeze(state: MultiwordState): MultiwordState {
  const { issue, ...rest } = state;
  return Object.freeze({
    ...rest,
    selection: Object.freeze({ ...state.selection }),
    answers: Object.freeze([...state.answers]),
    guesses: Object.freeze([...state.guesses]),
    solvedAt: Object.freeze([...state.solvedAt]),
    ...(issue === undefined ? {} : { issue }),
  });
}

export function createMultiword(selection: MultiwordSelection): MultiwordState {
  const answers = multiwordAnswers(selection);
  return freeze({
    dictionaryRevision: CODEWORD_DICTIONARY_REVISION,
    selection,
    boards: selection.boards,
    attempts: ATTEMPTS[selection.boards],
    answers,
    currentGuess: "",
    guesses: [],
    solvedAt: answers.map(() => null),
    status: "active",
  });
}

function withIssue(state: MultiwordState, issue: MultiwordIssue): MultiwordState {
  return freeze({ ...state, issue });
}

function clearIssue(state: MultiwordState): Omit<MultiwordState, "issue"> {
  const { issue: _issue, ...rest } = state;
  return rest;
}

export function reduceMultiword(state: MultiwordState, action: MultiwordAction): MultiwordState {
  if (action.type === "restart") return createMultiword(action.selection);
  if (state.status !== "active") return withIssue(state, "game-complete");
  if (action.type === "enter") {
    const letter = action.letter.toLowerCase();
    if (!LETTER.test(letter) || [...action.letter].length !== 1)
      return withIssue(state, "invalid-letter");
    if (state.currentGuess.length === CODEWORD_LENGTH) return withIssue(state, "row-full");
    return freeze({ ...clearIssue(state), currentGuess: `${state.currentGuess}${letter}` });
  }
  if (action.type === "erase")
    return freeze({ ...clearIssue(state), currentGuess: state.currentGuess.slice(0, -1) });

  if (state.currentGuess.length !== CODEWORD_LENGTH) return withIssue(state, "incomplete-guess");
  if (!accepted.has(state.currentGuess)) return withIssue(state, "invalid-guess");

  const index = state.guesses.length;
  const solvedAt = state.solvedAt.map((solved, board) =>
    solved === null && state.answers[board] === state.currentGuess ? index : solved,
  );
  const guesses = [...state.guesses, state.currentGuess];
  const status: MultiwordStatus = solvedAt.every((solved) => solved !== null)
    ? "won"
    : guesses.length === state.attempts
      ? "lost"
      : "active";
  return freeze({ ...clearIssue(state), currentGuess: "", guesses, solvedAt, status });
}

export function multiwordBoard(state: MultiwordState, board: number): MultiwordBoardView {
  const answer = state.answers[board];
  const solvedAt = state.solvedAt[board];
  if (answer === undefined || solvedAt === undefined)
    throw new RangeError(`Multiword has no board ${board}`);
  const seen = solvedAt === null ? state.guesses : state.guesses.slice(0, solvedAt + 1);
  return Object.freeze({
    solved: solvedAt !== null,
    rows: Object.freeze(
      seen.map((word) => Object.freeze({ word, score: scoreCodewordGuess(answer, word) })),
    ),
  });
}

/** The strongest evidence for each letter on each board, from the guesses that board has seen. */
export function multiwordLetterEvidence(
  state: MultiwordState,
): ReadonlyMap<string, readonly (CodewordScore | undefined)[]> {
  const result = new Map<string, (CodewordScore | undefined)[]>();
  const strength: Record<CodewordScore, number> = { absent: 1, present: 2, exact: 3 };
  for (let board = 0; board < state.boards; board += 1) {
    for (const row of multiwordBoard(state, board).rows) {
      [...row.word].forEach((letter, position) => {
        const perBoard =
          result.get(letter) ?? Array.from({ length: state.boards }, () => undefined);
        const score = row.score[position] as CodewordScore;
        const before = perBoard[board];
        if (before === undefined || strength[score] > strength[before]) perBoard[board] = score;
        result.set(letter, perBoard);
      });
    }
  }
  return result;
}
