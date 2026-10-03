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

import {
  createHoneycomb,
  type HoneycombIssue,
  type HoneycombSelection,
  type HoneycombState,
  honeycombRank,
  isHoneycombPangram,
  reduceHoneycomb,
} from "./honeycomb.ts";
import {
  createEmptyHoneycombSave,
  HONEYCOMB_STORAGE_SCHEMA_VERSION,
  type HoneycombPreferences,
  type HoneycombSaveDocument,
  HoneycombSaveError,
  honeycombSaveJson,
  honeycombStatistics,
  mergeHoneycombHistory,
  parseHoneycombSave,
  updateHoneycombSave,
} from "./honeycomb-state.ts";

export interface HoneycombActivityOptions {
  readonly selection?: HoneycombSelection;
  readonly utcDate?: () => string;
  readonly practiceSeed?: () => number;
}

type Panel = "loading" | "picker" | "game" | "storage-error";

const ISSUE_TEXT: Readonly<Record<HoneycombIssue, string>> = Object.freeze({
  "invalid-letter": "That letter is not in the hive.",
  "word-full": "Too long.",
  "too-short": "Words need four letters.",
  "missing-center": "Every word needs the center letter.",
  "not-in-list": "Not in the word list.",
  "already-found": "Already found.",
});

const span = (
  text: string,
  style: ActivitySpan["style"] = "text",
  emphasis: ActivitySpan["emphasis"] = "none",
  background?: ActivitySpan["background"],
): ActivitySpan =>
  Object.freeze({ text, style, emphasis, ...(background === undefined ? {} : { background }) });
const line = (...spans: readonly ActivitySpan[]): readonly ActivitySpan[] => Object.freeze(spans);
const textLine = (text: string, width: number, style: ActivitySpan["style"] = "text") =>
  line(span(text.slice(0, Math.max(0, width)), style));

function centered(spans: readonly ActivitySpan[], width: number): readonly ActivitySpan[] {
  const used = spans.reduce((total, item) => total + item.text.length, 0);
  return line(span(" ".repeat(Math.max(0, Math.floor((width - used) / 2)))), ...spans);
}

function wrapWords(words: readonly string[], width: number, letters: string): ActivitySpan[][] {
  const rows: ActivitySpan[][] = [[]];
  let used = 0;
  for (const word of words) {
    if (used > 0 && used + word.length + 1 > width) {
      rows.push([]);
      used = 0;
    }
    const row = rows[rows.length - 1] as ActivitySpan[];
    if (used > 0) row.push(span(" "));
    row.push(
      isHoneycombPangram(word, letters) ? span(word, "accent", "strong") : span(word, "text"),
    );
    used += word.length + (used > 0 ? 1 : 0);
  }
  return rows;
}

function cellSpan(letter: string, center: boolean, textOnly: boolean): ActivitySpan {
  const text = center ? `[${letter.toUpperCase()}]` : ` ${letter.toUpperCase()} `;
  return center
    ? span(textOnly ? text : ` ${letter.toUpperCase()} `, "text", "strong", "accent")
    : span(text, "text", "strong", "surface");
}

function renderGame(
  viewport: ActivityViewport,
  state: HoneycombState,
  textOnly: boolean,
  warning: string | undefined,
): ActivityFrame {
  const rank = honeycombRank(state.score, state.maxScore);
  const [a, b, c, d, e, f] = state.outer as [string, string, string, string, string, string];
  const gap = span(" ");
  const hive = [
    centered([cellSpan(a, false, textOnly), gap, cellSpan(b, false, textOnly)], viewport.width),
    centered(
      [
        cellSpan(c, false, textOnly),
        gap,
        cellSpan(state.center, true, textOnly),
        gap,
        cellSpan(d, false, textOnly),
      ],
      viewport.width,
    ),
    centered([cellSpan(e, false, textOnly), gap, cellSpan(f, false, textOnly)], viewport.width),
  ];
  const typed = [...state.currentWord].map((letter) =>
    span(letter.toUpperCase(), letter === state.center ? "accent" : "text", "strong"),
  );
  const status = warning ?? (state.issue === undefined ? "" : ISSUE_TEXT[state.issue]);
  const found = wrapWords([...state.found].reverse(), viewport.width, state.letters);
  const lines: (readonly ActivitySpan[])[] = [
    textLine(
      `Honeycomb · ${state.selection.kind === "daily" ? "Daily" : "Practice"} · ${rank.name} · ${state.score} points${rank.nextAt === null ? "" : ` (next ${rank.nextAt})`}`,
      viewport.width,
      "accent",
    ),
    ...hive,
    centered(typed.length === 0 ? [span("type or press letters", "muted")] : typed, viewport.width),
    textLine(status, viewport.width, "warning"),
    textLine(`${state.found.length} of ${state.wordCount} words`, viewport.width, "muted"),
    ...found.map((row) => line(...row)),
    textLine("Enter · Space shuffle · Ctrl+P menu", viewport.width, "muted"),
  ];
  // Keep the help row visible when the found list is long.
  if (lines.length > viewport.height) {
    const help = lines[lines.length - 1] as readonly ActivitySpan[];
    lines.splice(viewport.height - 1, lines.length - viewport.height + 1, help);
  }
  return Object.freeze({
    lines: Object.freeze(lines),
    announcement: `${rank.name}, ${state.score} points, ${state.found.length} of ${state.wordCount} words`,
  });
}

function renderPicker(
  viewport: ActivityViewport,
  preferences: HoneycombPreferences,
  row: number,
  hasGame: boolean,
  document: HoneycombSaveDocument,
): ActivityFrame {
  const stats = honeycombStatistics(document);
  const option = (index: number, text: string) =>
    textLine(
      `${row === index ? "▸ " : "  "}${text}`,
      viewport.width,
      row === index ? "selection" : "text",
    );
  return Object.freeze({
    lines: Object.freeze([
      textLine("HONEYCOMB", viewport.width, "accent"),
      textLine(
        "Make words from seven letters. Every word needs the center letter.",
        viewport.width,
        "muted",
      ),
      textLine("", viewport.width),
      option(0, `Puzzle: ${preferences.puzzle === "daily" ? "Daily" : "Practice"}`),
      option(1, hasGame ? "Continue or start" : "Play"),
      textLine("", viewport.width),
      textLine(
        `Played ${stats.played} · Average ${Math.round(stats.averageShare * 100)}% · Pangrams ${stats.pangrams}`,
        viewport.width,
        "muted",
      ),
      textLine("Up/Down choose · Left/Right change · Enter select", viewport.width, "muted"),
    ]),
    announcement: "Honeycomb menu",
  });
}

export function honeycombActivity(options: HoneycombActivityOptions = {}): TerminalActivity {
  return {
    id: "axl.lounge.honeycomb",
    name: "Honeycomb",
    description: "Make words from seven letters, always using the center one",
    category: "game",
    minimumViewport: Object.freeze({ width: 36, height: 12 }),
    create(context) {
      const utcDate = options.utcDate ?? (() => new Date().toISOString().slice(0, 10));
      const practiceSeed = options.practiceSeed ?? (() => Date.now());
      let document = createEmptyHoneycombSave();
      let preferences: HoneycombPreferences = document.preferences;
      let state: HoneycombState | undefined =
        options.selection === undefined ? undefined : createHoneycomb(options.selection);
      let panel: Panel =
        options.selection === undefined && context.storage ? "loading" : state ? "game" : "picker";
      let pickerRow = 1;
      let revision: number | null = null;
      let blocked = false;
      let warning: string | undefined;
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

      const queueWrite = (snapshot: HoneycombSaveDocument): void => {
        const storage = context.storage;
        if (storage === undefined) return;
        writeQueue = writeQueue
          .then(async () => {
            if (blocked) return;
            try {
              revision = (
                await storage.write(
                  revision,
                  HONEYCOMB_STORAGE_SCHEMA_VERSION,
                  honeycombSaveJson(snapshot),
                )
              ).revision;
            } catch (error) {
              if (aborted(error)) return;
              blocked = true;
              if (error instanceof ActivityStorageError && error.code === "conflict") {
                const latest = await storage.read();
                if (
                  latest !== undefined &&
                  latest.schemaVersion === HONEYCOMB_STORAGE_SCHEMA_VERSION
                ) {
                  const merged = mergeHoneycombHistory(
                    parseHoneycombSave(latest.value).document,
                    snapshot,
                  );
                  revision = (
                    await storage.write(
                      latest.revision,
                      HONEYCOMB_STORAGE_SCHEMA_VERSION,
                      honeycombSaveJson(merged),
                    )
                  ).revision;
                }
                warning = "Save conflict · newer puzzle kept on disk";
              } else warning = failure(error);
              invalidate();
            }
          })
          .catch((error: unknown) => {
            if (aborted(error)) return;
            blocked = true;
            warning = failure(error);
            invalidate();
          });
      };

      const persist = (): void => {
        if (state === undefined) return;
        document = updateHoneycombSave(document, state, preferences);
        queueWrite(document);
      };

      const start = (): void => {
        const selection: HoneycombSelection =
          preferences.puzzle === "daily"
            ? { kind: "daily", algorithmVersion: 1, utcDate: utcDate() }
            : { kind: "practice", algorithmVersion: 1, seed: practiceSeed() };
        const sameDaily =
          selection.kind === "daily" &&
          state?.selection.kind === "daily" &&
          state.selection.utcDate === selection.utcDate;
        if (!sameDaily) state = createHoneycomb(selection);
        panel = "game";
        if (!blocked) warning = undefined;
        persist();
        invalidate();
      };

      const load = (): void => {
        const signal = context.signal;
        writeQueue = (async () => {
          const stored = await context.storage?.read(signal);
          if (stored !== undefined) {
            revision = stored.revision;
            if (stored.schemaVersion !== HONEYCOMB_STORAGE_SCHEMA_VERSION)
              throw new HoneycombSaveError(
                stored.schemaVersion > HONEYCOMB_STORAGE_SCHEMA_VERSION
                  ? "future-version"
                  : "corrupt",
                `Unsupported Honeycomb storage schema ${stored.schemaVersion}`,
              );
            const parsed = parseHoneycombSave(stored.value);
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
          if (panel === "loading")
            return Object.freeze({
              lines: Object.freeze([textLine("Loading Honeycomb…", viewport.width, "muted")]),
            });
          if (panel === "storage-error" && storageError !== undefined)
            return Object.freeze({
              lines: Object.freeze([
                textLine("HONEYCOMB SAVE CANNOT BE OPENED", viewport.width, "error"),
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
            return renderPicker(viewport, preferences, pickerRow, state !== undefined, document);
          return renderGame(viewport, state, context.presentation().textOnly, warning);
        },
        handleInput(input: ActivityInput) {
          if (input.type !== "key" || input.repeat || panel === "loading") return;
          if (panel === "storage-error") {
            if (storageError?.canReset && input.key.toLowerCase() === "r" && revision !== null) {
              void context.storage
                ?.reset(revision)
                .then(() => {
                  revision = null;
                  document = createEmptyHoneycombSave();
                  preferences = document.preferences;
                  state = undefined;
                  storageError = undefined;
                  blocked = false;
                  warning = undefined;
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
            if (input.key === "up" || input.key === "down") pickerRow = pickerRow === 0 ? 1 : 0;
            else if ((input.key === "left" || input.key === "right") && pickerRow === 0)
              preferences = { puzzle: preferences.puzzle === "daily" ? "practice" : "daily" };
            else if (input.key === "enter") {
              if (pickerRow === 1) start();
              else pickerRow = 1;
            } else if (input.key === "escape" && state !== undefined) panel = "game";
            else return;
            invalidate();
            return true;
          }
          if (state === undefined || input.ctrl || input.alt) return;
          const before = state;
          if (input.key === "backspace") state = reduceHoneycomb(state, { type: "erase" });
          else if (input.key === "enter") state = reduceHoneycomb(state, { type: "submit" });
          else if (input.key === "space" || input.key === " ")
            state = reduceHoneycomb(state, { type: "shuffle" });
          else if (/^[a-z]$/iu.test(input.key))
            state = reduceHoneycomb(state, { type: "enter", letter: input.key });
          else return;
          if (state !== before) {
            if (state.issue === undefined) {
              if (!blocked) warning = undefined;
              persist();
            }
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
        serialize: () => honeycombSaveJson(document),
        dispose: () => {
          live = false;
          return writeQueue;
        },
      };
    },
  };
}
