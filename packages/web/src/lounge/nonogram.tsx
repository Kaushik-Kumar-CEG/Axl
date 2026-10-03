// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import {
  createEmptyNonogramSave,
  createNonogram,
  mergeNonogramSolved,
  NONOGRAM_SIZES,
  NONOGRAM_STORAGE_SCHEMA_VERSION,
  type NonogramAction,
  type NonogramCell,
  type NonogramPreferences,
  type NonogramSaveDocument,
  type NonogramSize,
  type NonogramState,
  nonogramClues,
  nonogramLineDone,
  nonogramSaveJson,
  parseNonogramSave,
  reduceNonogram,
  updateNonogramSave,
} from "@axl/extension-lounge";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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
} from "./shared.tsx";
import { useSlot } from "./use-slot.ts";

type Tool = "fill" | "mark";
const SIZE_LABEL: Record<NonogramSize, string> = { 5: "5×5", 10: "10×10", 15: "15×15" };

const parse = (value: Parameters<typeof parseNonogramSave>[0]) => parseNonogramSave(value);
const merge = (
  latest: Parameters<typeof parseNonogramSave>[0],
  mine: Parameters<typeof parseNonogramSave>[0],
) =>
  nonogramSaveJson(
    mergeNonogramSolved(parseNonogramSave(latest).document, parseNonogramSave(mine).document),
  );

export default function Nonogram(props: GameProps): React.JSX.Element {
  const { phase, notice, reload, reset } = useSlot({
    storage: props.storage,
    scope: loungeScope("axl.lounge.nonogram"),
    schemaVersion: NONOGRAM_STORAGE_SCHEMA_VERSION,
    parse,
    merge,
  });
  if (phase.kind === "loading") return <GameLoading name="Nonogram" />;
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
      <Picture {...props} slot={phase.slot} loaded={phase.loaded} />
    </>
  );
}

interface Draft {
  readonly value: NonogramCell;
  readonly indices: readonly number[];
}

function Picture({
  slot,
  loaded,
  autoFocus,
}: GameProps & {
  readonly slot: SaveSlot;
  readonly loaded: ReturnType<typeof parse> | undefined;
}): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const fit = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const doc = useRef<NonogramSaveDocument>(loaded?.document ?? createEmptyNonogramSave());
  const [state, setState] = useState<NonogramState>(
    () => loaded?.state ?? createNonogram(doc.current.preferences.size, Date.now(), doc.current.solved),
  );
  const stateRef = useRef(state);
  const [tool, setTool] = useState<Tool>("fill");
  const [cursor, setCursor] = useState<number>();
  const [hover, setHover] = useState<number>();
  const [draft, setDraft] = useState<Draft>();
  const draftRef = useRef<Draft>(undefined);
  const [dismissed, setDismissed] = useState(false);
  const [menu, setMenu] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number }>();

  useEffect(() => {
    if (autoFocus) root.current?.focus({ preventScroll: true });
    if (loaded === undefined) slot.save(nonogramSaveJson(updateNonogramSave(doc.current, stateRef.current, doc.current.preferences)));
    // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per mounted board
  }, []);

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

  const clues = useMemo(() => nonogramClues(state.fixtureId), [state.fixtureId]);
  const n = state.size;
  const longestRow = Math.max(...clues.rows.map((clue) => clue.length), 1);
  const longestColumn = Math.max(...clues.columns.map((clue) => clue.length), 1);
  const cell =
    size === undefined
      ? 24
      : Math.max(
          14,
          Math.floor(
            Math.min(
              (size.width - 8) / (n + 0.62 * longestRow + 0.3),
              (size.height - 8) / (n + 0.8 * longestColumn + 0.3),
              44,
            ),
          ),
        );

  const commit = (next: NonogramState): void => {
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
    const prefs: NonogramPreferences = { size: next.size };
    doc.current = updateNonogramSave(doc.current, next, prefs);
    slot.save(nonogramSaveJson(doc.current), next.status === "solved");
    if (next.status === "solved") setDismissed(false);
  };
  const act = (action: NonogramAction): void => commit(reduceNonogram(stateRef.current, action));

  const fresh = (next: NonogramSize): void => {
    setMenu(false);
    setDismissed(false);
    setCursor(undefined);
    const created = reduceNonogram(stateRef.current, {
      type: "restart",
      size: next,
      seed: Date.now(),
      exclude: doc.current.solved,
    });
    stateRef.current = created;
    setState(created);
    doc.current = updateNonogramSave(doc.current, created, { size: next });
    slot.save(nonogramSaveJson(doc.current));
  };

  const at = (event: { clientX: number; clientY: number }): number | undefined => {
    const rect = grid.current?.getBoundingClientRect();
    if (rect === undefined) return undefined;
    const column = Math.floor(((event.clientX - rect.left) / rect.width) * n);
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * n);
    return column < 0 || column >= n || row < 0 || row >= n ? undefined : row * n + column;
  };

  const shown = (index: number): NonogramCell => {
    const pending = draft;
    return pending?.indices.includes(index) ? pending.value : (state.cells[index] as NonogramCell);
  };

  const keyAction = (event: React.KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const arrows: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -n, ArrowDown: n };
    const current = cursor ?? 0;
    if (event.key in arrows) {
      event.preventDefault();
      const delta = arrows[event.key] as number;
      const column = (current % n) + (Math.abs(delta) === 1 ? delta : 0);
      const next = current + delta;
      setCursor(column < 0 || column >= n || next < 0 || next >= n * n ? current : next);
      return;
    }
    const key = event.key.toLowerCase();
    if (key === " " || key === "enter") {
      event.preventDefault();
      setCursor(current);
      act({ type: "paint", indices: [current], value: state.cells[current] === 1 ? 0 : 1 });
    } else if (key === "x") act({ type: "paint", indices: [current], value: state.cells[current] === 2 ? 0 : 2 });
    else if (key === "backspace" || key === "delete") act({ type: "paint", indices: [current], value: 0 });
    else if (key === "u" || key === "z") act({ type: "undo" });
    else if (key === "h") act({ type: "hint" });
  };

  const finish = (): void => {
    const pending = draftRef.current;
    draftRef.current = undefined;
    setDraft(undefined);
    if (pending !== undefined) act({ type: "paint", indices: pending.indices, value: pending.value });
  };

  const done = state.status === "solved";
  return (
    // biome-ignore lint/a11y/useSemanticElements: the board handles keys for the whole game
    <div
      ref={root}
      className="lg lg-nonogram"
      role="application"
      aria-label="Nonogram"
      tabIndex={0}
      onKeyDown={keyAction}
      onPointerDown={(event) => {
        if (!(event.target as HTMLElement).closest("button")) root.current?.focus();
      }}
    >
      <div className="lg-bar">
        <div className="lg-title">
          <strong>Nonogram</strong>
          <span className="lg-sub">{SIZE_LABEL[state.size]}</span>
        </div>
        <div className="lg-scores">
          <div>
            <small>Hints</small>
            <b>{state.hintCount}</b>
          </div>
        </div>
      </div>

      <div ref={fit} className="lg-fit">
        <div
          className={`ng-board${done ? " solved" : ""}`}
          style={{ "--n": n, "--cell": `${cell}px`, "--clue": `${Math.max(9, Math.round(cell * 0.5))}px` } as React.CSSProperties}
        >
          <div className="ng-corner" />
          <div className="ng-top">
            {clues.columns.map((clue, column) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: clues are positional
                key={column}
                className={`ng-clue col${nonogramLineDone(state, "column", column) ? " done" : ""}${(hover ?? cursor ?? -1) % n === column && (hover ?? cursor) !== undefined ? " focus" : ""}`}
              >
                {clue.map((value, position) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: runs can repeat
                  <span key={position}>{value}</span>
                ))}
              </div>
            ))}
          </div>
          <div className="ng-left">
            {clues.rows.map((clue, row) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: clues are positional
                key={row}
                className={`ng-clue row${nonogramLineDone(state, "row", row) ? " done" : ""}${Math.floor((hover ?? cursor ?? -1) / n) === row && (hover ?? cursor) !== undefined ? " focus" : ""}`}
              >
                {clue.map((value, position) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: runs can repeat
                  <span key={position}>{value}</span>
                ))}
              </div>
            ))}
          </div>
          <div
            ref={grid}
            className="ng-grid"
            role="grid"
            aria-label="Nonogram grid"
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              if (done || (event.pointerType === "mouse" && event.button > 2)) return;
              const index = at(event);
              if (index === undefined) return;
              setCursor(undefined);
              const value: NonogramCell =
                event.button === 2 || tool === "mark"
                  ? state.cells[index] === 2 ? 0 : 2
                  : state.cells[index] === 1 ? 0 : 1;
              grid.current?.setPointerCapture(event.pointerId);
              draftRef.current = { value, indices: [index] };
              setDraft(draftRef.current);
            }}
            onPointerMove={(event) => {
              const index = at(event);
              setHover(index);
              const pending = draftRef.current;
              if (pending === undefined || index === undefined || pending.indices.includes(index)) return;
              draftRef.current = { value: pending.value, indices: [...pending.indices, index] };
              setDraft(draftRef.current);
            }}
            onPointerUp={finish}
            onPointerCancel={() => {
              draftRef.current = undefined;
              setDraft(undefined);
            }}
            onPointerLeave={() => setHover(undefined)}
          >
            {Array.from({ length: n * n }, (_, index) => {
              const value = shown(index);
              const row = Math.floor(index / n);
              const column = index % n;
              return (
                <div
                  key={index}
                  role="gridcell"
                  aria-label={`Row ${row + 1}, column ${column + 1}, ${value === 1 ? "filled" : value === 2 ? "marked empty" : "empty"}`}
                  className={`ng-cell${value === 1 ? " on" : value === 2 ? " off" : ""}${state.hinted[index] ? " hint" : ""}${(column + 1) % 5 === 0 && column < n - 1 ? " gr" : ""}${(row + 1) % 5 === 0 && row < n - 1 ? " gb" : ""}${cursor === index ? " cursor" : ""}${hover === index ? " hover" : ""}`}
                >
                  {value === 2 && <i aria-hidden="true">×</i>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="lg-dock">
        <button
          type="button"
          className="lg-tool"
          aria-pressed={tool === "mark"}
          title="Switch between filling cells and marking them empty"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setTool(tool === "fill" ? "mark" : "fill")}
        >
          <span aria-hidden="true">{tool === "fill" ? "■" : "×"}</span>
          <span>{tool === "fill" ? "Fill" : "Mark empty"}</span>
        </button>
        <IconButton icon="undo" label="Undo" disabled={state.history.length === 0 || done} onClick={() => act({ type: "undo" })} />
        <IconButton icon="hint" label="Reveal one cell" text="Hint" disabled={done} onClick={() => act({ type: "hint" })} />
        <IconButton icon="eraser" label="Clear the board" disabled={done} onClick={() => act({ type: "reset" })} />
        <IconButton icon="plus" label="New puzzle" onClick={() => setMenu(true)} />
      </div>

      {menu && (
        <Overlay
          title="New puzzle"
          actions={
            <button type="button" className="lg-btn" onClick={() => setMenu(false)}>
              Cancel
            </button>
          }
        >
          <p className="lg-hint">Use the numbers to work out which cells to fill. Every puzzle has one answer.</p>
          <div className="lg-field">
            <span>Size</span>
            <Segmented<`${NonogramSize}`>
              label="Size"
              value={`${state.size}`}
              options={NONOGRAM_SIZES.map((value) => ({ value: `${value}` as `${NonogramSize}`, label: SIZE_LABEL[value] }))}
              onChange={(value) => fresh(Number(value) as NonogramSize)}
            />
          </div>
          <p className="lg-hint small">Picking a size starts a new puzzle you have not solved yet.</p>
        </Overlay>
      )}

      {done && !dismissed && !menu && (
        <Overlay
          title="Picture complete"
          tone="win"
          actions={
            <>
              <button type="button" className="lg-btn" onClick={() => setDismissed(true)}>
                View picture
              </button>
              <button type="button" className="lg-btn primary" onClick={() => fresh(state.size)}>
                Next puzzle
              </button>
            </>
          }
        >
          <p className="lg-answer">
            {state.hintCount === 0 ? "No hints used" : `${state.hintCount} hint${state.hintCount === 1 ? "" : "s"} used`}
          </p>
        </Overlay>
      )}
    </div>
  );
}

