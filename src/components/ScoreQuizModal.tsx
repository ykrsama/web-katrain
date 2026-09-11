import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FaTimes, FaDice, FaCheck } from 'react-icons/fa';
import { useGameStore } from '../store/gameStore';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { useInitialDialogFocus } from '../hooks/useInitialDialogFocus';
import { StaticBoard } from './StaticBoard';
import { evaluateNode } from '../utils/positionEval';
import { collectQuizPositions, selectQuizJumpCandidates } from '../utils/scoreQuizPositions';
import { useT } from '../i18n';

interface ScoreQuizModalProps {
  onClose: () => void;
}

type Phase = 'guess' | 'evaluating' | 'reveal';
type Winner = 'black' | 'white';

interface QuizStats {
  rounds: number;
  sumError: number;
  leaderHits: number;
}

const ratingFor = (error: number): { label: string; tone: string } => {
  if (error <= 1.5) return { label: 'Perfect read', tone: 'var(--ui-success, #38a169)' };
  if (error <= 4) return { label: 'Great estimate', tone: 'var(--ui-success, #38a169)' };
  if (error <= 8) return { label: 'Close', tone: 'var(--ui-warning, #d69e2e)' };
  return { label: 'Off the mark', tone: 'var(--ui-danger, #e53e3e)' };
};

export const ScoreQuizModal: React.FC<ScoreQuizModalProps> = ({ onClose }) => {
  useEscapeToClose(onClose);
  const dialogRef = useInitialDialogFocus<HTMLDivElement>();
  const t = useT();

  const currentNode = useGameStore((s) => s.currentNode);
  const rootNode = useGameStore((s) => s.rootNode);
  const settings = useGameStore((s) => s.settings);
  const jumpToNode = useGameStore((s) => s.jumpToNode);

  const [phase, setPhase] = useState<Phase>('guess');
  const [winner, setWinner] = useState<Winner>('black');
  const [margin, setMargin] = useState<string>('5');
  const [actual, setActual] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [stats, setStats] = useState<QuizStats>({ rounds: 0, sumError: 0, leaderHits: 0 });

  const nodeId = currentNode.id;
  const board = currentNode.gameState.board;
  const moveNumber = currentNode.gameState.moveHistory.length;
  const lastMove = currentNode.move && currentNode.move.x >= 0
    ? { x: currentNode.move.x, y: currentNode.move.y }
    : null;

  // Reset the round whenever the quizzed position changes (adjust state during
  // render, the React-recommended alternative to a reset effect).
  const [roundNodeId, setRoundNodeId] = useState(nodeId);
  if (nodeId !== roundNodeId) {
    setRoundNodeId(nodeId);
    setPhase('guess');
    setActual(null);
    setErrorMsg(null);
  }

  const handleReveal = useCallback(async () => {
    setErrorMsg(null);
    setPhase('evaluating');
    try {
      const result = await evaluateNode(currentNode, settings);
      const lead = result.blackScoreLead;
      setActual(lead);
      const signedGuess = (winner === 'black' ? 1 : -1) * Math.abs(Number(margin) || 0);
      const err = Math.abs(signedGuess - lead);
      const leaderRight = Math.sign(signedGuess) === Math.sign(lead) || Math.abs(lead) < 0.5;
      setStats((s) => ({
        rounds: s.rounds + 1,
        sumError: s.sumError + err,
        leaderHits: s.leaderHits + (leaderRight ? 1 : 0),
      }));
      setPhase('reveal');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('Evaluation failed. Is the engine loaded?'));
      setPhase('guess');
    }
  }, [currentNode, settings, winner, margin]);

  const quizPositions = useMemo(() => collectQuizPositions(rootNode), [rootNode]);

  const handleRandom = useCallback(() => {
    if (quizPositions.length === 0) return;
    const pickFrom = selectQuizJumpCandidates(quizPositions, nodeId);
    const pick = pickFrom[Math.floor(Math.random() * pickFrom.length)];
    if (pick && pick.id !== nodeId) {
      jumpToNode(pick);
      return;
    }
    // Only one position to quiz: reset the round anyway.
    setPhase('guess');
    setActual(null);
  }, [quizPositions, jumpToNode, nodeId]);

  const signedGuess = (winner === 'black' ? 1 : -1) * Math.abs(Number(margin) || 0);
  const roundError = actual !== null ? Math.abs(signedGuess - actual) : 0;
  const rating = useMemo(() => ratingFor(roundError), [roundError]);
  const avgError = stats.rounds > 0 ? stats.sumError / stats.rounds : 0;

  const marginInputRef = useRef<HTMLInputElement>(null);

  const actualLeader: Winner | 'even' = actual === null
    ? 'even'
    : Math.abs(actual) < 0.5 ? 'even' : actual > 0 ? 'black' : 'white';

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-3 mobile-safe-inset mobile-safe-area-bottom"
      onClick={onClose}
    >
      <div
        className="ui-panel flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-lg border shadow-xl"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="score-quiz-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="score-quiz-header ui-bar flex items-center justify-between border-b border-[var(--ui-border)] px-4 py-3">
          <h2 id="score-quiz-title" className="text-lg font-semibold text-[var(--ui-text)]">
            {t('Score Estimation Quiz')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ui-control grid place-items-center rounded-lg text-[var(--ui-text-muted)] hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-text)]"
            aria-label={t('Close quiz')}
          >
            <FaTimes aria-hidden="true" />
          </button>
        </div>

        <div className="score-quiz-body flex-1 space-y-4 overflow-y-auto p-4">
          <p className="score-quiz-intro text-sm text-[var(--ui-text-muted)]">
            {quizPositions.length === 0
              ? t('This is the starting position. Play some moves or open a game for a more meaningful score estimate.')
              : (
                  <>
                    <span className="score-quiz-instructions">{t('Read the position, then estimate who is ahead and by how many points.')}</span>{' '}
                    {t('Move {n}.', { n: moveNumber })}
                  </>
                )}
          </p>

          <div className="score-quiz-board mx-auto w-full max-w-[340px]">
            <StaticBoard board={board} lastMove={lastMove} ariaLabel={t('Quiz position at move {n}', { n: moveNumber })} />
          </div>

          {phase !== 'reveal' ? (
            <div className="score-quiz-response space-y-3">
              <div className="score-quiz-leader-label text-sm font-semibold text-[var(--ui-text)]">{t('Who is ahead?')}</div>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('Predicted leader')}>
                {(['black', 'white'] as Winner[]).map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setWinner(w)}
                    aria-pressed={winner === w}
                    className={`min-h-11 rounded-lg border px-4 py-2 text-sm font-semibold capitalize ${
                      winner === w
                        ? 'border-[var(--ui-accent)] bg-[var(--ui-accent-soft,var(--ui-surface-2))] text-[var(--ui-text)]'
                        : 'border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-surface-2)]'
                    }`}
                  >
                    {t(w === 'black' ? 'Black' : 'White')}
                  </button>
                ))}
              </div>
              <label className="flex items-center justify-between gap-3 text-sm text-[var(--ui-text)]">
                <span className="font-semibold">{t('By how many points?')}</span>
                <input
                  ref={marginInputRef}
                  type="number"
                  min={0}
                  step={0.5}
                  value={margin}
                  onChange={(e) => setMargin(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleReveal(); }}
                  className="min-h-11 w-24 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 text-right text-[var(--ui-text)]"
                />
              </label>
              {errorMsg && (
                <div className="rounded border border-[var(--ui-danger)] bg-[var(--ui-danger-soft)] px-3 py-2 text-sm text-[var(--ui-danger)]">
                  {errorMsg}
                </div>
              )}
            </div>
          ) : (
            <div className="score-quiz-response space-y-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-2)] p-3 text-sm">
              <div className="text-base font-semibold" style={{ color: rating.tone }}>{t(rating.label)}</div>
              <div className="flex justify-between text-[var(--ui-text)]">
                <span>{t('Actual')}</span>
                <span className="font-semibold">
                  {actualLeader === 'even'
                    ? t('Even')
                    : `${t(actualLeader === 'black' ? 'Black' : 'White')} +${Math.abs(actual ?? 0).toFixed(1)}`}
                </span>
              </div>
              <div className="flex justify-between text-[var(--ui-text-muted)]">
                <span>{t('Your guess')}</span>
                <span>{`${t(winner === 'black' ? 'Black' : 'White')} +${Math.abs(Number(margin) || 0).toFixed(1)}`}</span>
              </div>
              <div className="flex justify-between text-[var(--ui-text-muted)]">
                <span>{t('Off by')}</span>
                <span>{t('{n} pts', { n: roundError.toFixed(1) })}</span>
              </div>
            </div>
          )}

          {stats.rounds > 0 && (
            <div className="score-quiz-stats flex justify-between text-xs text-[var(--ui-text-muted)]">
              <span>{t('Rounds: {n}', { n: stats.rounds })}</span>
              <span>{t('Leader correct: {hits}/{rounds}', { hits: stats.leaderHits, rounds: stats.rounds })}</span>
              <span>{t('Avg error: {n} pts', { n: avgError.toFixed(1) })}</span>
            </div>
          )}
        </div>

        <div className="score-quiz-footer ui-bar flex flex-wrap justify-end gap-2 border-t border-[var(--ui-border)] px-4 py-3">
          <button
            type="button"
            onClick={handleRandom}
            disabled={quizPositions.length === 0}
            aria-label={t('Random position')}
            title={quizPositions.length === 0 ? t('This game has no positions to jump to yet') : t('Jump to another position in this game')}
            className="min-h-11 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] px-4 py-2 text-sm font-semibold text-[var(--ui-text)] hover:bg-[var(--ui-surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="inline-flex items-center gap-2">
              <FaDice aria-hidden="true" />
              <span className="score-quiz-label-full">{t('Random position')}</span>
              <span className="score-quiz-label-compact">{t('Random')}</span>
            </span>
          </button>
          {phase === 'reveal' ? (
            <button
              type="button"
              onClick={() => { setPhase('guess'); setActual(null); }}
              className="min-h-11 rounded-lg border border-[var(--ui-accent)] bg-[var(--ui-accent-soft,var(--ui-surface-2))] px-4 py-2 text-sm font-semibold text-[var(--ui-text)] hover:bg-[var(--ui-surface-2)]"
            >
              {t('Guess again')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleReveal()}
              disabled={phase === 'evaluating'}
              aria-label={phase === 'evaluating' ? t('Evaluating score') : t('Reveal score')}
              className="min-h-11 rounded-lg border border-[var(--ui-accent)] bg-[var(--ui-accent-soft,var(--ui-surface-2))] px-4 py-2 text-sm font-semibold text-[var(--ui-text)] hover:bg-[var(--ui-surface-2)] disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-2">
                <FaCheck aria-hidden="true" />
                {phase === 'evaluating' ? (
                  <>
                    <span className="score-quiz-label-full">{t('Evaluating…')}</span>
                    <span className="score-quiz-label-compact">{t('Working…')}</span>
                  </>
                ) : (
                  <>
                    <span className="score-quiz-label-full">{t('Reveal score')}</span>
                    <span className="score-quiz-label-compact">{t('Reveal')}</span>
                  </>
                )}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

ScoreQuizModal.displayName = 'ScoreQuizModal';
