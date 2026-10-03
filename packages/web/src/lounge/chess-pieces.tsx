// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import type { ChessPiece } from "@axl/extension-lounge";

import bB from "./pieces/bB.svg";
import bK from "./pieces/bK.svg";
import bN from "./pieces/bN.svg";
import bP from "./pieces/bP.svg";
import bQ from "./pieces/bQ.svg";
import bR from "./pieces/bR.svg";
import wB from "./pieces/wB.svg";
import wK from "./pieces/wK.svg";
import wN from "./pieces/wN.svg";
import wP from "./pieces/wP.svg";
import wQ from "./pieces/wQ.svg";
import wR from "./pieces/wR.svg";

/** Cburnett pieces by Colin M. L. Burnett, BSD-3-Clause. See ./pieces/README.md. */
const ART: Record<ChessPiece, string> = {
  K: wK,
  Q: wQ,
  R: wR,
  B: wB,
  N: wN,
  P: wP,
  k: bK,
  q: bQ,
  r: bR,
  b: bB,
  n: bN,
  p: bP,
};

export function PieceArt({ piece }: { readonly piece: ChessPiece }): React.JSX.Element {
  return <img className="chess-piece" src={ART[piece]} alt="" draggable={false} />;
}

export const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};
