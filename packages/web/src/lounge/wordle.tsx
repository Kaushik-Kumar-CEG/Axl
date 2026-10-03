// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import {
  CODEWORD_LENGTH,
  CODEWORD_MAX_ATTEMPTS,
  CODEWORD_STORAGE_SCHEMA_VERSION,
  type CodewordAction,
  type CodewordIssue,
  type CodewordPreferences,
  type CodewordSaveDocument,
  type CodewordScore,
  type CodewordState,
  codewordSaveJson,
  codewordStatistics,
  createCodewordGame,
  createEmptyCodewordSave,
  mergeCodewordCompletions,
  parseCodewordSave,
  reduceCodeword,
  updateCodewordSave,
} from "@axl/extension-lounge";
import { useEffect, useRef, useState } from "react";

import {
  type GameProps,
  GameLoading,
  IconButton,
  loungeScope,
  Overlay,
  SaveNotice,
  Segmented,
  StorageProblem,
  Toast,
} from "./shared.tsx";
import { useSlot } from "./use-slot.ts";
import type { SaveSlot } from "./save-slot.ts";

const ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["enter", "z", "x", "c", "v", "b", "n", "m", "back"],
] as const;

const MARK: Record<CodewordScore, string> = { exact: "✓", present: "•", absent: "" };
const RANK: Record<CodewordScore, number> = { absent: 0, present: 1, exact: 2 };

const today = (): string => new Date().toISOString().slice(0, 10);

function issueText(issue: CodewordIssue): string | undefined {
  switch (issue.code) {
    case "incomplete-guess":
      return "Not enough letters";
    case "invalid-guess":
      return "Not in the word list";
    case "hard-exact":
      return `Hard mode: ${issue.letter.toUpperCase()} must be in position ${issue.position + 1}`;
    case "hard-minimum":
      return `Hard mode: use at least ${issue.required} ${issue.letter.toUpperCase()}`;
    default:
      return undefined;
  }
}

function parse(value: Parameters<typeof parseCodewordSave>[0]) {
  return parseCodewordSave(value);
}

function merge(
  latest: Parameters<typeof parseCodewordSave>[0],
  mine: Parameters<typeof parseCodewordSave>[0],
) {
  return codewordSaveJson(
    mergeCodewordCompletions(parseCodewordSave(latest).document, parseCodewordSave(mine).document),
  );
}

export default function Wordle(props: GameProps): React.JSX.Element {
  const { phase, notice, reload, reset } = useSlot({
    storage: props.storage,
    scope: loungeScope("axl.lounge.codeword"),
    schemaVersion: CODEWORD_STORAGE_SCHEMA_VERSION,
    parse,
    merge,
  });
  if (phase.kind === "loading") return <GameLoading name="Wordle" />;
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
      <WordleBoard {...props} slot={phase.slot} loaded={phase.loaded} />
    </>
  );
}

function WordleBoard({
  slot,
  loaded,
  motion,
  markers,
  autoFocus,
}: GameProps & {
  readonly slot: SaveSlot;
  readonly loaded: ReturnType<typeof parseCodewordSave> | undefined;
}): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const doc = useRef<CodewordSaveDocument>(loaded?.document ?? createEmptyCodewordSave());
  const [state, setState] = useState<CodewordState | undefined>(loaded?.state);
  const stateRef = useRef(state);
  const [prefs, setPrefs] = useState<CodewordPreferences>(doc.current.preferences);
  const [menu, setMenu] = useState(loaded?.state === undefined);
  const [toast, setToast] = useState<string>();
  const [shake, setShake] = useState(0);
  const [revealRow, setRevealRow] = useState<number>();
  const [showResult, setShowResult] = useState(
    loaded?.state !== undefined && loaded.state.status !== "active",
  );
  const [stats, setStats] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (autoFocus) root.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const say = (text: string): void => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), 1_800);
  };

  const persist = (next: CodewordState, nextPrefs: CodewordPreferences): void => {
    try {
      const updated = updateCodewordSave(doc.current, next, nextPrefs);
      doc.current = updated.document;
      slot.save(codewordSaveJson(updated.document), updated.completionAdded);
    } catch (cause) {
      say(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const commit = (next: CodewordState, nextPrefs = prefs): void => {
    stateRef.current = next;
    setState(next);
    persist(next, nextPrefs);
  };

  const act = (action: CodewordAction): void => {
    const current = stateRef.current;
    if (current === undefined || current.status !== "active") return;
    const next = reduceCodeword(current, action);
    if (next === current) return;
    if (next.issue !== undefined) {
      const text = issueText(next.issue);
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
        setTimeout(() => setShowResult(true), motion ? 2_000 : 200);
      }
    }
    commit(next);
  };

  const begin = (nextPrefs: CodewordPreferences): void => {
    const selection =
      nextPrefs.puzzle === "daily"
        ? ({ kind: "daily", algorithmVersion: 1, utcDate: today() } as const)
        : ({ kind: "practice", algorithmVersion: 1, seed: Date.now() } as const);
    const existing = stateRef.current;
    const sameDaily =
      selection.kind === "daily" &&
      existing?.selection.kind === "daily" &&
      existing.selection.utcDate === selection.utcDate &&
      existing.difficulty === nextPrefs.difficulty;
    setPrefs(nextPrefs);
    setMenu(false);
    setRevealRow(undefined);
    if (sameDaily && existing !== undefined) {
      setShowResult(existing.status !== "active");
      persist(existing, nextPrefs);
      return;
    }
    setShowResult(false);
    commit(createCodewordGame(selection, nextPrefs.difficulty), nextPrefs);
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

  const known = new Map<string, CodewordScore>();
  for (const guess of state?.guesses ?? [])
    [...guess.word].forEach((letter, index) => {
      const score = guess.score[index] as CodewordScore;
      const before = known.get(letter);
      if (before === undefined || RANK[score] > RANK[before]) known.set(letter, score);
    });

  const rows = Array.from({ length: CODEWORD_MAX_ATTEMPTS }, (_, row) => {
    const guess = state?.guesses[row];
    const typing = state !== undefined && row === state.guesses.length && state.status === "active";
    const word = guess?.word ?? (typing ? state.currentGuess : "");
    return { row, guess, typing, word };
  });

  const summary = codewordStatistics(doc.current);
  const finished = state !== undefined && state.status !== "active";
  const label = state?.selection.kind === "daily" ? "Daily" : "Practice";

  return (
    // biome-ignore lint/a11y/useSemanticElements: the board handles typing for the whole game
    <div
      ref={root}
      className="lg lg-wordle"
      role="application"
      aria-label="Wordle"
      tabIndex={0}
      data-markers={markers}
      onKeyDown={onKey}
      onPointerDown={(event) => {
        if (!(event.target as HTMLElement).closest("button")) root.current?.focus();
      }}
    >
      <div className="lg-bar">
        <div className="lg-title">
          <strong>Wordle</strong>
          {state !== undefined && (
            <span className="lg-sub">
              {label}
              {state.difficulty === "hard" ? " · Hard" : ""}
            </span>
          )}
        </div>
        <div className="lg-tools">
          <IconButton icon="chart" label="Statistics" onClick={() => setStats(true)} />
          <IconButton icon="plus" label="New game" onClick={() => setMenu(true)} />
        </div>
      </div>

      <div className="lg-fit">
        <div className="lg-wordle-board" role="grid" aria-label="Guesses">
          {rows.map(({ row, guess, typing, word }) => (
            <div
              key={typing ? `typing-${shake}` : row}
              role="row"
              className={`lg-wordle-row${typing && shake > 0 ? " shake" : ""}`}
            >
              {Array.from({ length: CODEWORD_LENGTH }, (_, column) => {
                const letter = word[column]?.toUpperCase() ?? "";
                const score = guess?.score[column];
                const reveal = revealRow === row && motion && guess !== undefined;
                const won = reveal && state?.status === "won" && row === state.guesses.length - 1;
                return (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: tiles are positional
                    key={column}
                    role="gridcell"
                    className={`lg-tile${score === undefined ? "" : ` ${score}`}${letter !== "" && score === undefined ? " filled" : ""}${reveal ? " reveal" : ""}${won ? " win" : ""}`}
                    style={{ "--i": column } as React.CSSProperties}
                    aria-label={
                      letter === "" ? "empty" : `${letter}${score === undefined ? "" : `, ${score === "exact" ? "correct" : score === "present" ? "wrong place" : "not in word"}`}`
                    }
                  >
                    <span>{letter}</span>
                    {markers && score !== undefined && (
                      <i aria-hidden="true">{MARK[score]}</i>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="lg-keys" aria-label="Keyboard">
          {ROWS.map((keys) => (
            <div key={keys.join("")} className="lg-keys-row">
              {keys.map((key) => {
                const score = known.get(key);
                const wide = key === "enter" || key === "back";
                return (
                  <button
                    key={key}
                    type="button"
                    tabIndex={-1}
                    className={`lg-key${wide ? " wide" : ""}${score === undefined ? "" : ` ${score}`}`}
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
                    {key === "enter" ? "Enter" : key === "back" ? "⌫" : key.toUpperCase()}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <Toast text={toast} />

      {menu && (
        <Overlay
          title="New Wordle"
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
          <p className="lg-hint">Guess the five-letter word in six tries.</p>
          <div className="lg-field">
            <span>Puzzle</span>
            <Segmented
              label="Puzzle"
              value={prefs.puzzle}
              options={[
                { value: "daily", label: "Daily word" },
                { value: "practice", label: "Practice" },
              ]}
              onChange={(puzzle) => setPrefs({ ...prefs, puzzle })}
            />
          </div>
          <div className="lg-field">
            <span>Difficulty</span>
            <Segmented
              label="Difficulty"
              value={prefs.difficulty}
              options={[
                { value: "normal", label: "Normal" },
                { value: "hard", label: "Hard" },
              ]}
              onChange={(difficulty) => setPrefs({ ...prefs, difficulty })}
            />
          </div>
          <p className="lg-hint small">
            Hard mode makes you reuse every revealed hint. Daily is the same word all day (UTC).
          </p>
        </Overlay>
      )}

      {!menu && finished && showResult && state !== undefined && (
        <Overlay
          title={state.status === "won" ? `Solved in ${state.guesses.length}` : "Out of guesses"}
          tone={state.status === "won" ? "win" : "lose"}
          actions={
            <>
              <button type="button" className="lg-btn" onClick={() => setShowResult(false)}>
                View board
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
              The word was <strong>{state.answer.toUpperCase()}</strong>
            </p>
          )}
          <Stats summary={summary} highlight={state.status === "won" ? state.guesses.length : 0} />
        </Overlay>
      )}

      {stats && !menu && (
        <Overlay
          title="Statistics"
          actions={
            <button type="button" className="lg-btn primary" onClick={() => setStats(false)}>
              Done
            </button>
          }
        >
          <Stats summary={summary} highlight={0} />
        </Overlay>
      )}
    </div>
  );
}

function Stats({
  summary,
  highlight,
}: {
  readonly summary: ReturnType<typeof codewordStatistics>;
  readonly highlight: number;
}): React.JSX.Element {
  const peak = Math.max(1, ...summary.guessDistribution);
  return (
    <>
      <dl className="lg-stats">
        <div>
          <dt>Played</dt>
          <dd>{summary.played}</dd>
        </div>
        <div>
          <dt>Win rate</dt>
          <dd>{Math.round(summary.winRate * 100)}%</dd>
        </div>
        <div>
          <dt>Streak</dt>
          <dd>{summary.currentStreak}</dd>
        </div>
        <div>
          <dt>Best</dt>
          <dd>{summary.maximumStreak}</dd>
        </div>
      </dl>
      <div className="lg-dist" aria-label="Guess distribution">
        {summary.guessDistribution.map((count, index) => (
          <div key={`${index + 1}`} className={highlight === index + 1 ? "now" : ""}>
            <span>{index + 1}</span>
            <b style={{ width: `${Math.max(8, (count / peak) * 100)}%` }}>{count}</b>
          </div>
        ))}
      </div>
    </>
  );
}
