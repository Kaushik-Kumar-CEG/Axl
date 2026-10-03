// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Provenance {
  readonly schemaVersion: number;
  readonly wordListRevision: string;
  readonly review: { readonly excluded: readonly string[] };
  readonly file: { readonly path: string; readonly count: number; readonly sha256: string };
  readonly puzzles: { readonly count: number };
}

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROVENANCE_PATH = resolve(PACKAGE_ROOT, "data/honeycomb/provenance.json");
const TARGET_PATH = resolve(PACKAGE_ROOT, "src/honeycomb-data.generated.ts");
const CHECK_FLAG = `-${"-"}check`;
const CHUNK_WIDTH = 96;
const MIN_LENGTH = 4;
const MAX_LENGTH = 12;
const MIN_WORDS = 25;
const MAX_WORDS = 70;
const MAX_PANGRAMS = 3;
const TARGET_WORDS = 45;

const sha256 = (source: string): string => createHash("sha256").update(source).digest("hex");

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

function decode(provenance: Provenance): readonly string[] {
  const stored = readFileSync(resolve(PACKAGE_ROOT, provenance.file.path), "utf8");
  if (!stored.endsWith("\n") || stored.includes("\r") || stored.includes("\n\n"))
    throw new Error("Honeycomb words must use nonempty LF-terminated chunks");
  const lines = stored.trimEnd().split("\n");
  if (lines.some((line) => line.length > CHUNK_WIDTH || !/^[A-La-z]+$/u.test(line)))
    throw new Error("Honeycomb words contain an invalid chunk");
  const encoded = lines.join("");
  const words: string[] = [];
  let previous = "";
  for (const [, marker, suffix] of encoded.matchAll(/([A-L])([a-z]+)/gu)) {
    const prefix = (marker as string).charCodeAt(0) - 65;
    if (prefix > previous.length) throw new Error("Honeycomb words contain an invalid prefix");
    const word = previous.slice(0, prefix) + (suffix as string);
    if (
      word.length < MIN_LENGTH ||
      word.length > MAX_LENGTH ||
      (previous !== "" && previous >= word)
    )
      throw new Error(
        `Honeycomb words must be sorted, unique, and ${MIN_LENGTH} to ${MAX_LENGTH} letters: ${word}`,
      );
    words.push(word);
    previous = word;
  }
  if (!/^[A-L]/u.test(encoded) || encoded.replace(/[A-L][a-z]+/gu, "") !== "")
    throw new Error("Honeycomb words contain stray characters");
  if (words.length !== provenance.file.count)
    throw new Error("Honeycomb word count does not match");
  if (sha256(`${words.join("\n")}\n`) !== provenance.file.sha256)
    throw new Error("Honeycomb word checksum does not match");
  const present = new Set(words);
  for (const excluded of provenance.review.excluded)
    if (present.has(excluded)) throw new Error(`Excluded word ${excluded} is in the list`);
  return words;
}

/** One puzzle per qualifying letter set, ordered by a fixed hash and cut to the recorded count. */
function derivePuzzles(words: readonly string[], count: number): readonly string[] {
  const sets = new Set<string>();
  for (const word of words) {
    const letters = [...new Set(word)].sort();
    if (letters.length === 7 && !letters.includes("s")) sets.add(letters.join(""));
  }
  const puzzles: string[] = [];
  for (const letters of [...sets].sort()) {
    const allowed = new Set(letters);
    const valid = words.filter((word) => [...word].every((letter) => allowed.has(letter)));
    let best: { center: string; distance: number } | undefined;
    for (const center of letters) {
      const found = valid.filter((word) => word.includes(center));
      const pangrams = found.filter((word) => new Set(word).size === 7).length;
      if (
        found.length < MIN_WORDS ||
        found.length > MAX_WORDS ||
        pangrams < 1 ||
        pangrams > MAX_PANGRAMS
      )
        continue;
      const distance = Math.abs(found.length - TARGET_WORDS);
      if (best === undefined || distance < best.distance) best = { center, distance };
    }
    if (best !== undefined) puzzles.push(`${letters}${best.center}`);
  }
  return puzzles
    .map((puzzle) => ({ puzzle, order: hash32(`honeycomb:${puzzle}`) }))
    .sort((left, right) => left.order - right.order || (left.puzzle < right.puzzle ? -1 : 1))
    .slice(0, count)
    .map(({ puzzle }) => puzzle);
}

function generatedSource(): string {
  const text = readFileSync(PROVENANCE_PATH, "utf8");
  const provenance = JSON.parse(text) as Provenance;
  if (`${JSON.stringify(provenance, null, 2)}\n` !== text)
    throw new Error("Honeycomb provenance must be canonical JSON");
  if (provenance.schemaVersion !== 1) throw new Error("Unsupported provenance schema version");
  if (!/^esdb-\d{4}\.\d{2}\.\d{2}-axl-honeycomb-v\d+$/u.test(provenance.wordListRevision))
    throw new Error("Invalid Honeycomb word list revision");
  const words = decode(provenance);
  const puzzles = derivePuzzles(words, provenance.puzzles.count);
  if (puzzles.length !== provenance.puzzles.count)
    throw new Error(`Expected ${provenance.puzzles.count} puzzles, found ${puzzles.length}`);
  const chunks = readFileSync(resolve(PACKAGE_ROOT, provenance.file.path), "utf8")
    .trimEnd()
    .split("\n")
    .map((chunk) => `  ${JSON.stringify(chunk)},`)
    .join("\n");
  return `// SPDX-FileCopyrightText: 2000-2026 Kevin Atkinson
// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: LicenseRef-ESDB
// @generated by packages/extensions/lounge/scripts/generate-honeycomb.ts; do not edit.

export const HONEYCOMB_WORD_LIST_REVISION = ${JSON.stringify(provenance.wordListRevision)} as const;

const WORD_CHUNKS = [
${chunks}
] as const;

function decodeWords(chunks: readonly string[], expectedCount: number): readonly string[] {
  const encoded = chunks.join("");
  const words: string[] = [];
  let previous = "";
  for (const [, marker, suffix] of encoded.matchAll(/([A-L])([a-z]+)/gu)) {
    const prefix = (marker as string).charCodeAt(0) - 65;
    if (prefix > previous.length) throw new Error("Invalid generated Honeycomb prefix");
    const word = previous.slice(0, prefix) + (suffix as string);
    if (previous !== "" && previous >= word) throw new Error("Generated Honeycomb words are not sorted");
    words.push(word);
    previous = word;
  }
  if (words.length !== expectedCount) throw new Error("Generated Honeycomb word count mismatch");
  return Object.freeze(words);
}

/** Every word a player may enter, sorted. */
export const HONEYCOMB_WORDS = decodeWords(WORD_CHUNKS, ${words.length});

/** Seven sorted letters followed by the center letter. */
export const HONEYCOMB_PUZZLES: readonly string[] = Object.freeze([
${puzzles.map((puzzle) => `  ${JSON.stringify(puzzle)},`).join("\n")}
]);
`;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const source = generatedSource();
  if (process.argv[2] === CHECK_FLAG) {
    const target = resolve(process.cwd(), process.argv[3] ?? TARGET_PATH);
    if (target !== TARGET_PATH)
      throw new Error(`No Honeycomb output exists for ${relative(process.cwd(), target)}`);
    if (readFileSync(target, "utf8") !== source) process.exitCode = 1;
  } else writeFileSync(TARGET_PATH, source);
}
