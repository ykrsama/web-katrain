import type { CandidateMove } from '../types';

export type PvAnimationProgress = {
  /** Zero-based last PV move to reveal; the first move is visible immediately. */
  upToMove: number;
  /** Time until the picture can change again, or null once every move is shown. */
  nextDelayMs: number | null;
};

/**
 * PV animation is discrete: between move boundaries the board picture is
 * identical. Returning the next boundary lets the UI sleep instead of
 * repainting the whole workspace on every display frame.
 */
export function getPvAnimationProgress(
  elapsedMs: number,
  moveDelayMs: number,
  pvLength: number
): PvAnimationProgress {
  const length = Math.max(0, Math.trunc(pvLength));
  if (length <= 1) return { upToMove: 0, nextDelayMs: null };

  const delay = Math.max(1, moveDelayMs);
  const elapsed = Math.max(0, elapsedMs);
  const lastMoveIndex = length - 1;
  const step = Math.min(lastMoveIndex, Math.floor(elapsed / delay));
  if (step >= lastMoveIndex) return { upToMove: lastMoveIndex, nextDelayMs: null };

  return {
    upToMove: step,
    nextDelayMs: Math.max(1, (step + 1) * delay - elapsed),
  };
}

/** A hovered candidate together with the node it was read off. */
export type ScopedCandidateHover = { nodeId: string; move: CandidateMove };

/**
 * A hovered candidate and its variation are a read of one position: the win
 * rate, the sequence and the side to move that colours that sequence all come
 * from the node they were read off. Playing a stone does not move the pointer,
 * so the hover otherwise survives into the next position — where the same
 * variation is redrawn on the new board, replays from its first move, and takes
 * the colours of the side that is to move there instead.
 *
 * Scoping the hover to its node lets the reader drop it instead.
 */
export function hoveredMoveForNode(
  hover: ScopedCandidateHover | null,
  nodeId: string
): CandidateMove | null {
  return hover && hover.nodeId === nodeId ? hover.move : null;
}
