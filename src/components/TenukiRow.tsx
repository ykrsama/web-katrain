import React from 'react';
import { useGameStore } from '../store/gameStore';
import { summarizeTrickRow } from '../utils/trickMoves';
import { summarizeTenukiRow } from '../utils/tenukiValue';
import { formatMoveLabel } from './layout/ui-utils';
import { useT } from '../i18n';

/**
 * Two on-demand engine reads that answer questions the always-on overlays do
 * not: "can I play elsewhere?" and "is there a move here that traps the
 * opponent?".
 *
 * The first evaluates the position again after the side to move passes, which
 * hands the point to the opponent; the gap between the two leads prices it. The
 * second scans every legal point of this position at the fast-review depth and
 * marks the ones whose follow-up leaves the opponent a single reply that does
 * not lose points and makes their second choice worse for them than the
 * position is now.
 *
 * Both are buttons rather than numbers that appear unbidden: each costs a real
 * search, and the trick scan costs a batch of them.
 *
 * Self-contained and store-reading, like `ScoreWinrateGraph`, because the
 * desktop dashboard and the mobile panel keep separate markup by design and
 * these controls should not be written twice to sit in both.
 */
export const TenukiRow: React.FC<{ className?: string }> = ({ className }) => {
  const t = useT();
  const currentNode = useGameStore((state) => state.currentNode);
  const treeVersion = useGameStore((state) => state.treeVersion);
  const tenukiAnalysis = useGameStore((state) => state.tenukiAnalysis);
  const analyzeTenuki = useGameStore((state) => state.analyzeTenuki);
  const trickMoves = useGameStore((state) => state.trickMoves);
  const isTrickScanRunning = useGameStore((state) => state.isTrickScanRunning);
  const trickScanDone = useGameStore((state) => state.trickScanDone);
  const trickScanTotal = useGameStore((state) => state.trickScanTotal);
  const findTrickMoves = useGameStore((state) => state.findTrickMoves);

  // Node analysis mutates in place; treeVersion bumps whenever it changes.
  void treeVersion;

  const row = summarizeTenukiRow({
    tenuki: tenukiAnalysis?.nodeId === currentNode.id ? tenukiAnalysis : null,
    hasAnalysis: !!currentNode.analysis && Number.isFinite(currentNode.analysis.rootScoreLead),
    formatPoint: (x, y) => formatMoveLabel(x, y, currentNode.gameState.board.length),
  });
  const trickRow = summarizeTrickRow({
    running: isTrickScanRunning,
    done: trickScanDone,
    total: trickScanTotal,
    marks: trickMoves?.nodeId === currentNode.id ? trickMoves.marks : null,
    formatPoint: (x, y) => formatMoveLabel(x, y, currentNode.gameState.board.length),
  });

  return (
    <div
      className={[
        'mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--ui-border)] pt-1.5',
        className ?? '',
      ].join(' ')}
      data-analysis-tenuki="true"
      data-analysis-tenuki-status={row.status}
      data-analysis-trick="true"
      data-analysis-trick-status={trickRow.status}
    >
      <div className="flex min-w-[13rem] flex-1 items-center gap-2">
        <button
          type="button"
          className="panel-action-button"
          onClick={() => analyzeTenuki()}
          disabled={row.disabled}
          title={row.disabledReason ?? t('Evaluate the position again after a pass, to price the point here')}
          aria-label={t('Ask what playing elsewhere would cost')}
        >
          {row.buttonLabel}
        </button>
        <div className="min-w-0 flex-1 text-[0.6875rem] ui-text-faint">{row.summary}</div>
      </div>
      <div className="flex min-w-[13rem] flex-1 items-center gap-2">
        <button
          type="button"
          className="panel-action-button"
          onClick={() => findTrickMoves()}
          title={
            isTrickScanRunning
              ? 'Stop looking for trick moves.'
              : 'Look for moves that leave the opponent one reply that does not lose points, with their second choice worse for them than now. Uses the fast-review depth and the framed region.'
          }
          aria-label={isTrickScanRunning ? 'Stop looking for trick moves' : 'Trick moves'}
        >
          {trickRow.buttonLabel}
        </button>
        <div className="min-w-0 flex-1 text-[0.6875rem] ui-text-faint" data-analysis-trick-summary={trickRow.status}>
          {trickRow.summary}
        </div>
      </div>
    </div>
  );
};
