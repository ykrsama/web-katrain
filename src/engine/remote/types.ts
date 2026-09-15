/**
 * KataGo Remote Analysis Engine — WebSocket protocol types.
 *
 * The remote server speaks the same JSON-line protocol KataGo uses over stdin/stdout.
 * See katrain/core/remote_engine.py for the Python reference implementation.
 */

import type { BoardState, FloatArray, GameRules, Move, Player } from '../../types';
import { applyCapturesInPlace } from '../../utils/gameLogic';

// ─── Query (what we send) ────────────────────────────────────────────────

export interface RemoteQuery {
  id: string;
  moves: Array<[string, string]>;
  /**
   * Stones already on the board before `moves` (SGF AB/AW, handicap stones,
   * photo-board imports). KataGo applies `moves` on top of these.
   */
  initialStones?: Array<[string, string]>;
  /** Side to move before `moves`; KataGo alternates from here. */
  initialPlayer?: 'B' | 'W';
  rules: string;
  komi: number;
  boardXSize: number;
  boardYSize: number;
  maxVisits?: number;
  maxTime?: number;
  includePolicy?: boolean;
  includeOwnership?: boolean;
  includeMovesOwnership?: boolean;
  includePVVisits?: boolean;
  analysisPVLen?: number;
  reportDuringSearchEvery?: number;
  overrideSettings?: Record<string, unknown>;
  topK?: number;
  // KataGo 1.14+ "avoidMoves": array of moves the search may not play at the root.
  avoidMoves?: Array<{ move: string; player?: string; untilDepth?: number }>;
  // KataGo 1.14+ "allowMoves": the complement of avoidMoves.
  allowMoves?: Array<{ moves: string[]; player?: string; untilDepth?: number }>;
}

// ─── Response (what we receive) ──────────────────────────────────────────

export interface RemoteMoveInfo {
  move: string;
  visits: number;
  winrate: number;
  scoreLead: number;
  scoreSelfplay: number;
  scoreStdev: number;
  prior: number;
  pv: string[];
  order: number;
  /** Per-move ownership (len boardSize*boardSize), +1 black, -1 white. */
  ownership?: FloatArray;
  /** Visits at each move of the PV. */
  pvVisits?: number[];
  /** LCB in winrate scale, black perspective. */
  lcb?: number;
  /** Utility LCB, black perspective. */
  utilityLcb?: number;
  /** KataGo play selection value. */
  playSelectionValue?: number;
  /** Utility average. */
  utility?: number;
  /** Weight behind this child. */
  weight?: number;
  /** The share of weight this edge bought. */
  edgeWeight?: number;
  /** Visits the root paid for this child. */
  edgeVisits?: number;
  /** Chance this move's subtree ends with no result. */
  noResultValue?: number;
}

export interface RemoteRootInfo {
  winrate: number;
  scoreLead: number;
  scoreSelfplay: number;
  scoreStdev: number;
  visits: number;
  /** Raw network outputs (before search). */
  rawWinrate?: number;
  rawScoreLead?: number;
  rawScoreSelfplay?: number;
  rawScoreSelfplayStdev?: number;
  rawNoResultProb?: number;
  rawStWrError?: number;
  rawStScoreError?: number;
  rawVarTimeLeft?: number;
}

export interface RemoteResponse {
  id: string;
  moveInfos: RemoteMoveInfo[];
  rootInfo: RemoteRootInfo;
  isDuringSearch: boolean;
  /** Present when the query failed. */
  error?: string;
  /** Present when the engine has a non-fatal warning. */
  warning?: string;
  /** Present for terminate responses. */
  terminateId?: string;
  /** True when there are no results (e.g. query on a finished game). */
  noResults?: boolean;
}

// ─── GTP coordinate helpers ──────────────────────────────────────────────

const GTP_COLS = 'ABCDEFGHJKLMNOPQRST';

/** Convert 0-indexed board coordinates to a GTP string (e.g. "Q4"), or "pass" for (-1,-1). */
export function coordToGtp(x: number, y: number, boardSize: number): string {
  if (x === -1 && y === -1) return 'pass';
  return GTP_COLS[x] + String(boardSize - y);
}

/** Convert a GTP string (e.g. "Q4") to 0-indexed board coordinates. */
export function gtpToCoord(s: string, boardSize: number): { x: number; y: number } | null {
  const t = s.trim().toUpperCase();
  if (t === 'PASS' || t === '') return null;
  const m = /^([A-HJ-T])([1-9]\d?)$/.exec(t);
  if (!m) return null;
  const col = m[1]!;
  const x = col.charCodeAt(0) - 65 - (col > 'I' ? 1 : 0);
  const row = Number.parseInt(m[2]!, 10);
  const y = boardSize - row;
  if (x < 0 || x >= boardSize || y < 0 || y >= boardSize) return null;
  return { x, y };
}

/** A position split into the fields KataGo's analysis protocol expects. */
export type RemoteQueryPosition = {
  /** Stones on the board before any move. */
  initialStones: Array<[string, string]>;
  /** Move history, replayed on top of `initialStones`. */
  moves: Array<[string, string]>;
  /** Side to move before `moves`; KataGo alternates from here. */
  initialPlayer: 'B' | 'W';
};

const colorToKataGo = (player: Player): 'B' | 'W' => (player === 'black' ? 'B' : 'W');

/** Every stone on a board, as KataGo [color, location] pairs. */
const stonesOnBoard = (board: BoardState, boardSize: number): Array<[string, string]> => {
  const stones: Array<[string, string]> = [];
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      const stone = board[y]?.[x] ?? null;
      if (stone) stones.push([colorToKataGo(stone), coordToGtp(x, y, boardSize)]);
    }
  }
  return stones;
};

/** Replay `initialStones` + `moveHistory`, captures included. */
const replayPosition = (
  initialStones: Array<[string, string]>,
  moveHistory: Move[],
  boardSize: number,
): BoardState => {
  const board: BoardState = Array.from({ length: boardSize }, () => Array<Player | null>(boardSize).fill(null));
  for (const [color, gtp] of initialStones) {
    const point = gtpToCoord(gtp, boardSize);
    if (point) board[point.y]![point.x] = color === 'B' ? 'black' : 'white';
  }
  for (const move of moveHistory) {
    if (move.x < 0 || move.y < 0) continue;
    board[move.y]![move.x] = move.player;
    applyCapturesInPlace(board, move.x, move.y, move.player);
  }
  return board;
};

const boardsEqual = (a: BoardState, b: BoardState, boardSize: number): boolean => {
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      if ((a[y]?.[x] ?? null) !== (b[y]?.[x] ?? null)) return false;
    }
  }
  return true;
};

/**
 * Split a board plus its move history into the two fields KataGo's analysis
 * protocol expects: `initialStones` (stones that no move placed) and `moves`.
 *
 * Setup stones are not moves. Sending them as moves — the previous approach,
 * which also only looked at Black's — drops every White setup stone, breaks
 * move alternation, and leaves Black to move when the history is empty. A
 * photo-board import has no history at all, so the remote engine analysed a
 * position with only the Black stones on it.
 *
 * A board that its own history cannot reproduce (a stone erased or added in
 * edit mode) falls back to a pure setup position: the whole board as
 * `initialStones` with no moves, the only honest description of a position
 * that is not a legal continuation.
 */
export function buildQueryPosition(
  moveHistory: Move[],
  board: BoardState,
  boardSize: number,
  currentPlayer: Player,
): RemoteQueryPosition {
  const movePositions = new Set<string>();
  for (const m of moveHistory) {
    if (m.x >= 0 && m.y >= 0) movePositions.add(`${m.x},${m.y}`);
  }

  const initialStones: Array<[string, string]> = [];
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      const stone = board[y]?.[x] ?? null;
      if (!stone || movePositions.has(`${x},${y}`)) continue;
      initialStones.push([colorToKataGo(stone), coordToGtp(x, y, boardSize)]);
    }
  }

  if (!boardsEqual(replayPosition(initialStones, moveHistory, boardSize), board, boardSize)) {
    return {
      initialStones: stonesOnBoard(board, boardSize),
      moves: [],
      initialPlayer: colorToKataGo(currentPlayer),
    };
  }

  return {
    initialStones,
    moves: moveHistory.map((m) => [colorToKataGo(m.player), coordToGtp(m.x, m.y, boardSize)]),
    // KataGo alternates from `initialPlayer`, so it has to be the player of the
    // first move; with no moves it is whoever is to move on the board.
    initialPlayer: colorToKataGo(moveHistory[0]?.player ?? currentPlayer),
  };
}

/**
 * Convert a rules enum to the string KataGo expects.
 */
export function rulesToKataGoString(rules: GameRules): string {
  // Map web-katrain's rules to KataGo's expected names.
  const map: Record<GameRules, string> = {
    japanese: 'japanese',
    chinese: 'chinese',
    korean: 'korean',
    aga: 'aga',
    'new-zealand': 'new_zealand',
    'tromp-taylor': 'tromp_taylor',
    'stone-scoring': 'stone_scoring',
  };
  return map[rules] ?? 'japanese';
}