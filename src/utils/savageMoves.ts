import type { Player } from '../types';

/**
 * How many points the opponent's second-best reply has to cost for the position
 * to count as "only one good move". KaTrain-style score loss, not winrate: a
 * move can hold the winrate and still throw away points, and it is the points
 * that make the reply unique.
 */
export const SAVAGE_LOSS_THRESHOLD = 3;

/** One board point that survived the scan, with the number behind it. */
export type SavageMoveMark = {
  x: number;
  y: number;
  /** Points the opponent's second-best reply loses in that position. */
  secondLoss: number;
};

/**
 * The marks of one node. Navigation does not clear them; consumers compare
 * `nodeId` so a scan that belongs to a position the reader has left stays out of
 * sight but comes back if they return.
 */
export type SavageMoveMarks = {
  nodeId: string;
  marks: SavageMoveMark[];
};

export type SavageReplyEvaluation = {
  /** Points the best reply loses, from the replying player's point of view. */
  topLoss: number;
  /** Points the second-best reply loses, or null when there is only one. */
  secondLoss: number | null;
  isSavage: boolean;
};

/**
 * Does this position leave the player to move only one reply that does not lose
 * points?
 *
 * `scores` are the black-perspective values of the position *after* each reply,
 * which is the frame the engine reports (KataGo is asked for
 * `reportAnalysisWinratesAs: 'BLACK'`, and the local worker stores its scores the
 * same way). `rootScoreLead` is the black-perspective value of the position
 * itself, so each reply's loss is measured against the position the player was
 * actually offered, and a position that is already lost cannot qualify: its best
 * reply loses the threshold by itself.
 *
 * The condition is the user's: the best reply loses less than `threshold` points
 * and the second-best loses at least `threshold`. Then there is exactly one move
 * that does not throw the game away.
 */
export function evaluateSavageReplies(args: {
  scores: readonly number[];
  rootScoreLead: number;
  /** The player who has to choose among the replies. */
  mover: Player;
  threshold?: number;
}): SavageReplyEvaluation {
  const threshold = args.threshold ?? SAVAGE_LOSS_THRESHOLD;
  const sign = args.mover === 'black' ? 1 : -1;
  const values = args.scores
    .filter((score) => Number.isFinite(score))
    .map((score) => sign * score)
    .sort((a, b) => b - a);
  if (values.length === 0) {
    return { topLoss: 0, secondLoss: null, isSavage: false };
  }
  const rootValue = sign * args.rootScoreLead;
  const topLoss = Math.max(0, rootValue - values[0]!);
  const secondLoss = values.length > 1 ? Math.max(0, rootValue - values[1]!) : null;
  return {
    topLoss,
    secondLoss,
    isSavage: secondLoss !== null && topLoss < threshold && secondLoss >= threshold,
  };
}

export type SavageRowState = {
  status: 'idle' | 'running' | 'ready';
  buttonLabel: string;
  summary: string;
};

/**
 * Everything the control needs to render, in one place so the desktop
 * dashboard and the mobile panel cannot disagree. `marks` must already be the
 * ones that belong to the current node; a scan of another position reads as if
 * no scan has been run here.
 */
export function summarizeSavageRow(args: {
  running: boolean;
  done: number;
  total: number;
  marks: readonly SavageMoveMark[] | null;
  /** Renders a board point as the app labels it, e.g. `Q16`. */
  formatPoint: (x: number, y: number) => string;
}): SavageRowState {
  const buttonLabel = 'Find savage moves';
  if (args.running) {
    return {
      status: 'running',
      buttonLabel: 'Stop',
      summary: args.total > 0 ? `Finding savage moves… ${args.done}/${args.total}` : 'Finding savage moves…',
    };
  }
  if (!args.marks) {
    return { status: 'idle', buttonLabel, summary: 'Mark moves that leave the opponent only one good reply.' };
  }
  if (args.marks.length === 0) {
    return { status: 'ready', buttonLabel, summary: 'No savage moves here.' };
  }
  const points = args.marks.map((mark) => args.formatPoint(mark.x, mark.y)).join(', ');
  return {
    status: 'ready',
    buttonLabel,
    summary: `${args.marks.length} savage ${args.marks.length === 1 ? 'move' : 'moves'}: ${points}`,
  };
}
