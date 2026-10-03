// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import {
  type ActivityFrame,
  type ActivityInput,
  type ActivitySpan,
  ActivityStorageError,
  type ActivityViewport,
  type TerminalActivity,
} from "@axl/extension-api";

import { CODEWORD_LENGTH, type CodewordScore } from "./codeword.ts";
import {
  createMultiword,
  MULTIWORD_BOARD_COUNTS,
  type MultiwordBoards,
  type MultiwordIssue,
  type MultiwordSelection,
  type MultiwordState,
  multiwordBoard,
  multiwordLetterEvidence,
  reduceMultiword,
} from "./multiword.ts";
import {
  createEmptyMultiwordSave,
  MULTIWORD_STORAGE_SCHEMA_VERSION,
  type MultiwordPreferences,
  type MultiwordSaveDocument,
  MultiwordSaveError,
  mergeMultiwordCompletions,
  multiwordSaveJson,
  multiwordStatistics,
  parseMultiwordSave,
  updateMultiwordSave,
} from "./multiword-state.ts";

const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"] as const;
/** Two-character tiles, one column between tiles, two between boards. */
const BOARD_WIDTH = CODEWORD_LENGTH * 3 - 1;
const BOARD_GAP = 2;
/** Title, status, three keyboard rows, and one help row. */
const CHROME_ROWS = 6;

export interface MultiwordActivityOptions {
  readonly selection?: MultiwordSelection;
  readonly utcDate?: () => string;
  readonly practiceSeed?: () => number;
}

type Panel = "loading" | "picker" | "game" | "storage-error";

const span = (
  text: string,
  style: ActivitySpan["style"] = "text",
  emphasis: ActivitySpan["emphasis"] = "none",
  background?: ActivitySpan["background"],
): ActivitySpan =>
  Object.freeze({
    text,
    style,
    emphasis,
    ...(background === undefined ? {} : { background }),
  });

const line = (...spans: readonly ActivitySpan[]): readonly ActivitySpan[] => Object.freeze(spans);
const textLine = (text: string, width: number, style: ActivitySpan["style"] = "text") =>
  line(span(text.slice(0, Math.max(0, width)), style));

const ISSUE_TEXT: Readonly<Record<MultiwordIssue, string>> = Object.freeze({
  "invalid-letter": "Use letters A-Z.",
  "row-full": "The row already has five letters.",
  "incomplete-guess": "Enter five letters.",
  "invalid-guess": "Not in the accepted word list.",
  "game-complete": "This puzzle is complete.",
});

/** The widest even grid of boards that fits, or the shape that needs the least extra space. */
export function multiwordTerminalLayout(
  viewport: ActivityViewport,
  boards: number,
  attempts: number,
): {
  readonly columns: number;
  readonly fits: boolean;
  readonly width: number;
  readonly height: number;
} {
  let smallest: { columns: number; width: number; height: number } | undefined;
  for (let columns = boards; columns >= 1; columns -= 1) {
    if (boards % columns !== 0) continue;
    const rows = Math.ceil(boards / columns);
    const width = columns * BOARD_WIDTH + (columns - 1) * BOARD_GAP;
    const height = rows * attempts + (rows - 1) + CHROME_ROWS;
    if (width <= viewport.width && height <= viewport.height)
      return { columns, fits: true, width, height };
    if (smallest === undefined || width + height < smallest.width + smallest.height)
      smallest = { columns, width, height };
  }
  return { ...(smallest as { columns: number; width: number; height: number }), fits: false };
}

function tile(
  letter: string,
  score: CodewordScore | undefined,
  typing: boolean,
  textOnly: boolean,
): ActivitySpan {
  const mark = textOnly
    ? score === "exact"
      ? "✓"
      : score === "present"
        ? "~"
        : score === "absent"
          ? "-"
          : " "
    : " ";
  const text = `${letter === "" ? "·" : letter.toUpperCase()}${letter === "" ? " " : mark}`;
  if (score === "exact") return span(text, "text", "strong", "success");
  if (score === "present") return span(text, "text", "strong", "warning");
  if (score === "absent") return span(text, "muted", "none", "surface");
  return letter === ""
    ? span(text, "muted")
    : span(text, "text", "strong", typing ? "selection" : undefined);
}

function renderGame(
  viewport: ActivityViewport,
  state: MultiwordState,
  document: MultiwordSaveDocument,
  textOnly: boolean,
  warning: string | undefined,
): ActivityFrame {
  const layout = multiwordTerminalLayout(viewport, state.boards, state.attempts);
  const solved = state.solvedAt.filter((value) => value !== null).length;
  const head = `Multiword · ${state.selection.kind === "daily" ? "Daily" : "Practice"} · ${state.boards} boards · Solved ${solved}/${state.boards} · Guess ${Math.min(state.guesses.length + (state.status === "active" ? 1 : 0), state.attempts)}/${state.attempts}`;
  if (!layout.fits)
    return Object.freeze({
      lines: Object.freeze([
        textLine(head, viewport.width, "accent"),
        textLine(
          `${state.boards} boards need ${layout.width}x${layout.height} cells. Enlarge the terminal or pick fewer boards (Ctrl+P).`,
          viewport.width,
          "warning",
        ),
      ]),
      announcement: "Terminal too small for this board count",
    });

  const evidence = multiwordLetterEvidence(state);
  const unsolved = state.solvedAt.flatMap((at, board) => (at === null ? [board] : []));
  const lines: (readonly ActivitySpan[])[] = [textLine(head, viewport.width, "accent")];
  const boardRows: (readonly ActivitySpan[])[][] = [];
  for (let start = 0; start < state.boards; start += layout.columns) {
    const group = Array.from(
      { length: Math.min(layout.columns, state.boards - start) },
      (_, offset) => start + offset,
    );
    const views = group.map((board) => multiwordBoard(state, board));
    for (let row = 0; row < state.attempts; row += 1) {
      const spans: ActivitySpan[] = [];
      group.forEach((_, index) => {
        const view = views[index] as ReturnType<typeof multiwordBoard>;
        const submitted = view.rows[row];
        const typing = !view.solved && state.status === "active" && row === view.rows.length;
        const word = submitted?.word ?? (typing ? state.currentGuess : "");
        if (index > 0) spans.push(span(" ".repeat(BOARD_GAP)));
        for (let column = 0; column < CODEWORD_LENGTH; column += 1) {
          if (column > 0) spans.push(span(" "));
          spans.push(tile(word[column] ?? "", submitted?.score[column], typing, textOnly));
        }
      });
      boardRows.push([spans]);
    }
    if (start + layout.columns < state.boards) boardRows.push([[span(" ")]]);
  }
  for (const [row] of boardRows) lines.push(row as readonly ActivitySpan[]);

  const keyLine = (letters: string): readonly ActivitySpan[] => {
    const pieces: ActivitySpan[] = [];
    for (const letter of letters) {
      const perBoard = evidence.get(letter);
      const live = unsolved.map((board) => perBoard?.[board]);
      const best = live.includes("exact")
        ? "exact"
        : live.includes("present")
          ? "present"
          : live.length > 0 && live.every((score) => score === "absent")
            ? "absent"
            : undefined;
      pieces.push(
        span(
          `${letter.toUpperCase()} `,
          best === "exact"
            ? "success"
            : best === "present"
              ? "warning"
              : best === "absent"
                ? "muted"
                : "text",
          best === undefined || best === "absent" ? "none" : "strong",
        ),
      );
    }
    return line(...pieces);
  };
  for (const letters of KEYBOARD_ROWS) lines.push(keyLine(letters));

  const stats = multiwordStatistics(document, state.boards);
  const missed = state.answers
    .filter((_, board) => state.solvedAt[board] === null)
    .map((word) => word.toUpperCase())
    .join(" ");
  const status =
    state.status === "won"
      ? `SOLVED ALL ${state.boards} IN ${state.guesses.length} · Win ${stats.winRate}% · Streak ${stats.currentStreak}`
      : state.status === "lost"
        ? `OUT OF GUESSES · MISSED: ${missed}`
        : (warning ?? (state.issue === undefined ? "" : ISSUE_TEXT[state.issue]));
  lines.push(
    textLine(
      status,
      viewport.width,
      state.status === "won" ? "success" : state.status === "lost" ? "error" : "warning",
    ),
  );
  lines.push(
    textLine(
      state.status === "active"
        ? "Type a word · Enter submit · Backspace erase · Ctrl+P menu"
        : "Ctrl+P: new game",
      viewport.width,
      "muted",
    ),
  );
  return Object.freeze({
    lines: Object.freeze(lines.slice(0, viewport.height)),
    announcement: status === "" ? `${solved} of ${state.boards} boards solved` : status,
  });
}

function renderPicker(
  viewport: ActivityViewport,
  preferences: MultiwordPreferences,
  row: number,
  hasGame: boolean,
): ActivityFrame {
  const option = (index: number, label: string, value: string) =>
    textLine(
      `${row === index ? "▸ " : "  "}${label}: ${value}`,
      viewport.width,
      row === index ? "selection" : "text",
    );
  return Object.freeze({
    lines: Object.freeze([
      textLine("MULTIWORD", viewport.width, "accent"),
      textLine("One guess counts on every board. Solve them all.", viewport.width, "muted"),
      textLine("", viewport.width),
      option(0, "Puzzle", preferences.puzzle === "daily" ? "Daily" : "Practice"),
      option(1, "Boards", `${preferences.boards}`),
      textLine(
        `${row === 2 ? "▸ " : "  "}${hasGame ? "Start new game" : "Play"}`,
        viewport.width,
        row === 2 ? "selection" : "text",
      ),
      textLine("", viewport.width),
      textLine("Up/Down choose · Left/Right change · Enter select", viewport.width, "muted"),
    ]),
    announcement: "Multiword menu",
  });
}

export function multiwordActivity(options: MultiwordActivityOptions = {}): TerminalActivity {
  return {
    id: "axl.lounge.multiword",
    name: "Multiword",
    description: "Solve two, four, or eight Wordle boards with the same guesses",
    category: "game",
    minimumViewport: Object.freeze({ width: 30, height: 14 }),
    create(context) {
      const utcDate = options.utcDate ?? (() => new Date().toISOString().slice(0, 10));
      const practiceSeed = options.practiceSeed ?? (() => Date.now());
      let document = createEmptyMultiwordSave();
      let preferences: MultiwordPreferences = document.preferences;
      let state: MultiwordState | undefined =
        options.selection === undefined ? undefined : createMultiword(options.selection);
      let panel: Panel =
        options.selection === undefined && context.storage ? "loading" : state ? "game" : "picker";
      let pickerRow = 2;
      let revision: number | null = null;
      let storageBlocked = false;
      let saveWarning: string | undefined;
      let storageError: { readonly message: string; readonly canReset: boolean } | undefined;
      let writeQueue: Promise<void> = Promise.resolve();
      let live = true;

      const invalidate = (): void => {
        if (live) context.invalidate();
      };
      const aborted = (error: unknown): boolean =>
        error instanceof ActivityStorageError && error.code === "aborted";
      const failure = (cause: unknown): string =>
        cause instanceof Error ? cause.message : String(cause);

      const queueWrite = (snapshot: MultiwordSaveDocument, completionAdded: boolean): void => {
        const storage = context.storage;
        if (storage === undefined) return;
        const mergeCompletion = async (): Promise<void> => {
          const latest = await storage.read();
          if (latest === undefined) return;
          if (latest.schemaVersion !== MULTIWORD_STORAGE_SCHEMA_VERSION)
            throw new MultiwordSaveError(
              "corrupt",
              `Unsupported Multiword storage schema ${latest.schemaVersion}`,
            );
          const merged = mergeMultiwordCompletions(
            parseMultiwordSave(latest.value).document,
            snapshot,
          );
          revision = (
            await storage.write(
              latest.revision,
              MULTIWORD_STORAGE_SCHEMA_VERSION,
              multiwordSaveJson(merged),
            )
          ).revision;
        };
        writeQueue = writeQueue
          .then(async () => {
            if (storageBlocked) {
              if (completionAdded) await mergeCompletion();
              return;
            }
            try {
              revision = (
                await storage.write(
                  revision,
                  MULTIWORD_STORAGE_SCHEMA_VERSION,
                  multiwordSaveJson(snapshot),
                )
              ).revision;
            } catch (error) {
              if (aborted(error)) return;
              storageBlocked = true;
              if (error instanceof ActivityStorageError && error.code === "conflict") {
                if (completionAdded) await mergeCompletion();
                saveWarning = "Save conflict · newer board kept on disk";
              } else saveWarning = failure(error);
              invalidate();
            }
          })
          .catch((error: unknown) => {
            if (aborted(error)) return;
            storageBlocked = true;
            saveWarning = failure(error);
            invalidate();
          });
      };

      const persist = (): void => {
        if (state === undefined) return;
        try {
          const updated = updateMultiwordSave(document, state, preferences);
          document = updated.document;
          queueWrite(document, updated.completionAdded);
        } catch (error) {
          saveWarning = failure(error);
        }
      };

      const start = (): void => {
        const selection: MultiwordSelection =
          preferences.puzzle === "daily"
            ? { kind: "daily", algorithmVersion: 1, boards: preferences.boards, utcDate: utcDate() }
            : {
                kind: "practice",
                algorithmVersion: 1,
                boards: preferences.boards,
                seed: practiceSeed(),
              };
        const sameDaily =
          selection.kind === "daily" &&
          state?.selection.kind === "daily" &&
          state.selection.utcDate === selection.utcDate &&
          state.boards === selection.boards;
        if (!sameDaily) state = createMultiword(selection);
        panel = "game";
        if (!storageBlocked) saveWarning = undefined;
        persist();
        invalidate();
      };

      const load = (): void => {
        const signal = context.signal;
        writeQueue = (async () => {
          const stored = await context.storage?.read(signal);
          if (stored !== undefined) {
            revision = stored.revision;
            if (stored.schemaVersion !== MULTIWORD_STORAGE_SCHEMA_VERSION)
              throw new MultiwordSaveError(
                stored.schemaVersion > MULTIWORD_STORAGE_SCHEMA_VERSION
                  ? "future-version"
                  : "corrupt",
                `Unsupported Multiword storage schema ${stored.schemaVersion}`,
              );
            const parsed = parseMultiwordSave(stored.value);
            document = parsed.document;
            state = parsed.state;
            preferences = parsed.document.preferences;
          }
          panel = state === undefined ? "picker" : "game";
          invalidate();
        })().catch((error: unknown) => {
          if (signal.aborted) return;
          storageError = { message: failure(error), canReset: revision !== null };
          panel = "storage-error";
          invalidate();
        });
      };
      if (panel === "loading") load();

      return {
        render(viewport) {
          const textOnly = context.presentation().textOnly;
          if (panel === "loading")
            return Object.freeze({
              lines: Object.freeze([textLine("Loading Multiword…", viewport.width, "muted")]),
            });
          if (panel === "storage-error" && storageError !== undefined)
            return Object.freeze({
              lines: Object.freeze([
                textLine("MULTIWORD SAVE CANNOT BE OPENED", viewport.width, "error"),
                textLine(storageError.message, viewport.width),
                textLine(
                  storageError.canReset
                    ? "Press R to erase the save and start over."
                    : "Fix the save file, then reopen.",
                  viewport.width,
                  "muted",
                ),
              ]),
            });
          if (panel === "picker" || state === undefined)
            return renderPicker(viewport, preferences, pickerRow, state !== undefined);
          return renderGame(viewport, state, document, textOnly, saveWarning);
        },
        handleInput(input: ActivityInput) {
          if (input.type !== "key" || input.repeat || panel === "loading") return;
          if (panel === "storage-error") {
            if (storageError?.canReset && input.key.toLowerCase() === "r" && revision !== null) {
              void context.storage
                ?.reset(revision)
                .then(() => {
                  revision = null;
                  document = createEmptyMultiwordSave();
                  preferences = document.preferences;
                  state = undefined;
                  storageError = undefined;
                  storageBlocked = false;
                  saveWarning = undefined;
                  panel = "picker";
                  invalidate();
                })
                .catch((error: unknown) => {
                  if (aborted(error)) return;
                  storageError = { message: failure(error), canReset: true };
                  invalidate();
                });
            }
            return true;
          }
          if (input.ctrl && input.key.toLowerCase() === "p") {
            panel = "picker";
            invalidate();
            return true;
          }
          if (panel === "picker") {
            if (input.key === "up" || input.key === "down")
              pickerRow = (pickerRow + (input.key === "down" ? 1 : 2)) % 3;
            else if (input.key === "left" || input.key === "right") {
              if (pickerRow === 0)
                preferences = {
                  ...preferences,
                  puzzle: preferences.puzzle === "daily" ? "practice" : "daily",
                };
              else if (pickerRow === 1) {
                const index = MULTIWORD_BOARD_COUNTS.indexOf(preferences.boards);
                const step = input.key === "right" ? 1 : MULTIWORD_BOARD_COUNTS.length - 1;
                preferences = {
                  ...preferences,
                  boards: MULTIWORD_BOARD_COUNTS[
                    (index + step) % MULTIWORD_BOARD_COUNTS.length
                  ] as MultiwordBoards,
                };
              }
            } else if (input.key === "enter") {
              if (pickerRow === 2) start();
              else pickerRow = pickerRow + 1;
            } else if (input.key === "escape" && state !== undefined) panel = "game";
            else return;
            invalidate();
            return true;
          }
          if (state === undefined || input.ctrl || input.alt) return;
          const before = state;
          if (input.key === "backspace") state = reduceMultiword(state, { type: "erase" });
          else if (input.key === "enter") state = reduceMultiword(state, { type: "submit" });
          else if (/^[a-z]$/iu.test(input.key))
            state = reduceMultiword(state, { type: "enter", letter: input.key });
          else return;
          if (state !== before) {
            if (state.issue === undefined) persist();
            invalidate();
          }
          return true;
        },
        pause: () => {
          live = false;
        },
        resume: () => {
          if (panel === "loading") load();
          live = true;
        },
        serialize: () => multiwordSaveJson(document),
        dispose: () => {
          live = false;
          return writeQueue;
        },
      };
    },
  };
}
