// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import { PieceArt } from "./chess-pieces.tsx";

/** Small illustrations for the game library. Pure markup, no game code. */
export function GameArt({ id }: { readonly id: string }): React.JSX.Element {
  if (id === "axl.lounge.codeword")
    return (
      <div className="art art-wordle" aria-hidden="true">
        {[
          ["R", ""],
          ["E", "present"],
          ["L", "exact"],
          ["A", ""],
          ["X", "exact"],
        ].map(([letter, kind]) => (
          <b key={letter} className={`lg-tile ${kind}`}>
            {letter}
          </b>
        ))}
      </div>
    );
  if (id === "axl.lounge.multiword")
    return (
      <div className="art art-multi" aria-hidden="true">
        {[
          ["", "exact", "", "present", ""],
          ["present", "", "exact", "", ""],
          ["exact", "exact", "present", "", "exact"],
          ["", "present", "", "exact", "exact"],
        ].map((board, boardIndex) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static art
          <div key={boardIndex}>
            {board.map((kind, tile) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static art
              <i key={tile} className={kind} />
            ))}
          </div>
        ))}
      </div>
    );
  if (id === "axl.lounge.2048")
    return (
      <div className="art art-2048" aria-hidden="true">
        {[2, 4, 8, 16].map((value) => (
          <b key={value} className={`g2048-tile v${value}`}>
            {value}
          </b>
        ))}
      </div>
    );
  if (id === "axl.lounge.minesweeper")
    return (
      <div className="art art-mines" aria-hidden="true">
        {["1", "1", "", "2", "", "1", "1", "⚑", "2", "", "1", "1"].map((value, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static art
          <b key={index} className={value === "⚑" ? "flag" : value === "" ? "open" : `open n${value}`}>
            {value}
          </b>
        ))}
      </div>
    );
  if (id === "axl.lounge.sudoku")
    return (
      <div className="art art-sudoku" aria-hidden="true">
        {["5", "3", "", "", "7", "", "6", "", "", "1", "9", "5"].map((value, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static art
          <b key={index}>{value}</b>
        ))}
      </div>
    );
  return (
    <div className="art art-chess" aria-hidden="true">
      {Array.from({ length: 16 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static art
        <i key={index} className={(Math.floor(index / 4) + index) % 2 === 0 ? "dark" : "light"} />
      ))}
      <span className="a-n">
        <PieceArt piece="N" />
      </span>
      <span className="a-k">
        <PieceArt piece="k" />
      </span>
    </div>
  );
}
