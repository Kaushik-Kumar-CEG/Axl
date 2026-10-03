// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import {
  createSudoku,
  parseSudokuSave,
  reduceSudoku,
  SUDOKU_CELLS,
  SUDOKU_STORAGE_SCHEMA_VERSION,
  type SudokuAction,
  type SudokuDifficulty,
  type SudokuSaveDocument,
  type SudokuState,
  sudokuConflicts,
  sudokuGivenValues,
  sudokuPeers,
  sudokuSaveJson,
  updateSudokuSave,
} from "@axl/extension-lounge";
import { useEffect, useMemo, useRef, useState } from "react";

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
} from "./shared.tsx";
import { useSlot } from "./use-slot.ts";

const LEVELS: readonly { value: SudokuDifficulty; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

const parse = (value: Parameters<typeof parseSudokuSave>[0]) => parseSudokuSave(value);

export default function Sudoku(props: GameProps): React.JSX.Element {
  const { phase, notice, reload, reset } = useSlot({
    storage: props.storage,
    scope: loungeScope("axl.lounge.sudoku"),
    schemaVersion: SUDOKU_STORAGE_SCHEMA_VERSION,
    parse,
  });
  if (phase.kind === "loading") return <GameLoading name="Sudoku" />;
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
      <Grid {...props} slot={phase.slot} loaded={phase.loaded} />
    </>
  );
}

function Grid({
  slot,
  loaded,
  markers,
  autoFocus,
}: GameProps & { readonly slot: SaveSlot; readonly loaded: SudokuSaveDocument | undefined }) {
  const root = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<SudokuState>(() => loaded?.game ?? createSudoku("easy", Date.now()));
  const stateRef = useRef(state);
  const [dismissed, setDismissed] = useState(false);
  const [menu, setMenu] = useState<SudokuDifficulty>();

  useEffect(() => {
    if (autoFocus) root.current?.focus({ preventScroll: true });
    if (loaded === undefined) slot.save(sudokuSaveJson(updateSudokuSave(stateRef.current)));
    // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per mounted grid
  }, []);

  const apply = (action: SudokuAction): void => {
    const next = reduceSudoku(stateRef.current, action);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
    if (next.status === "won" && action.type !== "restart") setDismissed(false);
    slot.save(sudokuSaveJson(updateSudokuSave(next)));
  };
  const fresh = (difficulty: SudokuDifficulty): void => {
    setDismissed(false);
    apply({ type: "restart", difficulty, seed: Date.now() });
  };

  const givens = useMemo(() => sudokuGivenValues(state), [state.fixtureId]);
  const conflicts = useMemo(() => sudokuConflicts(state.values), [state.values]);
  const peers = useMemo(() => new Set(sudokuPeers(state.selected)), [state.selected]);
  const selectedValue = state.values[state.selected] ?? 0;
  const remaining = Array.from({ length: 9 }, (_, i) =>
    9 - state.values.filter((value) => value === i + 1).length,
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: the grid handles keys for the whole game
    <div
      ref={root}
      className="lg lg-sudoku"
      role="application"
      aria-label="Sudoku"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const arrows = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const;
        const direction = arrows[event.key as keyof typeof arrows];
        if (direction !== undefined) {
          event.preventDefault();
          apply({ type: "move", direction });
        } else if (/^[1-9]$/u.test(event.key)) apply({ type: "digit", digit: Number(event.key) });
        else if (["Backspace", "Delete", "0"].includes(event.key)) {
          event.preventDefault();
          apply({ type: "erase" });
        } else if (event.key.toLowerCase() === "n") apply({ type: "toggle-notes" });
        else if (event.key.toLowerCase() === "u" || event.key.toLowerCase() === "z") apply({ type: "undo" });
        else if (event.key.toLowerCase() === "h") apply({ type: "hint" });
      }}
      onPointerDown={(event) => {
        if (!(event.target as HTMLElement).closest("button")) root.current?.focus();
      }}
    >
      <div className="lg-bar">
        <div className="lg-title">
          <strong>Sudoku</strong>
          <span className="lg-sub">{LEVELS.find((level) => level.value === state.difficulty)?.label}</span>
        </div>
        <div className="lg-scores">
          <div>
            <small>Hints</small>
            <b>{state.hintCount}</b>
          </div>
        </div>
      </div>

      <div className="lg-fit">
        <div className="sudoku-grid" role="grid" aria-label="Sudoku board">
          {Array.from({ length: SUDOKU_CELLS }, (_, index) => {
            const value = state.values[index] ?? 0;
            const given = (givens[index] ?? 0) !== 0;
            const notes = state.notes[index] ?? 0;
            const bad = conflicts.has(index);
            const cls = [
              "sudoku-cell",
              given ? "given" : "",
              state.hinted[index] ? "hinted" : "",
              index === state.selected ? "selected" : peers.has(index) ? "peer" : "",
              value !== 0 && value === selectedValue && index !== state.selected ? "same" : "",
              bad ? "conflict" : "",
              index % 9 === 2 || index % 9 === 5 ? "edge-r" : "",
              Math.floor(index / 9) === 2 || Math.floor(index / 9) === 5 ? "edge-b" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={`${state.fixtureId}-${index}`}
                type="button"
                tabIndex={-1}
                className={cls}
                aria-label={`Row ${Math.floor(index / 9) + 1}, column ${(index % 9) + 1}, ${
                  value === 0 ? "empty" : value
                }${given ? ", given" : ""}${bad ? ", conflict" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => apply({ type: "select", index })}
              >
                {value !== 0 ? (
                  <span>
                    {value}
                    {markers && bad && <i aria-hidden="true">!</i>}
                  </span>
                ) : (
                  notes !== 0 && (
                    <span className="sudoku-notes" aria-hidden="true">
                      {Array.from({ length: 9 }, (_, d) => (
                        <b key={`${d + 1}`}>{notes & (1 << (d + 1)) ? d + 1 : ""}</b>
                      ))}
                    </span>
                  )
                )}
              </button>
            );
          })}
        </div>

        <div className="sudoku-pad" role="group" aria-label="Number pad">
          {Array.from({ length: 9 }, (_, i) => (
            <button
              key={`${i + 1}`}
              type="button"
              tabIndex={-1}
              disabled={remaining[i] === 0}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => apply({ type: "digit", digit: i + 1 })}
            >
              <span>{i + 1}</span>
              <small>{remaining[i]}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="lg-dock">
        <IconButton icon="undo" label="Undo" onClick={() => apply({ type: "undo" })} disabled={state.history.length === 0} />
        <IconButton icon="eraser" label="Erase cell" onClick={() => apply({ type: "erase" })} />
        <IconButton
          icon="pencil"
          label="Pencil notes"
          text={state.notesMode ? "Notes on" : "Notes"}
          pressed={state.notesMode}
          onClick={() => apply({ type: "toggle-notes" })}
        />
        <IconButton icon="hint" label="Reveal one cell" text="Hint" onClick={() => apply({ type: "hint" })} />
        <IconButton icon="plus" label="New puzzle" onClick={() => setMenu(state.difficulty)} />
      </div>

      {menu !== undefined && (
        <Overlay
          title="New puzzle"
          actions={
            <>
              <button type="button" className="lg-btn" onClick={() => setMenu(undefined)}>
                Cancel
              </button>
              <button
                type="button"
                className="lg-btn primary"
                onClick={() => {
                  fresh(menu);
                  setMenu(undefined);
                }}
              >
                Start
              </button>
            </>
          }
        >
          <div className="lg-field">
            <span>Difficulty</span>
            <Segmented label="Difficulty" value={menu} options={LEVELS} onChange={setMenu} />
          </div>
        </Overlay>
      )}

      {state.status === "won" && !dismissed && (
        <Overlay
          title="Solved"
          tone="win"
          actions={
            <>
              <button type="button" className="lg-btn" onClick={() => setDismissed(true)}>
                View board
              </button>
              <button type="button" className="lg-btn primary" onClick={() => fresh(state.difficulty)}>
                New puzzle
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
