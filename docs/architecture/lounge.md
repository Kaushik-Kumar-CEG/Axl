<!-- SPDX-FileCopyrightText: 2026 Kaushik Kumar -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Axl Lounge architecture

Status: implemented terminal and web client feature

## Scope

Axl Lounge provides five offline games for the terminal and web clients: Wordle, 2048, Minesweeper, Sudoku, and Chess Puzzles. The Lounge package contains deterministic game rules and semantic activity renderers. It uses only the public `terminal.activities` and `terminal.activity-storage` extension capabilities.

## Authority and ownership

The daemon remains the sole authority for sessions, canonical events, model work, queues, and mutations. Lounge games do not append canonical events, call the daemon, or alter a session. Protocol, SDK, kernel, daemon, runtime, AI, and sandbox authority are unchanged.

The TUI owns activity registration, layout, focus, attention priority, input decoding, mouse-coordinate translation, rendering, scheduling, the live Agent transcript and composer, and cleanup. Agent input continues through the existing editor, history, completion, attachment, Vim, queue, Ctrl+O, transcript, and submission paths. The CLI composes the Lounge extension and implements bounded local activity storage.

The Lounge package does not import the TUI, SDK, CLI, daemon, runtime, kernel, sandbox, AI, filesystem, networking, or private host internals. Disabled Lounge performs no registration, storage access, timer work, or background work.

## Web client

The web client does not render terminal frames. `packages/web` has a native React interface for each game (`src/lounge/`). Each one imports the pure rule engines and save codecs that `@axl/extension-lounge` exports, so rules, deterministic selection, and the save format are shared with the terminal. The web games reimplement only presentation and the save orchestration (`save-slot.ts`: ordered writes, revision checks, merge of completion records after a conflict). Each game is a lazy chunk, so a game's data loads only when it is opened. The Chess puzzle catalog is imported from the `@axl/extension-lounge/chess-puzzles` subpath.

The Chess board follows the look of Lichess. The pieces are the Cburnett set from Wikimedia Commons, used under BSD-3-Clause (see `packages/web/src/lounge/pieces/README.md`, `NOTICE`, and `LICENSES/BSD-3-Clause.txt`). No Lichess source code or hosted asset is used. The puzzle data is the Lichess puzzle database (CC0).

The settings are shared with the terminal. "Animations" is the inverse of `reducedMotion`. "Color-blind markers" is `textOnly` and adds symbols so state never depends on color alone.

Lounge occupies the right half of the page. On narrow screens it occupies the top and the app the bottom. All app responsive decisions follow the app frame (`.app-frame`) instead of the window, and the app's overlays are positioned inside that frame. The pane is shown by default and the `/lounge` command or the pane's close button hides it. The choice is a host web preference (`loungeOpen`).

The browser has no filesystem access. Saves and settings go through the gateway, which uses the same CLI-owned `LoungeStorage` as the terminal. The gateway exposes `lounge/storage` and `lounge/settings` only when Lounge is enabled in `settings.json`, and the browser never receives a path. Activities pause while the page is hidden or the pane is too small, and the pane unmounts, and disposes every activity, when it closes.

## Public capabilities

`terminal.activities` registers semantic activities through a host-owned lifecycle. Activities receive bounded input, focus and visibility changes, rendering dimensions, a monotonic clock, and tracked scheduling. Every registration and callback has deterministic cleanup. The host validates mouse input and translates terminal coordinates before delivery. Game-specific input and rendering do not create TUI host branches.

`terminal.activity-storage` provides namespaced, size-bounded local records with compare-and-swap updates. The CLI canonicalizes and validates stored data, writes atomically, limits aggregate and per-record size, and performs bounded cleanup. Storage is client-local and never becomes session state.

## Layout, attention, and input

Compact terminals show one surface at a time. Wide terminals retain the normal live Agent transcript and composer on the left while the game or game library occupies the right. `Tab` changes pane focus when Agent-local completion does not own it. `Ctrl+P` opens the game library when multiple games are registered.

Canonical interaction requests and host overlays have priority over Lounge input. Agent editing retains its normal key paths. An activity receives input only while it is visible, eligible, and focused. Focus loss, undersize, suspension, replacement, and disposal cancel decorative work and pause active timers where applicable.

## Determinism, accessibility, and cleanup

Callers supply dates, seeds, clocks, and scheduled callbacks. Game engines do not read global randomness or the system clock. Saves are versioned and validated before use. Concurrent active Wordle boards use compare-and-swap and never merge implicitly.

Every game has a text-only semantic frame and non-color distinctions. Reduced-motion mode skips decorative timing. Keyboard navigation works with arrows and HJKL where applicable. Layouts preserve readable status and controls at supported compact, standard, and wide sizes. Chess may provide a validated indexed raster alongside its semantic frame. The generic TUI raster layer owns terminal support detection, Sixel transport, calibrated cell placement, and pointer normalization. Missing support or cell metrics leaves the semantic frame active.

Disabling or disposing Lounge removes registrations, listeners, timers, queued callbacks, and local host state. Games perform no networking and require no production dependency.

## Shipped games

- **Wordle:** reviewed offline dictionaries, duplicate-aware scoring, normal and hard modes, deterministic daily and practice selection, and six attempts.
- **2048:** deterministic spawning, one merge per tile per move, exact one-move undo, win continuation, and game-over detection.
- **Minesweeper:** delayed deterministic placement, safe first reveal and neighbors, three presets, flags, chords, viewport navigation, mouse input, and active-play timing.
- **Sudoku:** twelve versioned unique-solution puzzles, three difficulties, notes, conflicts, hints, undo, and a traditional grid with strong 3×3 separators.
- **Chess Puzzles:** 1,000 reviewed Lichess tactics, immutable legal move validation, deterministic Daily and Practice selection, exact sourced-line progression, keyboard and mouse controls, progressive hints, explicit promotion choice, and bounded statistics.

Word data provenance and verification are documented in [`../../packages/extensions/lounge/data/codeword/README.md`](../../packages/extensions/lounge/data/codeword/README.md). Sudoku fixture generation is documented in [`../../packages/extensions/lounge/data/sudoku/README.md`](../../packages/extensions/lounge/data/sudoku/README.md). Chess source, review, licensing, and reproducible generation are documented in [`../../packages/extensions/lounge/data/chess/README.md`](../../packages/extensions/lounge/data/chess/README.md).

## Verification

Run focused checks with:

```bash
pnpm --filter @axl/extension-api test
pnpm --filter @axl/extension-lounge test
pnpm --filter @axl/tui test
pnpm --filter @axl/cli test
pnpm --filter @axl/web test
pnpm --filter @axl/extension-lounge benchmark
pnpm --filter @axl/tui benchmark
pnpm check:generated
pnpm check:boundaries
reuse lint
```

Manual PTY review covers 40×24, 80×24, and 120×30 terminals. It checks responsive focus, the live wide Agent pane, keyboard-only and mouse-only completion, calibrated raster pointer mapping, unsupported-terminal and missing-cell-metric fallback, reduced motion, text-only output, resize, reload, disable, pause, and disposal cleanup. Sudoku review also covers movement, notes, hint confirmation, undo, and strong 3×3 separators.

## Deferred work

Productive mode and Vibe mode remain deferred. They are not part of the implemented Lounge surface.
