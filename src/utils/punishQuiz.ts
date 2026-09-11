import type { CandidateMove, GameNode } from '../types';
import { computeNodePointsLost } from './nodeAnalysis';
import { BLUNDER_LOSS } from './moveTreeNodeMarkers';
import { formatBoardMoveLabel } from './playedMoveQuality';
import { t } from '../i18n';

// Auto-triggered "find the punish" quiz: offered when the move just played
// was a blunder and the position has analysis to grade a guess against.

export interface PunishQuizPrompt {
  /** Side that blundered, e.g. 'White'. */
  blunderer: 'Black' | 'White';
  /** Side to answer for. */
  punisher: 'Black' | 'White';
  pointsLost: number;
}

export interface PunishQuizVerdict {
  verdict: 'best' | 'close' | 'miss';
  bestLabel: string;
  guessLabel: string;
  guessPointsLost: number | null;
}

function bestCandidate(moves: CandidateMove[]): CandidateMove | null {
  return moves.find((m) => m.order === 0) ?? moves[0] ?? null;
}

export function getPunishQuizPrompt(node: GameNode, mistakeThreshold: number): PunishQuizPrompt | null {
  const move = node.move;
  if (!move || move.x < 0 || move.y < 0 || !node.parent) return null;
  const pointsLost = computeNodePointsLost(node);
  if (typeof pointsLost !== 'number' || pointsLost < Math.max(mistakeThreshold, BLUNDER_LOSS)) return null;
  const moves = node.analysis?.moves;
  if (!moves?.length) return null;
  const best = bestCandidate(moves);
  if (!best || best.x < 0 || best.y < 0) return null;
  const blunderer = move.player === 'black' ? 'Black' : 'White';
  return {
    blunderer,
    punisher: blunderer === 'Black' ? 'White' : 'Black',
    pointsLost,
  };
}

// A guess counts as "close" when it gives up at most this much vs the best answer.
const CLOSE_GUESS_LOSS = 1.5;

export function gradePunishGuess(node: GameNode, guess: { x: number; y: number }): PunishQuizVerdict | null {
  const moves = node.analysis?.moves;
  if (!moves?.length) return null;
  const best = bestCandidate(moves);
  if (!best) return null;
  const boardSize = node.gameState.board.length;
  const bestLabel = formatBoardMoveLabel(best, boardSize);
  const guessLabel = formatBoardMoveLabel(guess, boardSize);
  if (best.x === guess.x && best.y === guess.y) {
    return { verdict: 'best', bestLabel, guessLabel, guessPointsLost: 0 };
  }
  const candidate = moves.find((m) => m.x === guess.x && m.y === guess.y);
  const guessPointsLost = typeof candidate?.pointsLost === 'number' && Number.isFinite(candidate.pointsLost)
    ? candidate.pointsLost
    : null;
  if (guessPointsLost !== null && guessPointsLost <= CLOSE_GUESS_LOSS) {
    return { verdict: 'close', bestLabel, guessLabel, guessPointsLost };
  }
  return { verdict: 'miss', bestLabel, guessLabel, guessPointsLost };
}

export function punishQuizPromptText(prompt: PunishQuizPrompt): string {
  return t('{blunderer} just lost {points} points — find the punish!', {
    blunderer: t(prompt.blunderer),
    points: prompt.pointsLost.toFixed(1),
  });
}

export function punishQuizVerdictText(verdict: PunishQuizVerdict): string {
  if (verdict.verdict === 'best') return t("Spot on — {move} is the engine's top punish.", { move: verdict.bestLabel });
  if (verdict.verdict === 'close') {
    const lost = verdict.guessPointsLost ?? 0;
    return t(
      "{guess} works (−{lost} vs best). Engine's pick: {move}.",
      { guess: verdict.guessLabel, lost: lost.toFixed(1), move: verdict.bestLabel }
    );
  }
  return t('Not quite — the engine punishes with {move}.', { move: verdict.bestLabel });
}
