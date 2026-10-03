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
  createNonogram,
  NONOGRAM_SIZES,
  type NonogramAction,
  type NonogramSize,
  type NonogramState,
  nonogramClues,
  nonogramLineDone,
  reduceNonogram,
} from "./nonogram.ts";
import {
  createEmptyNonogramSave,
  mergeNonogramSolved,
  NONOGRAM_STORAGE_SCHEMA_VERSION,
  type NonogramPreferences,
  type NonogramSaveDocument,
  NonogramSaveError,
  nonogramSaveJson,
  parseNonogramSave,
  updateNonogramSave,
} from "./nonogram-state.ts";

export interface NonogramActivityOptions {
  readonly size?: NonogramSize;
  readonly seed?: () => number;
}

type Panel = "loading" | "picker" | "game" | "storage-error";

const CELL = 3;
const GROUP = 5;
/** Title, a blank row, and the status and help rows. */
const CHROME_ROWS = 4;

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

/** Extra width and rows for the blank separator after every fifth line. */
const separators = (size: number): number => Math.floor((size - 1) / GROUP);

/** Size a board needs: left clues, the grid, top clues, and the rows around them. */
export function nonogramTerminalSize(state: Pick<NonogramState, "fixtureId" | "size">) {
  const { rows, columns } = nonogramClues(state.fixtureId);
  const clueWidth = Math.max(...rows.map((clue) => clue.length * 3), 1);
  const clueHeight = Math.max(...columns.map((clue) => clue.length), 1);
  return {
    clueWidth,
    clueHeight,
    width: clueWidth + 1 + state.size * CELL + separators(state.size),
    height: clueHeight + state.size + separators(state.size) + CHROME_ROWS,
  };
}

function renderGame(
  viewport: ActivityViewport,
  state: NonogramState,
  cursor: number,
  textOnly: boolean,
  message: string | undefined,
): ActivityFrame {
  const need = nonogramTerminalSize(state);
  const head = `Nonogram · ${state.size}×${state.size} · ${state.hintCount} hints${state.status === "solved" ? " · SOLVED" : ""}`;
  if (need.width > viewport.width || need.height > viewport.height)
    return Object.freeze({
      lines: Object.freeze([
        textLine(head, viewport.width, "accent"),
        textLine(
          `This puzzle needs ${need.width}x${need.height} cells. Enlarge the terminal or pick a smaller size (Ctrl+P).`,
          viewport.width,
          "warning",
        ),
      ]),
      announcement: "Terminal too small for this puzzle",
    });
  const { rows, columns } = nonogramClues(state.fixtureId);
  const n = state.size;
  const lines: (readonly ActivitySpan[])[] = [textLine(head, viewport.width, "accent")];
  const gutter = " ".repeat(need.clueWidth + 1);
  const cursorRow = Math.floor(cursor / n);
  const cursorColumn = cursor % n;
  for (let level = 0; level < need.clueHeight; level += 1) {
    const spans: ActivitySpan[] = [span(gutter)];
    columns.forEach((clue, column) => {
      const value = clue[clue.length - need.clueHeight + level];
      const done = nonogramLineDone(state, "column", column);
      spans.push(
        span(
          (value === undefined ? "" : String(value)).padStart(CELL - 1).padEnd(CELL),
          done ? "muted" : column === cursorColumn ? "accent" : "text",
          done ? "none" : "strong",
        ),
      );
      if ((column + 1) % GROUP === 0 && column < n - 1) spans.push(span(" "));
    });
    lines.push(line(...spans));
  }
  for (let row = 0; row < n; row += 1) {
    const clue = rows[row] as readonly number[];
    const done = nonogramLineDone(state, "row", row);
    const spans: ActivitySpan[] = [
      span(
        `${clue
          .map((value) => String(value).padStart(2))
          .join(" ")
          .padStart(need.clueWidth)} `,
        done ? "muted" : row === cursorRow ? "accent" : "text",
        done ? "none" : "strong",
      ),
    ];
    for (let column = 0; column < n; column += 1) {
      const index = row * n + column;
      const value = state.cells[index];
      const at = index === cursor;
      const emphasis = at ? "reverse" : value === 1 ? "strong" : "none";
      if (value === 1)
        spans.push(
          span(textOnly ? "[#]" : "   ", "text", emphasis, textOnly ? undefined : "accent"),
        );
      else if (value === 2)
        spans.push(span(" × ", "muted", emphasis, textOnly ? undefined : "surface"));
      else spans.push(span(" · ", "muted", emphasis));
      if ((column + 1) % GROUP === 0 && column < n - 1) spans.push(span(" "));
    }
    lines.push(line(...spans));
    if ((row + 1) % GROUP === 0 && row < n - 1) lines.push(line(span(" ")));
  }
  const status =
    state.status === "solved" ? "Picture complete · Ctrl+P for a new puzzle" : (message ?? "");
  lines.push(textLine(status, viewport.width, state.status === "solved" ? "success" : "warning"));
  lines.push(
    textLine(
      "Arrows move · Space fill · X mark · U undo · H hint · Ctrl+P menu",
      viewport.width,
      "muted",
    ),
  );
  return Object.freeze({
    lines: Object.freeze(lines.slice(0, viewport.height)),
    announcement:
      state.status === "solved"
        ? "Picture complete"
        : `Row ${cursorRow + 1}, column ${cursorColumn + 1}`,
  });
}

function renderPicker(
  viewport: ActivityViewport,
  preferences: NonogramPreferences,
  row: number,
  hasGame: boolean,
  solved: number,
): ActivityFrame {
  const option = (index: number, text: string) =>
    textLine(
      `${row === index ? "▸ " : "  "}${text}`,
      viewport.width,
      row === index ? "selection" : "text",
    );
  return Object.freeze({
    lines: Object.freeze([
      textLine("NONOGRAM", viewport.width, "accent"),
      textLine(
        "Use the number clues to fill the grid and reveal a picture.",
        viewport.width,
        "muted",
      ),
      textLine("", viewport.width),
      option(0, `Size: ${preferences.size}×${preferences.size}`),
      option(1, hasGame ? "New puzzle (the current one is kept until you start)" : "Play"),
      option(2, hasGame ? "Back to the puzzle" : "Quit menu"),
      textLine("", viewport.width),
      textLine(`Solved ${solved}`, viewport.width, "muted"),
      textLine("Up/Down choose · Left/Right change · Enter select", viewport.width, "muted"),
    ]),
    announcement: "Nonogram menu",
  });
}

export function nonogramActivity(options: NonogramActivityOptions = {}): TerminalActivity {
  return {
    id: "axl.lounge.nonogram",
    name: "Nonogram",
    description: "Fill the grid from number clues to reveal a picture",
    category: "game",
    minimumViewport: Object.freeze({ width: 30, height: 12 }),
    create(context) {
      const nextSeed = options.seed ?? (() => Date.now());
      let document = createEmptyNonogramSave();
      let preferences: NonogramPreferences = document.preferences;
      let state: NonogramState | undefined =
        options.size === undefined ? undefined : createNonogram(options.size, nextSeed());
      if (options.size !== undefined) preferences = { size: options.size };
      let panel: Panel =
        options.size === undefined && context.storage ? "loading" : state ? "game" : "picker";
      let pickerRow = 1;
      let cursor = 0;
      let revision: number | null = null;
      let blocked = false;
      let message: string | undefined;
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

      const queueWrite = (snapshot: NonogramSaveDocument): void => {
        const storage = context.storage;
        if (storage === undefined) return;
        writeQueue = writeQueue
          .then(async () => {
            if (blocked) return;
            try {
              revision = (
                await storage.write(
                  revision,
                  NONOGRAM_STORAGE_SCHEMA_VERSION,
                  nonogramSaveJson(snapshot),
                )
              ).revision;
            } catch (error) {
              if (aborted(error)) return;
              blocked = true;
              if (error instanceof ActivityStorageError && error.code === "conflict") {
                const latest = await storage.read();
                if (
                  latest !== undefined &&
                  latest.schemaVersion === NONOGRAM_STORAGE_SCHEMA_VERSION
                ) {
                  const merged = mergeNonogramSolved(
                    parseNonogramSave(latest.value).document,
                    snapshot,
                  );
                  revision = (
                    await storage.write(
                      latest.revision,
                      NONOGRAM_STORAGE_SCHEMA_VERSION,
                      nonogramSaveJson(merged),
                    )
                  ).revision;
                }
                message = "Save conflict · newer puzzle kept on disk";
              } else message = failure(error);
              invalidate();
            }
          })
          .catch((error: unknown) => {
            if (aborted(error)) return;
            blocked = true;
            message = failure(error);
            invalidate();
          });
      };

      const persist = (): void => {
        if (state === undefined) return;
        document = updateNonogramSave(document, state, preferences);
        queueWrite(document);
      };

      const start = (): void => {
        state = createNonogram(preferences.size, nextSeed(), document.solved);
        cursor = 0;
        panel = "game";
        if (!blocked) message = undefined;
        persist();
        invalidate();
      };

      const load = (): void => {
        const signal = context.signal;
        writeQueue = (async () => {
          const stored = await context.storage?.read(signal);
          if (stored !== undefined) {
            revision = stored.revision;
            if (stored.schemaVersion !== NONOGRAM_STORAGE_SCHEMA_VERSION)
              throw new NonogramSaveError(
                stored.schemaVersion > NONOGRAM_STORAGE_SCHEMA_VERSION
                  ? "future-version"
                  : "corrupt",
                `Unsupported Nonogram storage schema ${stored.schemaVersion}`,
              );
            const parsed = parseNonogramSave(stored.value);
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

      const apply = (action: NonogramAction): void => {
        if (state === undefined) return;
        const next = reduceNonogram(state, action);
        if (next === state) return;
        state = next;
        if (!blocked) message = undefined;
        persist();
      };

      return {
        render(viewport) {
          if (panel === "loading")
            return Object.freeze({
              lines: Object.freeze([textLine("Loading Nonogram…", viewport.width, "muted")]),
            });
          if (panel === "storage-error" && storageError !== undefined)
            return Object.freeze({
              lines: Object.freeze([
                textLine("NONOGRAM SAVE CANNOT BE OPENED", viewport.width, "error"),
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
            return renderPicker(
              viewport,
              preferences,
              pickerRow,
              state !== undefined,
              document.solved.length,
            );
          return renderGame(viewport, state, cursor, context.presentation().textOnly, message);
        },
        handleInput(input: ActivityInput) {
          if (input.type !== "key" || input.repeat || panel === "loading") return;
          if (panel === "storage-error") {
            if (storageError?.canReset && input.key.toLowerCase() === "r" && revision !== null) {
              void context.storage
                ?.reset(revision)
                .then(() => {
                  revision = null;
                  document = createEmptyNonogramSave();
                  preferences = document.preferences;
                  state = undefined;
                  storageError = undefined;
                  blocked = false;
                  message = undefined;
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
            if (input.key === "up") pickerRow = (pickerRow + 2) % 3;
            else if (input.key === "down") pickerRow = (pickerRow + 1) % 3;
            else if ((input.key === "left" || input.key === "right") && pickerRow === 0) {
              const index = NONOGRAM_SIZES.indexOf(preferences.size);
              const step = input.key === "right" ? 1 : NONOGRAM_SIZES.length - 1;
              preferences = {
                size: NONOGRAM_SIZES[(index + step) % NONOGRAM_SIZES.length] as NonogramSize,
              };
            } else if (input.key === "enter") {
              if (pickerRow === 1) start();
              else if (pickerRow === 2 && state !== undefined) panel = "game";
            } else if (input.key === "escape" && state !== undefined) panel = "game";
            else return;
            invalidate();
            return true;
          }
          if (state === undefined || input.ctrl || input.alt) return;
          const n = state.size;
          const key = input.key.toLowerCase();
          if (key === "up") cursor = cursor >= n ? cursor - n : cursor;
          else if (key === "down") cursor = cursor + n < n * n ? cursor + n : cursor;
          else if (key === "left") cursor = cursor % n > 0 ? cursor - 1 : cursor;
          else if (key === "right") cursor = cursor % n < n - 1 ? cursor + 1 : cursor;
          else if (key === " " || key === "enter")
            apply({ type: "paint", indices: [cursor], value: state.cells[cursor] === 1 ? 0 : 1 });
          else if (key === "x")
            apply({ type: "paint", indices: [cursor], value: state.cells[cursor] === 2 ? 0 : 2 });
          else if (key === "backspace") apply({ type: "paint", indices: [cursor], value: 0 });
          else if (key === "u") apply({ type: "undo" });
          else if (key === "h") apply({ type: "hint" });
          else return;
          invalidate();
          return true;
        },
        pause: () => {
          live = false;
        },
        resume: () => {
          if (panel === "loading") load();
          live = true;
        },
        serialize: () => nonogramSaveJson(document),
        dispose: () => {
          live = false;
          return writeQueue;
        },
      };
    },
  };
}
