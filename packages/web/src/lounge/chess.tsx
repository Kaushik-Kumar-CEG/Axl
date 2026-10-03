// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import {
  CHESS_PUZZLE_STORAGE_SCHEMA_VERSION,
  type ChessPromotion,
  type ChessPuzzleAction,
  type ChessPuzzleCatalog,
  type ChessPuzzleDifficulty,
  type ChessPuzzleMode,
  type ChessPuzzlePreferences,
  type ChessPuzzleSaveDocument,
  type ChessPuzzleState,
  type ChessPuzzleTheme,
  chessPuzzleById,
  chessPuzzleHintText,
  chessPuzzleSaveJson,
  chessPuzzleStatistics,
  chessSquareName,
  createChessPuzzle,
  createDailyChessPuzzleSelection,
  createEmptyChessPuzzleSave,
  createPracticeChessPuzzleSelection,
  isChessInCheck,
  mergeChessPuzzleCompletions,
  parseChessPuzzleSave,
  reduceChessPuzzle,
  updateChessPuzzleSave,
} from "@axl/extension-lounge";
import {
  CHESS_PUZZLE_SET_REVISION,
  CHESS_PUZZLE_THEMES,
  CHESS_PUZZLES,
} from "@axl/extension-lounge/chess-puzzles";
import { useEffect, useMemo, useRef, useState } from "react";

import { PIECE_NAMES, PieceArt } from "./chess-pieces.tsx";
import type { SaveSlot } from "./save-slot.ts";
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

const catalog: ChessPuzzleCatalog = Object.freeze({
  revision: CHESS_PUZZLE_SET_REVISION,
  puzzles: CHESS_PUZZLES,
});
const REPLY_DELAY_MS = 520;
const DRAG_THRESHOLD = 6;
const PROMOTIONS: readonly ChessPromotion[] = ["queen", "rook", "bishop", "knight"];
const PROMOTION_PIECE = { queen: "q", rook: "r", bishop: "b", knight: "n" } as const;
const today = (): string => new Date().toISOString().slice(0, 10);

const parse = (value: Parameters<typeof parseChessPuzzleSave>[0]) =>
  parseChessPuzzleSave(value, catalog);
const merge = (
  latest: Parameters<typeof parseChessPuzzleSave>[0],
  mine: Parameters<typeof parseChessPuzzleSave>[0],
) =>
  chessPuzzleSaveJson(
    mergeChessPuzzleCompletions(parse(latest).document, parse(mine).document),
  );

function selectionFor(prefs: ChessPuzzlePreferences) {
  return prefs.mode === "daily"
    ? createDailyChessPuzzleSelection(catalog.revision, today(), prefs.difficulty, prefs.theme)
    : createPracticeChessPuzzleSelection(catalog.revision, Date.now(), prefs.difficulty, prefs.theme);
}

function fresh(prefs: ChessPuzzlePreferences): ChessPuzzleState {
  return createChessPuzzle(catalog, selectionFor(prefs));
}

export default function ChessPuzzles(props: GameProps): React.JSX.Element {
  const { phase, notice, reload, reset } = useSlot({
    storage: props.storage,
    scope: loungeScope("axl.lounge.chess-puzzles"),
    schemaVersion: CHESS_PUZZLE_STORAGE_SCHEMA_VERSION,
    parse,
    merge,
  });
  if (phase.kind === "loading") return <GameLoading name="Chess puzzles" />;
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
      <Board {...props} slot={phase.slot} loaded={phase.loaded} />
    </>
  );
}

interface Drag {
  readonly from: number;
  readonly x: number;
  readonly y: number;
}

function Board({
  slot,
  loaded,
  motion,
  autoFocus,
}: GameProps & {
  readonly slot: SaveSlot;
  readonly loaded: ReturnType<typeof parse> | undefined;
}): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const boardEl = useRef<HTMLDivElement>(null);
  const doc = useRef<ChessPuzzleSaveDocument>(loaded?.document ?? createEmptyChessPuzzleSave());
  const [prefs, setPrefs] = useState<ChessPuzzlePreferences>(doc.current.preferences);
  const [state, setState] = useState<ChessPuzzleState>(() => loaded?.state ?? fresh(doc.current.preferences));
  const stateRef = useRef(state);
  const [anim, setAnim] = useState<{ from: number; to: number; id: number }>();
  const [toast, setToast] = useState<string>();
  const [wrong, setWrong] = useState<number>();
  const [keyboard, setKeyboard] = useState(false);
  const [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState(prefs);
  const [drag, setDrag] = useState<Drag>();
  const press = useRef<{ square: number; x: number; y: number; started: boolean } | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const animId = useRef(0);

  const persist = (next: ChessPuzzleState, nextPrefs: ChessPuzzlePreferences): void => {
    try {
      const updated = updateChessPuzzleSave(doc.current, next, nextPrefs);
      doc.current = updated.document;
      slot.save(chessPuzzleSaveJson(updated.document), updated.completionAdded);
    } catch (cause) {
      say(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const say = (text: string): void => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), 2_200);
  };
  const show = (next: ChessPuzzleState, animate: boolean): void => {
    const previous = stateRef.current;
    stateRef.current = next;
    setState(next);
    // The engine copies lastMove on every change, so compare by value. Animating on identity
    // replayed the slide each time a piece was selected.
    const a = previous.lastMove;
    const b = next.lastMove;
    const moved = a.move.from !== b.move.from || a.move.to !== b.move.to || a.actor !== b.actor;
    if (!moved) return;
    if (animate && motion) setAnim({ from: b.move.from, to: b.move.to, id: ++animId.current });
    else setAnim(undefined);
  };

  useEffect(() => {
    if (autoFocus) root.current?.focus({ preventScroll: true });
    if (loaded === undefined) persist(stateRef.current, prefs);
    return () => clearTimeout(toastTimer.current);
    // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per mounted board
  }, []);

  const act = (...actions: ChessPuzzleAction[]): void => {
    const before = stateRef.current;
    let next = before;
    for (const action of actions) next = reduceChessPuzzle(catalog, next, action);
    if (next === before) return;
    if (next.issue === "incorrect-move") {
      setWrong(next.incorrectMoves.length);
      say("Not the best move. Try again.");
      setTimeout(() => setWrong(undefined), 700);
    }
    show(next, true);
    persist(next, prefs);
  };

  // The opponent answers after the player's correct move.
  useEffect(() => {
    if (state.status !== "reply-pending") return;
    const timer = setTimeout(
      () => {
        const next = reduceChessPuzzle(catalog, stateRef.current, { type: "apply-opponent-reply" });
        show(next, true);
        persist(next, prefs);
      },
      motion ? REPLY_DELAY_MS : 0,
    );
    return () => clearTimeout(timer);
    // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the pending ply
  }, [state.status, state.expectedSolutionPly]);

  const startPuzzle = (next: ChessPuzzlePreferences): void => {
    try {
      const created = fresh(next);
      setPrefs(next);
      setMenu(false);
      show(created, true);
      persist(created, next);
      // The setup move always plays out so the position makes sense.
      if (motion) setAnim({ from: created.setupMove.from, to: created.setupMove.to, id: ++animId.current });
    } catch (cause) {
      say(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const square = (event: { clientX: number; clientY: number }): number | undefined => {
    const rect = boardEl.current?.getBoundingClientRect();
    if (rect === undefined) return undefined;
    const col = Math.floor(((event.clientX - rect.left) / rect.width) * 8);
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return undefined;
    return state.orientation === "white" ? (7 - row) * 8 + col : row * 8 + (7 - col);
  };

  const tap = (target: number): void => {
    setKeyboard(false);
    if (state.promotionChooser !== undefined) return;
    act({ type: "set-cursor", square: target }, { type: "activate" });
  };

  const puzzle = chessPuzzleById(catalog, state.puzzleId);
  const mine = state.playerColor;
  const hint = state.status === "active" && state.hintLevel > 0
    ? (() => {
        const text = chessPuzzleHintText(catalog, state);
        return text;
      })()
    : undefined;
  const hintMove = useMemo((): { from?: number; to?: number } => {
    if (state.status !== "active" || state.hintLevel === 0) return {};
    const uci = puzzle.solutionMoves[state.expectedSolutionPly] ?? "";
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const index = (name: string) => (name.length === 2 ? (name.charCodeAt(0) - 97) + (Number(name[1]) - 1) * 8 : -1);
    return { from: index(from), ...(state.hintLevel >= 2 ? { to: index(to) } : {}) };
  }, [puzzle, state.status, state.hintLevel, state.expectedSolutionPly]);

  const check = isChessInCheck(state.position, state.position.sideToMove)
    ? state.position.board.findIndex((piece) => piece === (state.position.sideToMove === "white" ? "K" : "k"))
    : -1;
  const lastFrom = state.lastMove.move.from;
  const lastTo = state.lastMove.move.to;
  const white = state.orientation === "white";
  const stats = chessPuzzleStatistics(doc.current);
  const themes = puzzle.themes
    .map((id) => CHESS_PUZZLE_THEMES.find((theme) => theme.id === id)?.label)
    .filter((label): label is string => label !== undefined)
    .slice(0, 3);
  const playerMove = Math.min(state.totalPlayerMoves, Math.floor(state.expectedSolutionPly / 2) + 1);
  const message =
    state.status === "solved"
      ? "Puzzle solved"
      : state.status === "reply-pending"
        ? "Good move. Opponent replies…"
        : hint !== undefined
          ? `Hint: ${hint}`
          : state.selectedSource !== undefined
            ? "Choose a destination"
            : `${mine === "white" ? "White" : "Black"} to move. Find the best move.`;

  const squares = Array.from({ length: 64 }, (_, i) => {
    const row = Math.floor(i / 8);
    const col = i % 8;
    return white ? (7 - row) * 8 + col : row * 8 + (7 - col);
  });
  const offset = (target: number, from: number): { x: number; y: number } => {
    const col = (index: number) => (white ? index % 8 : 7 - (index % 8));
    const row = (index: number) => (white ? 7 - Math.floor(index / 8) : Math.floor(index / 8));
    return { x: col(from) - col(target), y: row(from) - row(target) };
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: the board handles keys for the whole game
    <div
      ref={root}
      className="lg lg-chess"
      role="application"
      aria-label="Chess puzzles"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const arrows = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const;
        const direction = arrows[event.key as keyof typeof arrows];
        if (direction !== undefined) {
          event.preventDefault();
          setKeyboard(true);
          act({ type: "move-cursor", direction });
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setKeyboard(true);
          act({ type: "activate" });
        } else if (event.key === "Escape") act({ type: "clear-selection" });
        else if (event.key.toLowerCase() === "h") act({ type: "hint" });
        else if (event.key.toLowerCase() === "f") act({ type: "flip-board" });
      }}
      onPointerDown={(event) => {
        if (!(event.target as HTMLElement).closest("button")) root.current?.focus();
      }}
    >
      <div className="lg-bar">
        <div className="lg-title">
          <strong>Chess puzzles</strong>
          <span className="lg-sub">
            {prefs.mode === "daily" ? "Daily" : "Practice"} · {prefs.difficulty}
          </span>
        </div>
        <div className="lg-scores">
          <div>
            <small>Rating</small>
            <b>{puzzle.rating}</b>
          </div>
          <div>
            <small>Wrong</small>
            <b>{state.mistakes}</b>
          </div>
        </div>
      </div>

      <div className="lg-fit">
        <div className="chess-wrap">
          <div
            ref={boardEl}
            className={`chess-board${drag !== undefined ? " dragging" : ""}${keyboard ? " kbd" : ""}`}
            role="grid"
            aria-label="Chess board"
            onPointerDown={(event) => {
              if (event.button !== 0 || state.promotionChooser !== undefined) return;
              const target = square(event);
              if (target === undefined) return;
              press.current = { square: target, x: event.clientX, y: event.clientY, started: false };
              boardEl.current?.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const current = press.current;
              if (current === undefined) return;
              if (!current.started) {
                if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_THRESHOLD) return;
                const piece = stateRef.current.position.board[current.square];
                const owns =
                  piece !== null &&
                  piece !== undefined &&
                  (piece === piece.toUpperCase() ? "white" : "black") === mine &&
                  stateRef.current.status === "active";
                if (!owns) {
                  press.current = undefined;
                  return;
                }
                current.started = true;
                if (stateRef.current.selectedSource !== current.square)
                  act({ type: "set-cursor", square: current.square }, { type: "activate" });
              }
              const rect = boardEl.current?.getBoundingClientRect();
              if (rect !== undefined)
                setDrag({ from: current.square, x: event.clientX - rect.left, y: event.clientY - rect.top });
            }}
            onPointerUp={(event) => {
              const current = press.current;
              press.current = undefined;
              setDrag(undefined);
              if (current === undefined) return;
              const target = square(event);
              if (target === undefined) return;
              if (!current.started) tap(target);
              else if (target !== current.square)
                act({ type: "set-cursor", square: target }, { type: "activate" });
            }}
            onPointerCancel={() => {
              press.current = undefined;
              setDrag(undefined);
            }}
          >
            {squares.map((sq, i) => {
              const piece = state.position.board[sq] ?? null;
              const target = state.legalTargets.includes(sq);
              const isHintFrom = hintMove.from === sq;
              const isHintTo = hintMove.to === sq;
              const cls = [
                "chess-sq",
                (Math.floor(sq / 8) + (sq % 8)) % 2 === 0 ? "dark" : "light",
                sq === lastFrom || sq === lastTo ? "last" : "",
                sq === state.selectedSource ? "selected" : "",
                target ? (piece === null ? "move" : "capture") : "",
                sq === check ? "check" : "",
                isHintFrom || isHintTo ? "hint" : "",
                keyboard && sq === state.cursor ? "cursor" : "",
                wrong !== undefined && sq === state.selectedSource ? "wrong" : "",
              ]
                .filter(Boolean)
                .join(" ");
              const moving = anim !== undefined && anim.to === sq ? offset(sq, anim.from) : undefined;
              return (
                <button
                  key={sq}
                  type="button"
                  tabIndex={-1}
                  className={cls}
                  aria-label={`${chessSquareName(sq)}${
                    piece === null
                      ? ""
                      : `, ${piece === piece.toUpperCase() ? "white" : "black"} ${PIECE_NAMES[piece.toLowerCase()]}`
                  }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    if (event.detail === 0) {
                      setKeyboard(true);
                      act({ type: "set-cursor", square: sq }, { type: "activate" });
                    }
                  }}
                >
                  {i % 8 === 0 && <em className="rank">{Math.floor(sq / 8) + 1}</em>}
                  {Math.floor(i / 8) === 7 && <em className="file">{chessSquareName(sq)[0]}</em>}
                  {piece !== null && (
                    <span
                      key={moving === undefined ? "still" : `move-${anim?.id}`}
                      className={`chess-piece-box${moving === undefined ? "" : " sliding"}${drag?.from === sq ? " lifted" : ""}`}
                      style={
                        moving === undefined
                          ? undefined
                          : ({ "--dx": `${moving.x * 100}%`, "--dy": `${moving.y * 100}%` } as React.CSSProperties)
                      }
                    >
                      <PieceArt piece={piece} />
                    </span>
                  )}
                </button>
              );
            })}
            {drag !== undefined && state.position.board[drag.from] != null && (
              <span className="chess-ghost" style={{ left: drag.x, top: drag.y }}>
                <PieceArt piece={state.position.board[drag.from] as NonNullable<(typeof state.position.board)[number]>} />
              </span>
            )}
            {state.promotionChooser !== undefined && (
              <div className="chess-promote" role="dialog" aria-label="Choose promotion">
                {PROMOTIONS.filter((choice) => state.promotionChooser?.choices.includes(choice)).map((choice) => {
                  const letter = PROMOTION_PIECE[choice];
                  return (
                    <button
                      key={choice}
                      type="button"
                      aria-label={choice}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() =>
                        act({ type: "choose-promotion", promotion: choice }, { type: "confirm-promotion" })
                      }
                    >
                      <PieceArt piece={mine === "white" ? (letter.toUpperCase() as "Q") : letter} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="chess-info">
      {state.status === "solved" && (
        <div className="chess-solved" role="status">
          <div>
            <strong>Solved{state.mistakes === 0 && state.hintLevel === 0 ? " cleanly" : ""}</strong>
            <span>
              {state.mistakes} wrong · {state.hintLevel} hints · {stats.puzzlesCompleted} solved overall
              {stats.currentDailyStreak > 0 ? ` · ${stats.currentDailyStreak}-day streak` : ""}
            </span>
          </div>
          <button
            type="button"
            className="lg-btn primary"
            onClick={() => startPuzzle({ ...prefs, mode: "practice", orientation: "white" })}
          >
            Next puzzle
          </button>
        </div>
      )}
          {state.status !== "solved" && (
          <div className={`chess-status ${state.status}`}>
            <span className={`chess-dot ${mine}`} aria-hidden="true" />
            <strong aria-live="polite">{message}</strong>
          </div>
          )}
          <div className="chess-meta">
            <span>
              Move {playerMove} of {state.totalPlayerMoves}
            </span>
            {themes.length > 0 && <span>{themes.join(", ")}</span>}
          </div>
        </div>
      </div>

      <div className="lg-dock">
        <IconButton
          icon="hint"
          label="Hint"
          text={state.hintLevel === 0 ? "Hint" : `Hint ${state.hintLevel}/3`}
          disabled={state.status !== "active" || state.hintLevel === 3}
          onClick={() => act({ type: "hint" })}
        />
        <IconButton icon="flip" label="Flip board" text="Flip" onClick={() => act({ type: "flip-board" })} />
        <IconButton
          icon="plus"
          label="New puzzle"
          text="New puzzle"
          onClick={() => {
            setDraft(prefs);
            setMenu(true);
          }}
        />
      </div>

      <Toast text={toast} />

      {menu && (
        <Overlay
          title="New puzzle"
          actions={
            <>
              <button type="button" className="lg-btn" onClick={() => setMenu(false)}>
                Cancel
              </button>
              <button type="button" className="lg-btn primary" onClick={() => startPuzzle(draft)}>
                Start
              </button>
            </>
          }
        >
          <div className="lg-field">
            <span>Puzzle</span>
            <Segmented<ChessPuzzleMode>
              label="Puzzle"
              value={draft.mode}
              options={[
                { value: "daily", label: "Daily" },
                { value: "practice", label: "Practice" },
              ]}
              onChange={(mode) => setDraft({ ...draft, mode })}
            />
          </div>
          <div className="lg-field">
            <span>Difficulty</span>
            <Segmented<ChessPuzzleDifficulty>
              label="Difficulty"
              value={draft.difficulty}
              options={[
                { value: "easy", label: "Easy" },
                { value: "medium", label: "Medium" },
                { value: "hard", label: "Hard" },
              ]}
              onChange={(difficulty) => setDraft({ ...draft, difficulty })}
            />
          </div>
          <label className="lg-field">
            <span>Theme</span>
            <select
              className="lg-select"
              value={draft.theme}
              onChange={(event) => setDraft({ ...draft, theme: event.target.value as ChessPuzzleTheme })}
            >
              <option value="any">Any</option>
              {CHESS_PUZZLE_THEMES.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.label}
                </option>
              ))}
            </select>
          </label>
        </Overlay>
      )}
    </div>
  );
}
