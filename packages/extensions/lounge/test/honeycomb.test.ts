// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";

import {
  createHoneycomb,
  HONEYCOMB_PANGRAM_BONUS,
  type HoneycombSelection,
  type HoneycombState,
  honeycombAnswers,
  honeycombPoints,
  honeycombPuzzle,
  honeycombRank,
  isHoneycombPangram,
  reduceHoneycomb,
} from "../src/honeycomb.ts";
import { HONEYCOMB_PUZZLES, HONEYCOMB_WORDS } from "../src/honeycomb-data.generated.ts";
import {
  createEmptyHoneycombSave,
  HoneycombSaveError,
  honeycombSaveJson,
  honeycombStatistics,
  mergeHoneycombHistory,
  parseHoneycombSave,
  updateHoneycombSave,
} from "../src/honeycomb-state.ts";

const practice = (seed: number): HoneycombSelection => ({
  kind: "practice",
  algorithmVersion: 1,
  seed,
});

function submit(state: HoneycombState, word: string): HoneycombState {
  let next = state;
  for (const letter of word) next = reduceHoneycomb(next, { type: "enter", letter });
  return reduceHoneycomb(next, { type: "submit" });
}

test("the generated data is sorted, clean, and every puzzle is playable", () => {
  assert.ok(HONEYCOMB_WORDS.length > 30_000);
  assert.equal(new Set(HONEYCOMB_WORDS).size, HONEYCOMB_WORDS.length);
  assert.ok(HONEYCOMB_WORDS.every((word) => /^[a-z]{4,12}$/u.test(word)));
  assert.equal(HONEYCOMB_PUZZLES.length, 1_000);
  for (const entry of HONEYCOMB_PUZZLES.slice(0, 50)) {
    const letters = entry.slice(0, 7);
    const answers = honeycombAnswers(letters, entry.slice(7));
    assert.equal(new Set(letters).size, 7);
    assert.ok(!letters.includes("s"));
    assert.ok(answers.length >= 25 && answers.length <= 70);
    assert.ok(answers.some((word) => isHoneycombPangram(word, letters)));
  }
  for (const word of ["whore", "slut", "penis", "bitch"])
    assert.ok(!HONEYCOMB_WORDS.includes(word));
});

test("selection is deterministic and keeps the center among seven letters", () => {
  const a = honeycombPuzzle(practice(5));
  assert.deepEqual(a, honeycombPuzzle(practice(5)));
  assert.ok(a.letters.includes(a.center));
  const state = createHoneycomb(practice(5));
  assert.equal(state.outer.length, 6);
  assert.ok(!state.outer.includes(state.center));
  assert.throws(
    () => honeycombPuzzle({ kind: "daily", algorithmVersion: 1, utcDate: "2026-02-31" }),
    /valid/,
  );
});

test("scoring follows length with a pangram bonus", () => {
  assert.equal(honeycombPoints("lone", "abcdefg"), 1);
  assert.equal(honeycombPoints("lonely", "abcdefg"), 6);
  const { letters, center } = honeycombPuzzle(practice(9));
  const pangram = honeycombAnswers(letters, center).find((word) =>
    isHoneycombPangram(word, letters),
  ) as string;
  assert.equal(honeycombPoints(pangram, letters), pangram.length + HONEYCOMB_PANGRAM_BONUS);
});

test("valid words score once and invalid ones explain why", () => {
  let state = createHoneycomb(practice(3));
  const [first, second] = honeycombAnswers(state.letters, state.center) as [string, string];
  state = submit(state, first);
  assert.deepEqual(state.found, [first]);
  assert.equal(state.score, honeycombPoints(first, state.letters));
  assert.equal(submit(state, first).issue, "already-found");
  assert.equal(reduceHoneycomb(state, { type: "submit" }).issue, "too-short");
  assert.equal(reduceHoneycomb(state, { type: "enter", letter: "1" }).issue, "invalid-letter");
  const outerOnly = state.outer.slice(0, 4).join("");
  assert.equal(submit(state, outerOnly).issue, "missing-center");
  assert.equal(
    submit(state, `${state.center}${state.center}${state.center}${state.center}`).issue,
    "not-in-list",
  );
  assert.equal(submit(state, second).found.length, 2);
});

test("shuffling reorders only the outer letters and replays exactly", () => {
  let state = createHoneycomb(practice(3));
  const before = state.outer;
  state = reduceHoneycomb(state, { type: "shuffle" });
  assert.deepEqual([...state.outer].sort(), [...before].sort());
  assert.equal(state.shuffles, 1);
  const again = reduceHoneycomb(createHoneycomb(practice(3)), { type: "shuffle" });
  assert.deepEqual(again.outer, state.outer);
});

test("ranks rise with the score and the top needs every point", () => {
  assert.equal(honeycombRank(0, 200).name, "Newcomer");
  assert.equal(honeycombRank(100, 200).name, "Great");
  assert.equal(honeycombRank(200, 200).name, "Complete");
  assert.equal(honeycombRank(199, 200).name, "Master");
  assert.equal(honeycombRank(200, 200).nextAt, null);
});

test("saves replay exactly and merge keeps the higher score", () => {
  let state = createHoneycomb(practice(4));
  const words = honeycombAnswers(state.letters, state.center);
  for (const word of words.slice(0, 3)) state = submit(state, word);
  state = reduceHoneycomb(state, { type: "shuffle" });
  const document = updateHoneycombSave(createEmptyHoneycombSave(), state, { puzzle: "practice" });
  const restored = parseHoneycombSave(honeycombSaveJson(document));
  assert.deepEqual(restored.state?.found, state.found);
  assert.deepEqual(restored.state?.outer, state.outer);
  assert.equal(honeycombStatistics(document).played, 1);

  const lower = updateHoneycombSave(
    createEmptyHoneycombSave(),
    submit(createHoneycomb(practice(4)), words[0] as string),
    { puzzle: "practice" },
  );
  const merged = mergeHoneycombHistory(lower, document);
  assert.equal(merged.history[0]?.score, state.score);
});

test("a tampered or future save fails loudly", () => {
  const state = submit(
    createHoneycomb(practice(4)),
    honeycombAnswers(
      createHoneycomb(practice(4)).letters,
      createHoneycomb(practice(4)).center,
    )[0] as string,
  );
  const json = honeycombSaveJson(
    updateHoneycombSave(createEmptyHoneycombSave(), state, { puzzle: "practice" }),
  ) as { game: { found: string[] } };
  json.game.found = ["qqqqq"];
  assert.throws(() => parseHoneycombSave(json as never), HoneycombSaveError);
  assert.throws(() => parseHoneycombSave({ version: 9 }), { code: "future-version" });
});
