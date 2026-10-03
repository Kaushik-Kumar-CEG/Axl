// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import type { ActivityStorageAdapter } from "@axl/extension-api";
import { type ComponentType, lazy, Suspense, useMemo, useState } from "react";

import "./lounge/lounge.css";
import { GameArt } from "./lounge/art.tsx";
import { type GameProps, Icon } from "./lounge/shared.tsx";
import type { LoungeSettings } from "./lounge-client.ts";

interface Game {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly Component: ComponentType<GameProps>;
}

const GAMES: readonly Game[] = [
  {
    id: "axl.lounge.codeword",
    name: "Wordle",
    blurb: "Find the hidden five-letter word in six tries.",
    Component: lazy(() => import("./lounge/wordle.tsx")),
  },
  {
    id: "axl.lounge.2048",
    name: "2048",
    blurb: "Slide and merge tiles to reach 2048.",
    Component: lazy(() => import("./lounge/game-2048.tsx")),
  },
  {
    id: "axl.lounge.minesweeper",
    name: "Minesweeper",
    blurb: "Clear the field without touching a mine.",
    Component: lazy(() => import("./lounge/minesweeper.tsx")),
  },
  {
    id: "axl.lounge.sudoku",
    name: "Sudoku",
    blurb: "Fill the grid so every row, column and box has 1 to 9.",
    Component: lazy(() => import("./lounge/sudoku.tsx")),
  },
  {
    id: "axl.lounge.chess-puzzles",
    name: "Chess puzzles",
    blurb: "Find the winning move in real tactical positions.",
    Component: lazy(() => import("./lounge/chess.tsx")),
  },
];

export interface LoungePaneProps {
  readonly storage: ActivityStorageAdapter;
  readonly settings: LoungeSettings;
  readonly onSettings: (update: Partial<LoungeSettings>) => void;
  readonly onClose: () => void;
}

/**
 * The Lounge: small games to play while the agent works. Each game keeps its progress in the
 * CLI-owned Lounge storage, so it survives restarts and is shared with the terminal client.
 */
export function LoungePane({
  storage,
  settings,
  onSettings,
  onClose,
}: LoungePaneProps): React.JSX.Element {
  const [activeId, setActiveId] = useState(settings.lastActivityId);
  const [chosen, setChosen] = useState(false);
  const [options, setOptions] = useState(false);
  const active = GAMES.find((game) => game.id === activeId);
  const motion = useMemo(
    () => !settings.reducedMotion && !matchMedia("(prefers-reduced-motion: reduce)").matches,
    [settings.reducedMotion],
  );

  const choose = (id: string | undefined): void => {
    setChosen(id !== undefined);
    setActiveId(id);
    setOptions(false);
    if (id !== undefined && id !== settings.lastActivityId) onSettings({ lastActivityId: id });
  };

  return (
    <aside
      className="lounge-pane"
      aria-label="Axl Lounge"
      data-motion={motion ? "on" : "off"}
    >
      <header className="lounge-header">
        <button
          type="button"
          className="lounge-brand"
          title="All games"
          aria-label="Lounge home"
          onClick={() => choose(undefined)}
        >
          <strong>Lounge</strong>
        </button>
        <nav className="lounge-tabs" aria-label="Games">
          {GAMES.map((game) => (
            <button
              key={game.id}
              type="button"
              aria-current={game.id === activeId ? "page" : undefined}
              onClick={() => choose(game.id)}
            >
              {game.name}
            </button>
          ))}
        </nav>
        <div className="lounge-actions">
          <button
            type="button"
            className="lounge-icon"
            aria-label="Lounge settings"
            aria-expanded={options}
            title="Settings"
            onClick={() => setOptions(!options)}
          >
            <Icon name="settings" />
          </button>
          <button
            type="button"
            className="lounge-icon"
            aria-label="Close Lounge"
            title="Close Lounge"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        {options && (
          <div className="lounge-menu" role="group" aria-label="Lounge settings">
            <Switch
              label="Animations"
              hint="Tile flips, slides and transitions"
              on={motion}
              onChange={(on) => onSettings({ reducedMotion: !on })}
            />
            <Switch
              label="Color-blind markers"
              hint="Add symbols so nothing depends on color alone"
              on={settings.textOnly}
              onChange={(on) => onSettings({ textOnly: on })}
            />
          </div>
        )}
      </header>

      <div className="lounge-stage">
        {active === undefined ? (
          <div className="lounge-library">
            <h2>Take a break</h2>
            <p>Pick a game while the agent works. Progress is saved automatically.</p>
            <div className="lounge-cards">
              {GAMES.map((game) => (
                <button key={game.id} type="button" className="lounge-card" onClick={() => choose(game.id)}>
                  <GameArt id={game.id} />
                  <strong>{game.name}</strong>
                  <span>{game.blurb}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="lg-center" role="status">
                <span className="lg-spinner" aria-hidden="true" />
              </div>
            }
          >
            <active.Component
              key={active.id}
              storage={storage}
              motion={motion}
              markers={settings.textOnly}
              autoFocus={chosen}
            />
          </Suspense>
        )}
      </div>
    </aside>
  );
}

function Switch({
  label,
  hint,
  on,
  onChange,
}: {
  readonly label: string;
  readonly hint: string;
  readonly on: boolean;
  readonly onChange: (on: boolean) => void;
}): React.JSX.Element {
  return (
    <button type="button" role="switch" aria-checked={on} className="lounge-switch" onClick={() => onChange(!on)}>
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
      <i aria-hidden="true" />
    </button>
  );
}
