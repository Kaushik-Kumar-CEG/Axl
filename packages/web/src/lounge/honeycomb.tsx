// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import {
  createEmptyHoneycombSave,
  createHoneycomb,
  HONEYCOMB_RANK_SHARES,
  HONEYCOMB_STORAGE_SCHEMA_VERSION,
  type HoneycombAction,
  type HoneycombIssue,
  type HoneycombPreferences,
  type HoneycombSaveDocument,
  type HoneycombSelection,
  type HoneycombState,
  honeycombPoints,
  honeycombRank,
  honeycombSaveJson,
  honeycombStatistics,
  isHoneycombPangram,
  mergeHoneycombHistory,
  parseHoneycombSave,
  reduceHoneycomb,
  updateHoneycombSave,
} from "@axl/extension-lounge";
import { useEffect, useRef, useState } from "react";

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

const today = (): string => new Date().toISOString().slice(0, 10);
const ISSUE: Record<HoneycombIssue, string | undefined> = {
  "invalid-letter": undefined,
  "word-full": "Too long",
  "too-short": "Too short",
  "missing-center": "Missing the center letter",
  "not-in-list": "Not in the word list",
  "already-found": "Already found",
};

/** Hex geometry for a pointy-top cell: six neighbors sit at 60 degree steps around the center. */
const GAP = 0.06;
const RING = 1 + GAP;
const WIDTH = 2 * RING + 1;
const HEX_HEIGHT = 2 / Math.sqrt(3);
const HEIGHT = 2 * RING * Math.sin(Math.PI / 3) + HEX_HEIGHT;

function cell(angle: number, radius = RING): React.CSSProperties {
  const x = WIDTH / 2 + radius * Math.cos(angle) - 0.5;
  const y = HEIGHT / 2 + radius * Math.sin(angle) - HEX_HEIGHT / 2;
  return {
    left: `${(x / WIDTH) * 100}%`,
    top: `${(y / HEIGHT) * 100}%`,
    width: `${(1 / WIDTH) * 100}%`,
    height: `${(HEX_HEIGHT / HEIGHT) * 100}%`,
  };
}

const parse = (value: Parameters<typeof parseHoneycombSave>[0]) => parseHoneycombSave(value);
const merge = (
  latest: Parameters<typeof parseHoneycombSave>[0],
  mine: Parameters<typeof parseHoneycombSave>[0],
) =>
  honeycombSaveJson(
    mergeHoneycombHistory(parseHoneycombSave(latest).document, parseHoneycombSave(mine).document),
  );

export default function Honeycomb(props: GameProps): React.JSX.Element {
  const { phase, notice, reload, reset } = useSlot({
    storage: props.storage,
    scope: loungeScope("axl.lounge.honeycomb"),
    schemaVersion: HONEYCOMB_STORAGE_SCHEMA_VERSION,
    parse,
    merge,
  });
  if (phase.kind === "loading") return <GameLoading name="Honeycomb" />;
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
      <Hive {...props} slot={phase.slot} loaded={phase.loaded} />
    </>
  );
}

function Hive({
  slot,
  loaded,
  autoFocus,
}: GameProps & {
  readonly slot: SaveSlot;
  readonly loaded: ReturnType<typeof parse> | undefined;
}): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const doc = useRef<HoneycombSaveDocument>(loaded?.document ?? createEmptyHoneycombSave());
  const [state, setState] = useState<HoneycombState | undefined>(loaded?.state);
  const stateRef = useRef(state);
  const [prefs, setPrefs] = useState<HoneycombPreferences>(doc.current.preferences);
  const [menu, setMenu] = useState(loaded?.state === undefined);
  const [stats, setStats] = useState(false);
  const [toast, setToast] = useState<string>();
  const [shake, setShake] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (autoFocus) root.current?.focus({ preventScroll: true });
    return () => clearTimeout(toastTimer.current);
  }, [autoFocus]);

  const say = (text: string): void => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), 1_600);
  };

  const commit = (next: HoneycombState, nextPrefs = prefs): void => {
    stateRef.current = next;
    setState(next);
    doc.current = updateHoneycombSave(doc.current, next, nextPrefs);
    slot.save(honeycombSaveJson(doc.current));
  };

  const act = (action: HoneycombAction): void => {
    const current = stateRef.current;
    if (current === undefined) return;
    const next = reduceHoneycomb(current, action);
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
    if (next.found.length > current.found.length) {
      const word = next.found[next.found.length - 1] as string;
      const points = honeycombPoints(word, next.letters);
      say(isHoneycombPangram(word, next.letters) ? `Pangram! +${points}` : `+${points}`);
    }
    commit(next);
  };

  const begin = (nextPrefs: HoneycombPreferences): void => {
    const selection: HoneycombSelection =
      nextPrefs.puzzle === "daily"
        ? { kind: "daily", algorithmVersion: 1, utcDate: today() }
        : { kind: "practice", algorithmVersion: 1, seed: Date.now() };
    const existing = stateRef.current;
    setPrefs(nextPrefs);
    setMenu(false);
    if (
      selection.kind === "daily" &&
      existing?.selection.kind === "daily" &&
      existing.selection.utcDate === selection.utcDate
    ) {
      commit(existing, nextPrefs);
      return;
    }
    commit(createHoneycomb(selection), nextPrefs);
  };

  const onKey = (event: React.KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || menu) return;
    if (event.key === "Enter") {
      event.preventDefault();
      act({ type: "submit" });
    } else if (event.key === "Backspace") {
      event.preventDefault();
      act({ type: "erase" });
    } else if (event.key === " ") {
      event.preventDefault();
      act({ type: "shuffle" });
    } else if (/^[a-z]$/iu.test(event.key)) {
      event.preventDefault();
      act({ type: "enter", letter: event.key.toLowerCase() });
    }
  };

  const rank = state === undefined ? undefined : honeycombRank(state.score, state.maxScore);
  const summary = honeycombStatistics(doc.current);
  const complete = state !== undefined && state.found.length === state.wordCount;
  const letterButton = (letter: string, style: React.CSSProperties, center: boolean) => (
    <button
      key={letter}
      type="button"
      tabIndex={-1}
      className={`hc-cell${center ? " center" : ""}`}
      style={style}
      aria-label={`${letter}${center ? ", required letter" : ""}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => act({ type: "enter", letter })}
    >
      {letter.toUpperCase()}
    </button>
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: the hive handles typing for the whole game
    <div
      ref={root}
      className="lg lg-honeycomb"
      role="application"
      aria-label="Honeycomb"
      tabIndex={0}
      onKeyDown={onKey}
      onPointerDown={(event) => {
        if (!(event.target as HTMLElement).closest("button")) root.current?.focus();
      }}
    >
      <div className="lg-bar">
        <div className="lg-title">
          <strong>Honeycomb</strong>
          {state !== undefined && (
            <span className="lg-sub" style={{ textTransform: "none" }}>
              {state.selection.kind === "daily" ? "Daily" : "Practice"}
            </span>
          )}
        </div>
        <div className="lg-tools">
          <IconButton icon="chart" label="Statistics" onClick={() => setStats(true)} />
          <IconButton icon="plus" label="New game" onClick={() => setMenu(true)} />
        </div>
      </div>

      {state !== undefined && rank !== undefined && (
        <div className="hc-rank">
          <div className="hc-rank-line">
            <strong>{rank.name}</strong>
            <span>
              {state.score} points
              {rank.nextAt === null ? "" : ` · next at ${rank.nextAt}`}
            </span>
          </div>
          <div
            className="hc-track"
            role="progressbar"
            aria-label="Score"
            aria-valuenow={state.score}
            aria-valuemin={0}
            aria-valuemax={state.maxScore}
          >
            <i style={{ width: `${(state.score / state.maxScore) * 100}%` }} />
            {HONEYCOMB_RANK_SHARES.map((share, index) => (
              <b
                key={share}
                className={index + 1 <= rank.index ? "reached" : ""}
                style={{ left: `${share * 100}%` }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="lg-fit hc-fit">
        {state !== undefined && (
          <>
            <div className="hc-play">
              <div key={`word-${shake}`} className={`hc-word${shake > 0 ? " shake" : ""}`} aria-live="polite">
                {state.currentWord === "" ? (
                  <span className="hc-hint">Type or tap letters</span>
                ) : (
                  [...state.currentWord].map((letter, index) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: letters can repeat
                      key={index}
                      className={letter === state.center ? "core" : ""}
                    >
                      {letter.toUpperCase()}
                    </span>
                  ))
                )}
              </div>
              <div className="hc-hive" role="group" aria-label="Letters">
                {state.outer.map((letter, index) =>
                  letterButton(letter, cell((Math.PI / 3) * index), false),
                )}
                {letterButton(state.center, cell(0, 0), true)}
              </div>
              <div className="hc-actions">
                <button type="button" className="lg-tool" onMouseDown={(e) => e.preventDefault()} onClick={() => act({ type: "erase" })}>
                  Delete
                </button>
                <IconButton icon="flip" label="Shuffle letters" text="Shuffle" onClick={() => act({ type: "shuffle" })} />
                <button type="button" className="lg-tool strong" onMouseDown={(e) => e.preventDefault()} onClick={() => act({ type: "submit" })}>
                  Enter
                </button>
              </div>
            </div>

            <div className="hc-found">
              <h3>
                {state.found.length} of {state.wordCount} words
              </h3>
              {state.found.length === 0 ? (
                <p className="lg-hint small">Words need four letters and the center letter.</p>
              ) : (
                <ul>
                  {[...state.found].reverse().map((word) => (
                    <li key={word} className={isHoneycombPangram(word, state.letters) ? "pangram" : ""}>
                      {word}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      <Toast text={toast} />

      {menu && (
        <Overlay
          title="New Honeycomb"
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
          <p className="lg-hint">Make words from seven letters. Every word needs the center letter.</p>
          <div className="lg-field">
            <span>Puzzle</span>
            <Segmented
              label="Puzzle"
              value={prefs.puzzle}
              options={[
                { value: "daily", label: "Daily" },
                { value: "practice", label: "Practice" },
              ]}
              onChange={(puzzle) => setPrefs({ puzzle })}
            />
          </div>
          <p className="lg-hint small">
            Four letters score 1 point, longer words score their length, and a word using all seven
            letters adds 7. Letters can repeat. Daily is the same puzzle all day (UTC).
          </p>
        </Overlay>
      )}

      {complete && !menu && state !== undefined && (
        <Overlay
          title="Every word found"
          tone="win"
          actions={
            <button type="button" className="lg-btn primary" onClick={() => begin({ puzzle: "practice" })}>
              Play practice
            </button>
          }
        >
          <p className="lg-answer">
            <strong>{state.score}</strong> points
          </p>
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
          <dl className="lg-stats">
            <div>
              <dt>Played</dt>
              <dd>{summary.played}</dd>
            </div>
            <div>
              <dt>Average</dt>
              <dd>{Math.round(summary.averageShare * 100)}%</dd>
            </div>
            <div>
              <dt>Great+</dt>
              <dd>{summary.great}</dd>
            </div>
            <div>
              <dt>Pangrams</dt>
              <dd>{summary.pangrams}</dd>
            </div>
          </dl>
        </Overlay>
      )}
    </div>
  );
}
