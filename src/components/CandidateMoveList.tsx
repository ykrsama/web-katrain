import React, { useMemo, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { useGameStore } from '../store/gameStore';
import { copyTextToClipboard } from '../utils/clipboard';
import { isDrillHidingAnswer } from '../utils/mistakeDrill';
import type { CandidateMove } from '../types';
import { DEFAULT_EVAL_THRESHOLDS, getEvaluationClass } from '../utils/nodeAnalysis';
import { evalColorToCss, getKaTrainEvalColors } from '../utils/katrainTheme';
import { formatBoardMoveLabel } from '../utils/playedMoveQuality';
import {
  formatCandidatePointsLost,
  formatCandidateScore,
  formatCandidateVisits,
  formatCandidateWinRate,
} from '../utils/candidateMoveFormat';
import { t, useT } from '../i18n';

/**
 * The engine's candidates as a list, not as circles on the board.
 *
 * The board already says which moves the engine likes and roughly how much, in
 * the place where that matters. What it cannot do is let you read five moves
 * against each other: the labels are sized to fit inside a stone, they carry at
 * most two numbers, and half of them are hidden behind the position. Comparing
 * the top move's score with the fourth's meant hovering each one in turn and
 * remembering the last.
 *
 * Hovering a row lays that move's variation on the board, which is the same
 * thing hovering the point does. Clicking the row that is already on the board
 * plays the move -- which on a touchscreen, where no hover arrives first, makes
 * it tap to preview and tap again to commit.
 */

interface CandidateMoveListProps {
  /** `${x},${y}` of the row whose variation is on the board, or null. */
  hoveredKey: string | null;
  /** Put a candidate's variation on the board (null clears it). */
  onHover: (move: CandidateMove | null) => void;
  /** How many rows to show before the list scrolls. */
  maxRows?: number;
}

const moveKey = (move: CandidateMove) => `${move.x},${move.y}`;

type SortKey = 'rank' | 'win' | 'score' | 'lost' | 'visits' | 'prior' | 'stdev';

/** Column order for a sort: the engine's rank, or the column's own value best-first. */
const sortCandidates = (moves: CandidateMove[], key: SortKey): CandidateMove[] => {
  if (key === 'rank') return moves;
  const value = (m: CandidateMove): number => {
    switch (key) {
      case 'win': return m.winRate;
      case 'score': return m.scoreLead;
      case 'lost': return -m.pointsLost;
      case 'visits': return m.visits;
      case 'prior': return m.prior ?? -1;
      case 'stdev': return -(m.scoreStdev ?? Infinity);
    }
  };
  return [...moves].sort((a, b) => value(b) - value(a) || a.order - b.order);
};

const formatPrior = (prior: number | undefined): string =>
  typeof prior === 'number' && Number.isFinite(prior) ? `${(prior * 100).toFixed(prior >= 0.1 ? 0 : 1)}%` : '—';

const formatStdev = (stdev: number | undefined): string =>
  typeof stdev === 'number' && Number.isFinite(stdev) ? `±${stdev.toFixed(1)}` : '—';

/** Coach wording for a candidate: the quality word and, when it costs something, the gap to the top move in plain points. */
const coachQualityText = (quality: string, pointsLost: number): string => {
  const lost = Number.isFinite(pointsLost) ? Math.max(0, pointsLost) : 0;
  if (lost < 0.05) return t("{quality} — the engine's top choice", { quality });
  return t('{quality}, {lost} points behind the best move', { quality, lost: lost.toFixed(1) });
};

export const CandidateMoveList: React.FC<CandidateMoveListProps> = ({ hoveredKey, onHover, maxRows = 8 }) => {
  const { moves, drillHidesAnswer, boardSize, playMove, trainerTheme, thresholds, analysisExperience, isAnalysisMode, topK, addPvVariation } = useGameStore(
    (state) => ({
      moves: state.currentNode.analysis?.moves ?? null,
      topK: state.settings.katagoTopK,
      addPvVariation: state.addPvVariation,
      // A drill asking about this position is asking for exactly this list.
      drillHidesAnswer: isDrillHidingAnswer(state.mistakeDrill, state.currentNode.id),
      boardSize: state.currentNode.gameState.board.length,
      playMove: state.playMove,
      trainerTheme: state.settings.trainerTheme,
      thresholds: state.settings.trainerEvalThresholds,
      analysisExperience: state.settings.analysisExperience,
      isAnalysisMode: state.isAnalysisMode,
    }),
    shallow
  );

  const t = useT();
  const evalColors = useMemo(() => getKaTrainEvalColors(trainerTheme), [trainerTheme]);
  const evalThresholds = thresholds.length > 0 ? thresholds : DEFAULT_EVAL_THRESHOLDS;
  const isPro = analysisExperience === 'pro';
  const qualityLabels = [t('Blunder'), t('Mistake'), t('Inaccuracy'), t('Slight'), t('Good'), t('Best')] as const;
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  // Pro can open two more columns: the policy prior and the score's spread.
  // Off by default so the narrow panel keeps its four figures readable.
  const [detail, setDetail] = useState(false);
  const showDetail = isPro && detail;
  // One row at a time may open its principal variation as text.
  const [pvOpenKey, setPvOpenKey] = useState<string | null>(null);

  // The list used to stop at 24 rows whatever Settings said; the engine
  // itself is asked for up to 50.
  const visibleCap = Math.max(1, Math.min(Number.isFinite(topK) ? topK : 10, 50));
  const rows = useMemo(() => {
    if (drillHidesAnswer) return [];
    const onBoard = (moves ?? []).filter((move) => move.x >= 0 && move.y >= 0).slice(0, visibleCap);
    return sortCandidates(onBoard, isPro ? sortKey : 'rank');
  }, [drillHidesAnswer, isPro, moves, sortKey, visibleCap]);

  const sortButton = (key: SortKey, label: string, title: string) => (
    <button
      type="button"
      className={`cl-num cl-sort${sortKey === key ? ' is-sorted' : ''}`}
      onClick={() => setSortKey(sortKey === key ? 'rank' : key)}
      title={t("{title}. Click to sort by it; click again for the engine's order.", { title })}
      aria-label={t('Sort by {label}', { label: label.toLowerCase() })}
      aria-pressed={sortKey === key}
    >
      {label}
    </button>
  );

  if (rows.length === 0) {
    // Three different nothings. Saying "no candidates" while a drill is
    // deliberately withholding them would blame the engine for the silence.
    const emptyText = drillHidesAnswer
      ? t('Hidden while the drill is asking about this position.')
      : isAnalysisMode
        ? t('No candidates for this position yet.')
        : t('Turn on analysis to rank the moves here.');
    return <div className="px-3 py-2 text-[0.6875rem] ui-text-faint">{emptyText}</div>;
  }

  return (
    <div
      className="candidate-list"
      data-analysis-experience={analysisExperience}
      data-candidate-detail={showDetail ? 'true' : 'false'}
      data-candidate-sort={isPro ? sortKey : 'rank'}
      style={{ maxHeight: `calc(${maxRows} * var(--candidate-row-height, 1.75rem) + 1.5rem)` }}
    >
      <div className="candidate-list-head">
        <span className="cl-rank" aria-hidden="true">#</span>
        <span className="cl-move">
          <span aria-hidden="true">{t('Move')}</span>
          {isPro && (
            <button
              type="button"
              className={`cl-detail-toggle${showDetail ? ' is-on' : ''}`}
              onClick={() => setDetail((v) => !v)}
              aria-pressed={showDetail}
              aria-label={showDetail ? t('Hide prior and spread columns') : t('Show prior and spread columns')}
              title={showDetail ? t('Hide the policy prior and score spread') : t('Show the policy prior and score spread')}
            >
              {showDetail ? '−' : '+'}
            </button>
          )}
        </span>
        {isPro ? (
          <>
            {sortButton('win', t('B win'), t("Black's win rate after this move, whoever is to play"))}
            {sortButton('score', t('Score'), t('Score lead for Black after this move'))}
            {sortButton('lost', t('Lost'), t('Points behind the top candidate'))}
            {sortButton('visits', t('Visits'), t('How many times the search read this move'))}
            {showDetail && sortButton('prior', t('Prior'), t("The policy net's first instinct for this move, before any search"))}
            {showDetail && sortButton('stdev', t('Std'), t('Spread of the score estimates behind this move: wider means less settled'))}
          </>
        ) : (
          <span className="cl-quality" aria-hidden="true">{t('Quality')}</span>
        )}
      </div>
      <ul className="candidate-list-rows">
        {rows.map((move, index) => {
          const key = moveKey(move);
          const label = formatBoardMoveLabel(move, boardSize);
          const cls = getEvaluationClass(move.pointsLost, evalThresholds, evalColors.length);
          const dot = evalColorToCss(evalColors[cls] ?? evalColors[evalColors.length - 1]!);
          const rank = Number.isFinite(move.order) && move.order >= 0 ? move.order + 1 : index + 1;
          return (
            <li key={key}>
              <button
                type="button"
                className={`candidate-row${hoveredKey === key ? ' is-active' : ''}`}
                onMouseEnter={() => onHover(move)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(move)}
                onBlur={() => onHover(null)}
                onClick={() => {
                  // A row plays its move, but only once it is the row on the
                  // board: with a mouse that is already true by the time the
                  // click lands, and on a touchscreen -- where there is no
                  // hover to arrive first -- it makes the first tap show the
                  // variation and the second commit to it. Same shape as the
                  // board's own tap-to-confirm, without needing to ask what
                  // kind of pointer this is.
                  if (hoveredKey !== key) {
                    onHover(move);
                    return;
                  }
                  onHover(null);
                  playMove(move.x, move.y);
                }}
                title={
                  isPro
                    ? t('{verb} {label}. {winrate} Black win rate, score {score}, {visits} visits.', {
                        verb: t(hoveredKey === key ? 'Play' : 'Preview'),
                        label,
                        winrate: formatCandidateWinRate(move.winRate),
                        score: formatCandidateScore(move.scoreLead),
                        visits: formatCandidateVisits(move.visits),
                      })
                    : t('{verb} {label}: {quality}.', {
                        verb: t(hoveredKey === key ? 'Play' : 'Preview'),
                        label,
                        quality: coachQualityText(qualityLabels[cls] ?? t('Good'), move.pointsLost),
                      })
                }
                aria-label={
                  isPro
                    ? t('Candidate {rank}: {label}, {winrate} Black win rate, score {score}, {lost} points. {action}.', {
                        rank,
                        label,
                        winrate: formatCandidateWinRate(move.winRate),
                        score: formatCandidateScore(move.scoreLead),
                        lost: formatCandidatePointsLost(move.pointsLost),
                        action: t(hoveredKey === key ? 'Play it' : 'Show its variation'),
                      })
                    : t('Candidate {rank}: {label}, {quality}. {action}.', {
                        rank,
                        label,
                        quality: coachQualityText(qualityLabels[cls] ?? t('Good'), move.pointsLost),
                        action: t(hoveredKey === key ? 'Play it' : 'Show its variation'),
                      })
                }
              >
                <span className="cl-rank">{rank}</span>
                <span className="cl-move">
                  <span className="cl-dot" style={{ backgroundColor: dot }} aria-hidden="true" />
                  {label}
                  {isPro && (move.pv?.length ?? 0) > 1 && (
                    <span
                      role="button"
                      tabIndex={0}
                      className={`cl-pv-toggle${pvOpenKey === key ? ' is-open' : ''}`}
                      aria-expanded={pvOpenKey === key}
                      aria-label={pvOpenKey === key ? t('Hide the variation after {label}', { label }) : t('Show the variation after {label} as text', { label })}
                      title={pvOpenKey === key ? t('Hide variation') : t('Show variation as text')}
                      onClick={(event) => {
                        event.stopPropagation();
                        setPvOpenKey((open) => (open === key ? null : key));
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        event.stopPropagation();
                        setPvOpenKey((open) => (open === key ? null : key));
                      }}
                    >
                      ›
                    </span>
                  )}
                </span>
                {isPro ? (
                  <>
                    <span className="cl-num">{formatCandidateWinRate(move.winRate)}</span>
                    <span className="cl-num">{formatCandidateScore(move.scoreLead)}</span>
                    <span className="cl-num cl-lost">{formatCandidatePointsLost(move.pointsLost)}</span>
                    <span className="cl-num ui-text-faint">{formatCandidateVisits(move.visits)}</span>
                    {showDetail && <span className="cl-num ui-text-faint">{formatPrior(move.prior)}</span>}
                    {showDetail && <span className="cl-num ui-text-faint">{formatStdev(move.scoreStdev)}</span>}
                  </>
                ) : (
                  <span className="cl-quality" style={{ color: dot }}>{qualityLabels[cls] ?? t('Good')}</span>
                )}
              </button>
              {isPro && pvOpenKey === key && move.pv && move.pv.length > 1 && (
                <div className="cl-pv" data-candidate-pv={key}>
                  <span className="cl-pv-line">
                    {move.pv.map((step, stepIndex) => (
                      <span key={`${step}-${stepIndex}`} className="cl-pv-step">{step}</span>
                    ))}
                  </span>
                  <span className="cl-pv-actions">
                    <button
                      type="button"
                      className="cl-pv-action"
                      onClick={() => {
                        void copyTextToClipboard(move.pv!.join(' ')).then((ok) =>
                          useGameStore.setState({ notification: { message: ok ? t('Variation copied.') : t('Could not copy the variation.'), type: ok ? 'success' : 'error' } })
                        );
                      }}
                    >
                      {t('Copy')}
                    </button>
                    <button type="button" className="cl-pv-action" onClick={() => addPvVariation(move.pv ?? [])}>
                      {t('Keep in tree')}
                    </button>
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
