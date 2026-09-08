/**
 * KataGo Remote Analysis Engine — WebSocket protocol types.
 *
 * The remote server speaks the same JSON-line protocol KataGo uses over stdin/stdout.
 * See katrain/core/remote_engine.py for the Python reference implementation.
 */

import type { FloatArray, GameRules, Move, Player } from '../../types';

// ─── Query (what we send) ────────────────────────────────────────────────

export interface RemoteQuery {
  id: string;
  moves: Array<[string, string]>;
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

/** Convert 0-indexed board coordinates to a GTP string (e.g. "Q4"). */
export function coordToGtp(x: number, y: number, boardSize: number): string {
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

/**
 * Build the GTP move list from a move history for a remote query.
 * KataGo expects: [["B", "Q4"], ["W", "D16"], ...]
 */
export function buildMoveList(moveHistory: Move[]): Array<[string, string]> {
  return moveHistory.map((m) => {
    const player = m.player === 'black' ? 'B' : 'W';
    return [player, coordToGtp(m.x, m.y, 19)] as [string, string];
  });
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