// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";

import {
  createMultiword,
  MULTIWORD_BOARD_COUNTS,
  type MultiwordAction,
  type MultiwordSelection,
  type MultiwordState,
  multiwordAnswers,
  multiwordAttempts,
  multiwordBoard,
  reduceMultiword,
} from "../src/multiword.ts";
import {
  createEmptyMultiwordSave,
  MULTIWORD_MAX_COMPLETIONS,
  MultiwordSaveError,
  mergeMultiwordCompletions,
  multiwordSaveJson,
  multiwordStatistics,
  parseMultiwordSave,
  updateMultiwordSave,
} from "../src/multiword-state.ts";

const practice = (boards: 2 | 4 | 8, seed = 7): MultiwordSelection => ({
  kind: "practice",
  algorithmVersion: 1,
  boards,
  seed,
});
const daily = (boards: 2 | 4 | 8, utcDate: string): MultiwordSelection => ({
  kind: "daily",
  algorithmVersion: 1,
  boards,
  utcDate,
});

function guess(state: MultiwordState, word: string): MultiwordState {
  let next = state;
  for (const letter of word) next = reduceMultiword(next, { type: "enter", letter });
  return reduceMultiword(next, { type: "submit" });
}

test("answers are deterministic, distinct, and sized by board count", () => {
  for (const boards of MULTIWORD_BOARD_COUNTS) {
    const answers = multiwordAnswers(practice(boards));
    assert.equal(answers.length, boards);
    assert.equal(new Set(answers).size, boards);
    assert.deepEqual(answers, multiwordAnswers(practice(boards)));
  }
  assert.notDeepEqual(multiwordAnswers(practice(4, 1)), multiwordAnswers(practice(4, 2)));
  assert.deepEqual(multiwordAttempts(2), 7);
  assert.deepEqual([multiwordAttempts(4), multiwordAttempts(8)], [9, 13]);
  assert.throws(() => multiwordAnswers(daily(4, "2026-02-30")), /valid/);
  assert.throws(() => multiwordAnswers({ ...practice(4), boards: 3 as 4 }), /2, 4, or 8/);
});

test("one guess is scored on every board and a solved board stops", () => {
  let state = createMultiword(practice(4));
  const [first, second] = state.answers as [string, string];
  state = guess(state, first);
  assert.equal(state.solvedAt[0], 0);
  assert.equal(state.status, "active");
  state = guess(state, second);
  assert.equal(state.solvedAt[1], 1);
  assert.equal(multiwordBoard(state, 0).rows.length, 1);
  assert.equal(multiwordBoard(state, 0).solved, true);
  assert.equal(multiwordBoard(state, 1).rows.length, 2);
  assert.equal(multiwordBoard(state, 2).rows.length, 2);
  assert.equal(multiwordBoard(state, 2).solved, false);
});

test("solving every board wins and later input is rejected", () => {
  let state = createMultiword(practice(2));
  for (const answer of state.answers) state = guess(state, answer);
  assert.equal(state.status, "won");
  assert.equal(reduceMultiword(state, { type: "erase" }).issue, "game-complete");
});

test("running out of guesses loses and keeps solved boards", () => {
  let state = createMultiword(practice(2));
  const wrong = ["crane", "toils", "bumpy", "fudge", "sight", "known", "pound"].filter(
    (word) => !state.answers.includes(word),
  );
  state = guess(state, state.answers[0] as string);
  for (const word of wrong.slice(0, 6)) state = guess(state, word);
  assert.equal(state.guesses.length, 7);
  assert.equal(state.status, "lost");
  assert.equal(state.solvedAt[0], 0);
});

test("invalid input leaves the state usable", () => {
  const state = createMultiword(practice(4));
  assert.equal(reduceMultiword(state, { type: "submit" }).issue, "incomplete-guess");
  assert.equal(guess(state, "zzzzz").issue, "invalid-guess");
  assert.equal(reduceMultiword(state, { type: "enter", letter: "1" }).issue, "invalid-letter");
  const full = [..."crane"].reduce<MultiwordState>(
    (next, letter) => reduceMultiword(next, { type: "enter", letter }),
    state,
  );
  assert.equal(reduceMultiword(full, { type: "enter", letter: "a" }).issue, "row-full");
  const restart: MultiwordAction = { type: "restart", selection: practice(2) };
  assert.equal(reduceMultiword(full, restart).boards, 2);
});

test("saves replay exactly and record each completion once", () => {
  let state = createMultiword(daily(2, "2026-03-01"));
  const prefs = { puzzle: "daily", boards: 2 } as const;
  let document = createEmptyMultiwordSave();
  for (const answer of state.answers) {
    state = guess(state, answer);
    document = updateMultiwordSave(document, state, prefs).document;
  }
  assert.equal(state.status, "won");
  assert.equal(document.completions.length, 1);
  assert.equal(updateMultiwordSave(document, state, prefs).completionAdded, false);
  const restored = parseMultiwordSave(multiwordSaveJson(document));
  assert.deepEqual(restored.state?.solvedAt, state.solvedAt);
  assert.equal(restored.completionRecorded, true);
  const stats = multiwordStatistics(document, 2);
  assert.deepEqual(
    [stats.played, stats.wins, stats.bestAttempts, stats.currentStreak],
    [1, 1, 2, 1],
  );
  assert.equal(multiwordStatistics(document, 8).played, 0);
});

test("a tampered or future save fails loudly", () => {
  const state = guess(createMultiword(practice(4)), "crane");
  const { document } = updateMultiwordSave(createEmptyMultiwordSave(), state, {
    puzzle: "practice",
    boards: 4,
  });
  const json = multiwordSaveJson(document) as { game: { status: string } };
  json.game.status = "won";
  assert.throws(() => parseMultiwordSave(json as never), MultiwordSaveError);
  assert.throws(() => parseMultiwordSave({ version: 9 }), { code: "future-version" });
  assert.throws(
    () =>
      parseMultiwordSave({
        version: 1,
        preferences: { puzzle: "daily", boards: 3 },
        completions: [],
      }),
    {
      code: "corrupt",
    },
  );
});

test("merging keeps the newest save and unions completions", () => {
  const prefs = { puzzle: "practice", boards: 2 } as const;
  const finish = (seed: number) => {
    let state = createMultiword(practice(2, seed));
    for (const answer of state.answers) state = guess(state, answer);
    return state;
  };
  const left = updateMultiwordSave(createEmptyMultiwordSave(), finish(1), prefs).document;
  const right = updateMultiwordSave(createEmptyMultiwordSave(), finish(2), prefs).document;
  assert.equal(mergeMultiwordCompletions(left, right).completions.length, 2);
});

test("a full history drops the oldest practice record and keeps daily records", () => {
  const records = Array.from({ length: MULTIWORD_MAX_COMPLETIONS }, (_, index) => ({
    key: index === 0 ? "daily:2020-01-01:2" : `practice:old:${index}`,
    boards: 2 as const,
    won: true,
    attempts: 3,
    solved: 2,
    ...(index === 0 ? { dailyDate: "2020-01-01" } : {}),
  }));
  const full = { ...createEmptyMultiwordSave(), completions: records };
  let state = createMultiword(practice(2, 99));
  for (const answer of state.answers) state = guess(state, answer);
  const { document, completionAdded } = updateMultiwordSave(full, state, {
    puzzle: "practice",
    boards: 2,
  });
  assert.equal(completionAdded, true);
  assert.equal(document.completions.length, MULTIWORD_MAX_COMPLETIONS);
  assert.equal(document.completions[0]?.key, "daily:2020-01-01:2");
  assert.equal(
    document.completions.some((record) => record.key === "practice:old:1"),
    false,
  );
  assert.equal(document.completions.at(-1)?.won, true);
  assert.equal(
    mergeMultiwordCompletions(full, document).completions.length,
    MULTIWORD_MAX_COMPLETIONS,
  );
});
