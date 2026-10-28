import type { Player } from '../types';

/**
 * How many points the opponent's second-best reply has to cost for the position
 * to count as "only one good move". KaTrain-style score loss, not winrate: a
 * move can hold the winrate and still throw away points.
 */
export const TRICK_LOSS_THRESHOLD = 1.5;

/**
 * How far the opponent's second choice has to drop their winrate, below where
 * they stand before the candidate move, before it counts as a trap on its own.
 * Five percentage points, so a reply that gives up points but barely moves the
 * winrate still needs the point loss to qualify.
 */
export const TRICK_WINRATE_DROP = 0.05;

/** One board point that survived the scan, with the number behind it. */
export type TrickMoveMark = {
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
export type TrickMoveMarks = {
  nodeId: string;
  marks: TrickMoveMark[];
};

/** One reply as the engine reports it: black-perspective value and winrate. */
export type TrickReply = {
  /** Black-perspective score lead of the position after this reply. */
  scoreLead: number;
  /** Black-perspective winrate of the position after this reply. */
  winRate: number;
};

export type TrickReplyEvaluation = {
  /** Points the best reply loses, from the replying player's point of view. */
  topLoss: number;
  /** Points the second-best reply loses, or null when there is only one. */
  secondLoss: number | null;
  /** How far the opponent's second choice falls below where they stand now, in winrate. */
  winRateDrop: number | null;
  isTrick: boolean;
};

/**
 * Does playing here trap the player to move?
 *
 * The trick has three parts, all read from the engine's reply list:
 *
 * 1. The best reply holds the position: it loses less than `threshold` points.
 * 2. The opponent's second choice leaves them worse off than they are now: their
 *    winrate after it is below their winrate at the position *before* the
 *    candidate move. That is what makes the move a trick rather than merely a
 *    good move -- they had something to lose.
 * 3. That second choice is bad enough to matter on at least one measure: it
 *    loses `threshold` points or more, or it costs them more than
 *    `winRateDropThreshold` of winrate.
 *
 * `replies` are in the engine's rank order, so `replies[0]` is 一选 and
 * `replies[1]` is 二选. Scores and winrates are black-perspective, the frame
 * the engine reports; `baselineWinRate` is the black-perspective winrate of the
 * position before the candidate move.
 */
export function evaluateTrickReplies(args: {
  replies: readonly TrickReply[];
  rootScoreLead: number;
  baselineWinRate: number;
  /** The player who has to choose among the replies. */
  mover: Player;
  threshold?: number;
  winRateDropThreshold?: number;
}): TrickReplyEvaluation {
  const threshold = args.threshold ?? TRICK_LOSS_THRESHOLD;
  const sign = args.mover === 'black' ? 1 : -1;
  const replies = args.replies.filter(
    (reply) => Number.isFinite(reply.scoreLead) && Number.isFinite(reply.winRate)
  );
  if (replies.length < 2) {
    return { topLoss: 0, secondLoss: null, winRateDrop: null, isTrick: false };
  }
  const winRateDropThreshold = args.winRateDropThreshold ?? TRICK_WINRATE_DROP;
  const rootValue = sign * args.rootScoreLead;
  const topLoss = Math.max(0, rootValue - sign * replies[0]!.scoreLead);
  const secondLoss = Math.max(0, rootValue - sign * replies[1]!.scoreLead);
  // Both sides of the comparison are the opponent's winrate, so the difference
  // keeps its sign when the engine's frame is flipped back to theirs.
  const winRateDrop = sign * (args.baselineWinRate - replies[1]!.winRate);
  return {
    topLoss,
    secondLoss,
    winRateDrop,
    isTrick:
      topLoss < threshold &&
      ((secondLoss >= threshold && winRateDrop > 0) || winRateDrop > winRateDropThreshold),
  };
}

export type TrickRowState = {
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
export function summarizeTrickRow(args: {
  running: boolean;
  done: number;
  total: number;
  marks: readonly TrickMoveMark[] | null;
  /** Renders a board point as the app labels it, e.g. `Q16`. */
  formatPoint: (x: number, y: number) => string;
}): TrickRowState {
  const buttonLabel = 'Trick moves';
  if (args.running) {
    return {
      status: 'running',
      buttonLabel: 'Stop',
      summary: args.total > 0 ? `Finding trick moves… ${args.done}/${args.total}` : 'Finding trick moves…',
    };
  }
  if (!args.marks) {
    return {
      status: 'idle',
      buttonLabel,
      summary: 'Mark moves that leave the opponent one good reply and a second choice worse than now.',
    };
  }
  if (args.marks.length === 0) {
    return { status: 'ready', buttonLabel, summary: 'No trick moves here.' };
  }
  const points = args.marks.map((mark) => args.formatPoint(mark.x, mark.y)).join(', ');
  return {
    status: 'ready',
    buttonLabel,
    summary: `${args.marks.length} trick ${args.marks.length === 1 ? 'move' : 'moves'}: ${points}`,
  };
}
