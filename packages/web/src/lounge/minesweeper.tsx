// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import {
  adjacentMineCount,
  createMinesweeper,
  MINESWEEPER_PRESETS,
  MINESWEEPER_STORAGE_SCHEMA_VERSION,
  type MinesweeperAction,
  type MinesweeperPreset,
  type MinesweeperSaveDocument,
  type MinesweeperState,
  minesweeperSaveJson,
  parseMinesweeperSave,
  reduceMinesweeper,
  remainingMineEstimate,
  updateMinesweeperSave,
} from "@axl/extension-lounge";
import { useEffect, useRef, useState } from "react";

import type { SaveSlot } from "./save-slot.ts";
import {
  clock,
  type GameProps,
  GameLoading,
  Icon,
  IconButton,
  loungeScope,
  Overlay,
  SaveNotice,
  Segmented,
  StorageProblem,
} from "./shared.tsx";
import { useSlot } from "./use-slot.ts";

const PRESET_LABEL: Record<MinesweeperPreset, string> = {
  beginner: "Easy",
  intermediate: "Medium",
  expert: "Hard",
};
const LONG_PRESS_MS = 420;

const parse = (value: Parameters<typeof parseMinesweeperSave>[0]) => parseMinesweeperSave(value);

export default function Minesweeper(props: GameProps): React.JSX.Element {
  const { phase, notice, reload, reset } = useSlot({
    storage: props.storage,
    scope: loungeScope("axl.lounge.minesweeper"),
    schemaVersion: MINESWEEPER_STORAGE_SCHEMA_VERSION,
    parse,
  });
  if (phase.kind === "loading") return <GameLoading name="Minesweeper" />;
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
      <Field {...props} slot={phase.slot} loaded={phase.loaded} />
    </>
  );
}

function Field({
  slot,
  loaded,
  markers,
  autoFocus,
}: GameProps & { readonly slot: SaveSlot; readonly loaded: MinesweeperSaveDocument | undefined }) {
  const root = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<MinesweeperState>(
    () => loaded?.game ?? createMinesweeper("beginner", Date.now()),
  );
  const stateRef = useRef(state);
  const [flagMode, setFlagMode] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [now, setNow] = useState(0);
  /** Play time before the current run, and when the current run began while the page is visible. */
  const clockRef = useRef<{ base: number; since: number | undefined }>({
    base: state.elapsedMs,
    since: undefined,
  });
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; fired: boolean }>(undefined);

  const elapsed = (): number => {
    const { base, since } = clockRef.current;
    return since === undefined ? base : base + (performance.now() - since);
  };

  useEffect(() => {
    if (autoFocus) root.current?.focus({ preventScroll: true });
    if (loaded === undefined) slot.save(minesweeperSaveJson(updateMinesweeperSave(stateRef.current)));
    // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per mounted field
  }, []);

  // The clock runs only while a game is active and the page is visible.
  useEffect(() => {
    const sync = (): void => {
      const running = stateRef.current.status === "active" && !document.hidden;
      const clockState = clockRef.current;
      if (running && clockState.since === undefined) clockState.since = performance.now();
      if (!running && clockState.since !== undefined) {
        clockState.base = elapsed();
        clockState.since = undefined;
      }
      setNow(elapsed());
    };
    sync();
    const timer = setInterval(sync, 250);
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: refs only
  }, [state.status]);

  const apply = (...actions: MinesweeperAction[]): void => {
    let next = stateRef.current;
    for (const action of [{ type: "elapsed", elapsedMs: Math.floor(elapsed()) } as const, ...actions])
      next = reduceMinesweeper(next, action);
    if (next === stateRef.current) return;
    stateRef.current = next;
    clockRef.current.base = next.elapsedMs;
    if (clockRef.current.since !== undefined) clockRef.current.since = performance.now();
    setState(next);
    setNow(next.elapsedMs);
    if (next.status === "won" || next.status === "lost") setDismissed(false);
    slot.save(minesweeperSaveJson(updateMinesweeperSave(next)));
  };

  const start = (preset: MinesweeperPreset): void => {
    clockRef.current = { base: 0, since: undefined };
    stateRef.current = createMinesweeper(preset, Date.now());
    setState(stateRef.current);
    setNow(0);
    setDismissed(false);
    slot.save(minesweeperSaveJson(updateMinesweeperSave(stateRef.current)));
  };

  const open = (index: number): void => {
    const current = stateRef.current;
    if (current.revealed[index]) apply({ type: "cursor", index }, { type: "chord" });
    else apply({ type: "cursor", index }, { type: "reveal" });
  };
  const flag = (index: number): void => apply({ type: "cursor", index }, { type: "flag" });

  const finished = state.status === "won" || state.status === "lost";
  const cells = state.width * state.height;

  return (
    // biome-ignore lint/a11y/useSemanticElements: the field handles keys for the whole game
    <div
      ref={root}
      className="lg lg-mines"
      role="application"
      aria-label="Minesweeper"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const arrows = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const;
        const direction = arrows[event.key as keyof typeof arrows];
        if (direction !== undefined) {
          event.preventDefault();
          setKeyboard(true);
          apply({ type: "move", direction });
        } else if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          setKeyboard(true);
          apply(stateRef.current.revealed[stateRef.current.cursor] ? { type: "chord" } : { type: "reveal" });
        } else if (event.key.toLowerCase() === "f") {
          event.preventDefault();
          setKeyboard(true);
          apply({ type: "flag" });
        }
      }}
      onPointerDown={(event) => {
        if (!(event.target as HTMLElement).closest("button")) root.current?.focus();
      }}
    >
      <div className="lg-bar">
        <div className="lg-title">
          <strong>Minesweeper</strong>
          <span className="lg-sub">{PRESET_LABEL[state.preset]}</span>
        </div>
        <div className="lg-scores">
          <div>
            <small>Mines</small>
            <b>{remainingMineEstimate(state)}</b>
          </div>
          <div>
            <small>Time</small>
            <b>{clock(now)}</b>
          </div>
        </div>
      </div>

      <div className="lg-fit lg-scroll">
        <div
          className={`mines-grid${keyboard ? " kbd" : ""}`}
          role="grid"
          aria-label="Minefield"
          style={{ "--w": state.width, "--h": state.height } as React.CSSProperties}
          onContextMenu={(event) => event.preventDefault()}
        >
          {Array.from({ length: cells }, (_, index) => {
            const revealed = state.revealed[index] === true;
            const flagged = state.flagged[index] === true;
            const mine = state.mines[index] === true;
            const count = revealed && !mine ? adjacentMineCount(state, index) : 0;
            const exploded = state.exploded === index;
            const showMine = state.status === "lost" && mine && !flagged;
            const wrongFlag = state.status === "lost" && flagged && !mine;
            const cls = [
              "mine-cell",
              revealed ? "open" : "",
              flagged ? "flagged" : "",
              showMine ? "mine" : "",
              exploded ? "boom" : "",
              wrongFlag ? "wrong" : "",
              (index + Math.floor(index / state.width)) % 2 === 0 ? "alt" : "",
              keyboard && state.cursor === index ? "cursor" : "",
              count > 0 ? `n${count}` : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={`${state.width}-${index}`}
                type="button"
                tabIndex={-1}
                className={cls}
                aria-label={`Row ${Math.floor(index / state.width) + 1}, column ${(index % state.width) + 1}, ${
                  flagged ? "flagged" : revealed ? (count === 0 ? "empty" : `${count} nearby`) : "hidden"
                }`}
                disabled={finished}
                onMouseDown={(event) => event.preventDefault()}
                onContextMenu={(event) => {
                  event.preventDefault();
                  flag(index);
                }}
                onPointerDown={(event) => {
                  if (event.pointerType === "mouse") return;
                  press.current = {
                    fired: false,
                    timer: setTimeout(() => {
                      if (press.current !== undefined) press.current.fired = true;
                      flag(index);
                    }, LONG_PRESS_MS),
                  };
                }}
                onPointerUp={() => clearTimeout(press.current?.timer)}
                onPointerLeave={() => clearTimeout(press.current?.timer)}
                onClick={() => {
                  if (press.current?.fired) {
                    press.current = undefined;
                    return;
                  }
                  setKeyboard(false);
                  if (flagMode && !revealed) flag(index);
                  else open(index);
                }}
              >
                {flagged && !wrongFlag && <Icon name="flag" />}
                {wrongFlag && <span className="cross">×</span>}
                {showMine && <span className="bomb" />}
                {exploded && <span className="bomb" />}
                {count > 0 && (markers ? <span>{count}</span> : count)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="lg-dock">
        <button
          type="button"
          className="lg-tool"
          aria-pressed={flagMode}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setFlagMode(!flagMode)}
          title="Tap to flag instead of dig"
        >
          <Icon name={flagMode ? "flag" : "shovel"} />
          <span>{flagMode ? "Flagging" : "Digging"}</span>
        </button>
        <Segmented
          label="New game size"
          value={state.preset}
          options={(Object.keys(MINESWEEPER_PRESETS) as MinesweeperPreset[]).map((value) => ({
            value,
            label: PRESET_LABEL[value],
          }))}
          onChange={(preset) => preset !== state.preset && start(preset)}
        />
        <IconButton icon="plus" label="New game" onClick={() => start(state.preset)} />
      </div>

      {finished && !dismissed && (
        <Overlay
          title={state.status === "won" ? "Field cleared" : "Boom"}
          tone={state.status === "won" ? "win" : "lose"}
          actions={
            <>
              <button type="button" className="lg-btn" onClick={() => setDismissed(true)}>
                View board
              </button>
              <button type="button" className="lg-btn primary" onClick={() => start(state.preset)}>
                Play again
              </button>
            </>
          }
        >
          <p className="lg-answer">
            {state.status === "won" ? "Finished in" : "You lasted"} <strong>{clock(now)}</strong> on{" "}
            {PRESET_LABEL[state.preset]}
          </p>
        </Overlay>
      )}
    </div>
  );
}
