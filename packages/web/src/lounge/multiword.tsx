// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import {
  CODEWORD_LENGTH,
  type CodewordScore,
  createMultiword,
  createEmptyMultiwordSave,
  MULTIWORD_BOARD_COUNTS,
  MULTIWORD_STORAGE_SCHEMA_VERSION,
  type MultiwordAction,
  type MultiwordBoards,
  type MultiwordIssue,
  type MultiwordPreferences,
  type MultiwordSaveDocument,
  type MultiwordSelection,
  type MultiwordState,
  mergeMultiwordCompletions,
  multiwordBoard,
  multiwordLetterEvidence,
  multiwordSaveJson,
  multiwordStatistics,
  parseMultiwordSave,
  reduceMultiword,
  updateMultiwordSave,
} from "@axl/extension-lounge";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { multiwordLayout } from "./multiword-layout.ts";
import type { SaveSlot } from "./save-slot.ts";
import {
  GameLoading,
  type GameProps,
  IconButton,
  loungeScope,
  Overlay,
  SaveNotice,
  Segmented,
  StorageProblem,
  Toast,
} from "./shared.tsx";
import { useSlot } from "./use-slot.ts";

const ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["enter", "z", "x", "c", "v", "b", "n", "m", "back"],
] as const;
const MARK: Record<CodewordScore, string> = { exact: "✓", present: "•", absent: "" };
const today = (): string => new Date().toISOString().slice(0, 10);

const ISSUE: Partial<Record<MultiwordIssue, string>> = {
  "incomplete-guess": "Not enough letters",
  "invalid-guess": "Not in the word list",
};

const parse = (value: Parameters<typeof parseMultiwordSave>[0]) => parseMultiwordSave(value);
const merge = (
  latest: Parameters<typeof parseMultiwordSave>[0],
  mine: Parameters<typeof parseMultiwordSave>[0],
) =>
  multiwordSaveJson(
    mergeMultiwordCompletions(parseMultiwordSave(latest).document, parseMultiwordSave(mine).document),
  );

export default function Multiword(props: GameProps): React.JSX.Element {
  const { phase, notice, reload, reset } = useSlot({
    storage: props.storage,
    scope: loungeScope("axl.lounge.multiword"),
    schemaVersion: MULTIWORD_STORAGE_SCHEMA_VERSION,
    parse,
    merge,
  });
  if (phase.kind === "loading") return <GameLoading name="Multiword" />;
  if (phase.kind === "error")
    return (
      <StorageProblem
        message={phase.message}
        canReset={phase.canReset}
        onReset={() => void reset()}
        onRetry={reload}
      />
    );
  return (
    <>
      <SaveNotice notice={notice} onReload={reload} />
      <Boards {...props} slot={phase.slot} loaded={phase.loaded} />
    </>
  );
}

function Boards({
  slot,
  loaded,
  motion,
  markers,
  autoFocus,
}: GameProps & {
  readonly slot: SaveSlot;
  readonly loaded: ReturnType<typeof parse> | undefined;
}): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const fit = useRef<HTMLDivElement>(null);
  const doc = useRef<MultiwordSaveDocument>(loaded?.document ?? createEmptyMultiwordSave());
  const [state, setState] = useState<MultiwordState | undefined>(loaded?.state);
  const stateRef = useRef(state);
  const [prefs, setPrefs] = useState<MultiwordPreferences>(doc.current.preferences);
  const [menu, setMenu] = useState(loaded?.state === undefined);
  const [stats, setStats] = useState(false);
  const [toast, setToast] = useState<string>();
  const [shake, setShake] = useState(0);
  const [revealRow, setRevealRow] = useState<number>();
  const [showResult, setShowResult] = useState(
    loaded?.state !== undefined && loaded.state.status !== "active",
  );
  const [size, setSize] = useState<{ width: number; height: number }>();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const resultTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (autoFocus) root.current?.focus({ preventScroll: true });
    return () => {
      clearTimeout(toastTimer.current);
      clearTimeout(resultTimer.current);
    };
  }, [autoFocus]);

  useLayoutEffect(() => {
    const element = fit.current;
    if (element === null) return;
    const measure = (): void => {
      const style = getComputedStyle(element);
      setSize({
        width: element.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight),
        height: element.clientHeight - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const say = (text: string): void => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), 1_800);
  };

  const commit = (next: MultiwordState, nextPrefs = prefs): void => {
    stateRef.current = next;
    setState(next);
    try {
      const updated = updateMultiwordSave(doc.current, next, nextPrefs);
      doc.current = updated.document;
      slot.save(multiwordSaveJson(updated.document), updated.completionAdded);
    } catch (cause) {
      say(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const act = (action: MultiwordAction): void => {
    const current = stateRef.current;
    if (current === undefined || current.status !== "active") return;
    const next = reduceMultiword(current, action);
    if (next === current) return;
    if (next.issue !== undefined) {
      const text = ISSUE[next.issue];
      if (text !== undefined) {
        say(text);
        setShake((value) => value + 1);
      }
      stateRef.current = next;
      setState(next);
      return;
    }
    if (next.guesses.length > current.guesses.length) {
      setRevealRow(current.guesses.length);
      if (next.status !== "active") {
        setShowResult(false);
        clearTimeout(resultTimer.current);
        resultTimer.current = setTimeout(() => setShowResult(true), motion ? 1_800 : 200);
      }
    }
    commit(next);
  };

  const begin = (nextPrefs: MultiwordPreferences): void => {
    const selection: MultiwordSelection =
      nextPrefs.puzzle === "daily"
        ? { kind: "daily", algorithmVersion: 1, boards: nextPrefs.boards, utcDate: today() }
        : { kind: "practice", algorithmVersion: 1, boards: nextPrefs.boards, seed: Date.now() };
    const existing = stateRef.current;
    const same =
      selection.kind === "daily" &&
      existing?.selection.kind === "daily" &&
      existing.selection.utcDate === selection.utcDate &&
      existing.boards === selection.boards;
    setPrefs(nextPrefs);
    setMenu(false);
    clearTimeout(resultTimer.current);
    setRevealRow(undefined);
    if (same && existing !== undefined) {
      setShowResult(existing.status !== "active");
      commit(existing, nextPrefs);
      return;
    }
    setShowResult(false);
    commit(createMultiword(selection), nextPrefs);
  };

  const onKey = (event: React.KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || menu) return;
    if (event.key === "Enter") {
      event.preventDefault();
      act({ type: "submit" });
    } else if (event.key === "Backspace") {
      event.preventDefault();
      act({ type: "erase" });
    } else if (/^[a-z]$/iu.test(event.key)) {
      event.preventDefault();
      act({ type: "enter", letter: event.key.toLowerCase() });
    }
  };

  const boards = state?.boards ?? prefs.boards;
  const attempts = state?.attempts ?? 7;
  const keyHeight = size === undefined ? 34 : Math.round(Math.min(40, Math.max(26, size.height * 0.075)));
  const layout = useMemo(
    () =>
      size === undefined
        ? undefined
        : multiwordLayout(size.width, size.height - (3 * keyHeight + 24) - 8, boards, attempts),
    [size, boards, attempts, keyHeight],
  );
  const evidence = useMemo(() => (state === undefined ? undefined : multiwordLetterEvidence(state)), [state]);
  const summary = multiwordStatistics(doc.current, boards);
  const finished = state !== undefined && state.status !== "active";
  const solvedCount = state?.solvedAt.filter((solved) => solved !== null).length ?? 0;
  const label = state?.selection.kind === "daily" ? "Daily" : "Practice";

  return (
    // biome-ignore lint/a11y/useSemanticElements: the boards handle typing for the whole game
    <div
      ref={root}
      className="lg lg-multiword"
      role="application"
      aria-label="Multiword"
      tabIndex={0}
      data-markers={markers}
      onKeyDown={onKey}
      onPointerDown={(event) => {
        if (!(event.target as HTMLElement).closest("button")) root.current?.focus();
      }}
    >
      <div className="lg-bar">
        <div className="lg-title">
          <strong>Multiword</strong>
          {state !== undefined && (
            <span className="lg-sub" style={{ textTransform: "none" }}>
              {label} · {boards} boards
            </span>
          )}
        </div>
        <div className="lg-scores">
          {state !== undefined && (
            <>
              <div>
                <small>Solved</small>
                <b>
                  {solvedCount}/{boards}
                </b>
              </div>
              <div>
                <small>Guesses</small>
                <b>
                  {state.guesses.length}/{attempts}
                </b>
              </div>
            </>
          )}
        </div>
        <div className="lg-tools">
          <IconButton icon="chart" label="Statistics" onClick={() => setStats(true)} />
          <IconButton icon="plus" label="New game" onClick={() => setMenu(true)} />
        </div>
      </div>

      <div ref={fit} className="lg-fit">
        {state !== undefined && layout !== undefined && evidence !== undefined && (
          <>
            <div className="mw-scroll">
            <div
              className="mw-boards"
              style={
                {
                  "--t": `${layout.tile}px`,
                  gridTemplateColumns: `repeat(${layout.columns}, max-content)`,
                } as React.CSSProperties
              }
            >
              {Array.from({ length: boards }, (_, board) => {
                const view = multiwordBoard(state, board);
                const typing = !view.solved && state.status === "active";
                return (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: boards are positional
                    key={board}
                    className={`mw-board${view.solved ? " solved" : ""}`}
                    role="grid"
                    aria-label={`Board ${board + 1}${view.solved ? ", solved" : ""}`}
                  >
                    {Array.from({ length: attempts }, (_, row) => {
                      const submitted = view.rows[row];
                      const live = typing && row === view.rows.length;
                      const word = submitted?.word ?? (live ? state.currentGuess : "");
                      return (
                        <div
                          key={live ? `live-${shake}` : row}
                          role="row"
                          className={`mw-row${live && shake > 0 ? " shake" : ""}`}
                        >
                          {Array.from({ length: CODEWORD_LENGTH }, (_, column) => {
                            const letter = word[column]?.toUpperCase() ?? "";
                            const score = submitted?.score[column];
                            const reveal = motion && submitted !== undefined && revealRow === row;
                            return (
                              <div
                                // biome-ignore lint/suspicious/noArrayIndexKey: tiles are positional
                                key={column}
                                role="gridcell"
                                className={`lg-tile${score === undefined ? "" : ` ${score}`}${letter !== "" && score === undefined ? " filled" : ""}${reveal ? " reveal" : ""}`}
                                style={{ "--i": column } as React.CSSProperties}
                              >
                                <span>{letter}</span>
                                {markers && score !== undefined && <i aria-hidden="true">{MARK[score]}</i>}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            </div>

            <div className="lg-keys mw-keys" aria-label="Keyboard" style={{ "--k": `${keyHeight}px` } as React.CSSProperties}>
              {ROWS.map((keys) => (
                <div key={keys.join("")} className="lg-keys-row">
                  {keys.map((key) => {
                    const wide = key === "enter" || key === "back";
                    const perBoard = evidence.get(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        tabIndex={-1}
                        className={`lg-key mw-key${wide ? " wide" : ""}`}
                        aria-label={key === "back" ? "Delete" : key === "enter" ? "Enter" : key}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() =>
                          act(
                            key === "enter"
                              ? { type: "submit" }
                              : key === "back"
                                ? { type: "erase" }
                                : { type: "enter", letter: key },
                          )
                        }
                      >
                        <span>{key === "enter" ? "Enter" : key === "back" ? "⌫" : key.toUpperCase()}</span>
                        {!wide && (
                          <span className="mw-seg" aria-hidden="true">
                            {Array.from({ length: boards }, (_, board) => (
                              // biome-ignore lint/suspicious/noArrayIndexKey: boards are positional
                              <i key={board} className={perBoard?.[board] ?? ""} />
                            ))}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <Toast text={toast} />

      {menu && (
        <Overlay
          title="New Multiword"
          actions={
            <>
              {state !== undefined && (
                <button type="button" className="lg-btn" onClick={() => setMenu(false)}>
                  Cancel
                </button>
              )}
              <button type="button" className="lg-btn primary" onClick={() => begin(prefs)}>
                Play
              </button>
            </>
          }
        >
          <p className="lg-hint">Every guess counts on all boards at once. Solve them all.</p>
          <div className="lg-field">
            <span>Boards</span>
            <Segmented<`${MultiwordBoards}`>
              label="Boards"
              value={`${prefs.boards}`}
              options={MULTIWORD_BOARD_COUNTS.map((count) => ({
                value: `${count}` as `${MultiwordBoards}`,
                label: `${count} boards`,
              }))}
              onChange={(value) => setPrefs({ ...prefs, boards: Number(value) as MultiwordBoards })}
            />
          </div>
          <div className="lg-field">
            <span>Puzzle</span>
            <Segmented
              label="Puzzle"
              value={prefs.puzzle}
              options={[
                { value: "daily", label: "Daily" },
                { value: "practice", label: "Practice" },
              ]}
              onChange={(puzzle) => setPrefs({ ...prefs, puzzle })}
            />
          </div>
          <p className="lg-hint small">
            2 boards get 7 guesses, 4 get 9, and 8 get 13. Daily is the same set all day (UTC).
          </p>
        </Overlay>
      )}

      {!menu && finished && showResult && state !== undefined && (
        <Overlay
          title={
            state.status === "won"
              ? `Solved all ${boards} in ${state.guesses.length}`
              : `${solvedCount} of ${boards} solved`
          }
          tone={state.status === "won" ? "win" : "lose"}
          actions={
            <>
              <button type="button" className="lg-btn" onClick={() => setShowResult(false)}>
                View boards
              </button>
              <button
                type="button"
                className="lg-btn primary"
                onClick={() => begin({ ...prefs, puzzle: "practice" })}
              >
                Play practice
              </button>
            </>
          }
        >
          {state.status === "lost" && (
            <p className="lg-answer">
              Missed:{" "}
              <strong>
                {state.answers
                  .filter((_, board) => state.solvedAt[board] === null)
                  .map((word) => word.toUpperCase())
                  .join(" ")}
              </strong>
            </p>
          )}
          <Summary summary={summary} />
        </Overlay>
      )}

      {stats && !menu && (
        <Overlay
          title={`${boards}-board statistics`}
          actions={
            <button type="button" className="lg-btn primary" onClick={() => setStats(false)}>
              Done
            </button>
          }
        >
          <Summary summary={summary} />
        </Overlay>
      )}
    </div>
  );
}

function Summary({ summary }: { readonly summary: ReturnType<typeof multiwordStatistics> }) {
  return (
    <dl className="lg-stats">
      <div>
        <dt>Played</dt>
        <dd>{summary.played}</dd>
      </div>
      <div>
        <dt>Win rate</dt>
        <dd>{summary.winRate}%</dd>
      </div>
      <div>
        <dt>Streak</dt>
        <dd>{summary.currentStreak}</dd>
      </div>
      <div>
        <dt>Best</dt>
        <dd>{summary.bestAttempts ?? "–"}</dd>
      </div>
    </dl>
  );
}
