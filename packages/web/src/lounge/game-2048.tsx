// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import {
  GAME_2048_SIZE,
  GAME_2048_STORAGE_SCHEMA_VERSION,
  GAME_2048_TARGET,
  type Game2048Direction,
  type Game2048MoveTrace,
  type Game2048SaveDocument,
  type Game2048State,
  createGame2048,
  game2048SaveJson,
  moveGame2048,
  parseGame2048Save,
  reduceGame2048,
  updateGame2048Save,
} from "@axl/extension-lounge";
import { useEffect, useRef, useState } from "react";

import type { SaveSlot } from "./save-slot.ts";
import {
  type GameProps,
  GameLoading,
  IconButton,
  loungeScope,
  Overlay,
  SaveNotice,
  StorageProblem,
} from "./shared.tsx";
import { useSlot } from "./use-slot.ts";

interface Tile {
  readonly id: number;
  readonly value: number;
  readonly index: number;
  readonly fresh?: boolean;
  readonly merged?: boolean;
}

const SLIDE_MS = 110;
const KEYS: Record<string, Game2048Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
};

let nextId = 1;
const tilesFromBoard = (board: readonly number[]): Tile[] =>
  board.flatMap((value, index) => (value === 0 ? [] : [{ id: nextId++, value, index }]));

/** Tiles at their landed cells, still showing the values they had before merging. */
function slidingTiles(previous: readonly Tile[], trace: Game2048MoveTrace) {
  const bySource = new Map(previous.map((tile) => [tile.index, tile]));
  const sliding: Tile[] = [];
  const settled: Tile[] = [];
  const survivors = new Set<number>();
  for (const motion of trace.motions) {
    const tile = bySource.get(motion.source);
    if (tile === undefined) throw new Error("2048 move names a tile that is not on the board");
    sliding.push({ id: tile.id, value: motion.value, index: motion.destination });
    if (motion.merged && survivors.has(motion.destination)) continue;
    survivors.add(motion.destination);
    settled.push({
      id: tile.id,
      value: motion.resultValue,
      index: motion.destination,
      ...(motion.merged ? { merged: true } : {}),
    });
  }
  if (trace.spawn !== undefined)
    settled.push({ id: nextId++, value: trace.spawn.value, index: trace.spawn.index, fresh: true });
  return { sliding, settled };
}

const parse = (value: Parameters<typeof parseGame2048Save>[0]) => parseGame2048Save(value);

export default function Game2048(props: GameProps): React.JSX.Element {
  const { phase, notice, reload, reset } = useSlot({
    storage: props.storage,
    scope: loungeScope("axl.lounge.2048"),
    schemaVersion: GAME_2048_STORAGE_SCHEMA_VERSION,
    parse,
  });
  if (phase.kind === "loading") return <GameLoading name="2048" />;
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

function Board({
  slot,
  loaded,
  motion,
  autoFocus,
}: GameProps & { readonly slot: SaveSlot; readonly loaded: Game2048SaveDocument | undefined }) {
  const root = useRef<HTMLDivElement>(null);
  const initial = useRef(loaded?.game ?? createGame2048(Date.now()));
  const [state, setState] = useState<Game2048State>(initial.current);
  const stateRef = useRef(state);
  const best = useRef(loaded?.bestScore ?? 0);
  const [tiles, setTiles] = useState<Tile[]>(() => tilesFromBoard(initial.current.board));
  const tilesRef = useRef(tiles);
  const settle = useRef<{ timer: ReturnType<typeof setTimeout>; final: Tile[] }>(undefined);
  const touch = useRef<{ x: number; y: number }>(undefined);
  const [dismissed, setDismissed] = useState(false);
  const boardEl = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus) root.current?.focus({ preventScroll: true });
    if (loaded === undefined) slot.save(game2048SaveJson(updateGame2048Save(initial.current)));
    return () => clearTimeout(settle.current?.timer);
    // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per mounted board
  }, []);

  const show = (next: Tile[]): void => {
    tilesRef.current = next;
    setTiles(next);
  };
  const flush = (): void => {
    const pending = settle.current;
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    settle.current = undefined;
    show(pending.final);
  };
  const commit = (next: Game2048State): void => {
    stateRef.current = next;
    setState(next);
    best.current = Math.max(best.current, next.score);
    slot.save(game2048SaveJson(updateGame2048Save(next, best.current)));
  };

  const move = (direction: Game2048Direction): void => {
    flush();
    const current = stateRef.current;
    if (current.status === "lost" || (current.status === "won" && !current.continued)) return;
    const { state: next, trace } = moveGame2048(current, direction);
    if (!trace.changed) {
      if (motion)
        boardEl.current?.animate(
          [{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }],
          { duration: 160 },
        );
      return;
    }
    const { sliding, settled } = slidingTiles(tilesRef.current, trace);
    commit(next);
    if (motion) {
      show(sliding);
      settle.current = {
        final: settled,
        timer: setTimeout(() => {
          settle.current = undefined;
          show(settled);
        }, SLIDE_MS),
      };
    } else show(settled);
    if (next.status !== "active") setDismissed(false);
  };

  const restart = (action: "restart" | "undo" | "continue"): void => {
    flush();
    const next = reduceGame2048(
      stateRef.current,
      action === "restart" ? { type: "restart", seed: Date.now() } : { type: action },
    );
    if (next === stateRef.current) return;
    commit(next);
    show(tilesFromBoard(next.board));
    setDismissed(false);
  };

  const size = GAME_2048_SIZE;
  const over = state.status === "lost" || (state.status === "won" && !state.continued);
  return (
    // biome-ignore lint/a11y/useSemanticElements: the board handles arrow keys for the whole game
    <div
      ref={root}
      className="lg lg-2048"
      role="application"
      aria-label="2048"
      tabIndex={0}
      onKeyDown={(event) => {
        const direction = KEYS[event.key];
        if (direction !== undefined && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          move(direction);
        } else if (event.key.toLowerCase() === "u" || event.key === "z") restart("undo");
      }}
      onPointerDown={(event) => {
        if (!(event.target as HTMLElement).closest("button")) root.current?.focus();
      }}
    >
      <div className="lg-bar">
        <div className="lg-title">
          <strong>2048</strong>
          <span className="lg-sub">Reach {GAME_2048_TARGET}</span>
        </div>
        <div className="lg-scores">
          <div>
            <small>Score</small>
            <b>{state.score}</b>
          </div>
          <div>
            <small>Best</small>
            <b>{Math.max(best.current, state.score)}</b>
          </div>
        </div>
      </div>

      <div className="lg-fit">
        <div
          ref={boardEl}
          className="g2048-board"
          style={{ "--n": size } as React.CSSProperties}
          onPointerDown={(event) => {
            touch.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={(event) => {
            const start = touch.current;
            touch.current = undefined;
            if (start === undefined) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
            move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
          }}
        >
          {Array.from({ length: size * size }, (_, cell) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
            <i key={cell} className="g2048-cell" />
          ))}
          {tiles.map((tile) => (
            <div
              key={tile.id}
              className="g2048-slot"
              style={
                {
                  "--r": Math.floor(tile.index / size),
                  "--c": tile.index % size,
                } as React.CSSProperties
              }
            >
              <div
                className={`g2048-tile v${Math.min(tile.value, 4096)}${tile.fresh ? " fresh" : ""}${tile.merged ? " merged" : ""}`}
                data-digits={String(tile.value).length}
              >
                {tile.value}
              </div>
            </div>
          ))}
        </div>
        <p className="lg-hint small center">
          Slide with arrow keys, WASD or a swipe. Equal tiles merge.
        </p>
      </div>

      <div className="lg-dock">
        <IconButton
          icon="undo"
          label="Undo last move"
          text="Undo"
          disabled={state.undo === undefined}
          onClick={() => restart("undo")}
        />
        <IconButton icon="plus" label="New game" text="New game" onClick={() => restart("restart")} />
      </div>

      {over && !dismissed && (
        <Overlay
          title={state.status === "won" ? "You made 2048!" : "No more moves"}
          tone={state.status === "won" ? "win" : "lose"}
          actions={
            <>
              {state.status === "won" ? (
                <button type="button" className="lg-btn" onClick={() => restart("continue")}>
                  Keep going
                </button>
              ) : (
                <>
                  <button type="button" className="lg-btn" onClick={() => setDismissed(true)}>
                    View board
                  </button>
                  {state.undo !== undefined && (
                    <button type="button" className="lg-btn" onClick={() => restart("undo")}>
                      Undo
                    </button>
                  )}
                </>
              )}
              <button type="button" className="lg-btn primary" onClick={() => restart("restart")}>
                New game
              </button>
            </>
          }
        >
          <p className="lg-answer">
            Final score <strong>{state.score}</strong>
          </p>
        </Overlay>
      )}
    </div>
  );
}
