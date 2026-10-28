import React from 'react';
import { useGameStore } from '../store/gameStore';
import { summarizeSavageRow } from '../utils/savageMoves';
import { summarizeTenukiRow } from '../utils/tenukiValue';
import { formatMoveLabel } from './layout/ui-utils';
import { useT } from '../i18n';

/**
 * Two on-demand engine reads that answer questions the always-on overlays do
 * not: "can I play elsewhere?" and "is there a move here that leaves the
 * opponent only one good reply?".
 *
 * The first evaluates the position again after the side to move passes, which
 * hands the point to the opponent; the gap between the two leads prices it. The
 * second scans every candidate of this position at the fast-review depth and
 * marks the ones whose follow-up leaves the opponent a single reply that does
 * not lose points.
 *
 * Both are buttons rather than numbers that appear unbidden: each costs a real
 * search, and the savage scan costs a batch of them.
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
  const savageMoves = useGameStore((state) => state.savageMoves);
  const isSavageScanRunning = useGameStore((state) => state.isSavageScanRunning);
  const savageScanDone = useGameStore((state) => state.savageScanDone);
  const savageScanTotal = useGameStore((state) => state.savageScanTotal);
  const findSavageMoves = useGameStore((state) => state.findSavageMoves);

  // Node analysis mutates in place; treeVersion bumps whenever it changes.
  void treeVersion;

  const row = summarizeTenukiRow({
    tenuki: tenukiAnalysis?.nodeId === currentNode.id ? tenukiAnalysis : null,
    hasAnalysis: !!currentNode.analysis && Number.isFinite(currentNode.analysis.rootScoreLead),
    formatPoint: (x, y) => formatMoveLabel(x, y, currentNode.gameState.board.length),
  });
  const savageRow = summarizeSavageRow({
    running: isSavageScanRunning,
    done: savageScanDone,
    total: savageScanTotal,
    marks: savageMoves?.nodeId === currentNode.id ? savageMoves.marks : null,
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
      data-analysis-savage="true"
      data-analysis-savage-status={savageRow.status}
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
          onClick={() => findSavageMoves()}
          title={
            isSavageScanRunning
              ? 'Stop looking for savage moves.'
              : 'Look for moves that leave the opponent only one reply that does not lose points. Uses the fast-review depth and the framed region.'
          }
          aria-label={isSavageScanRunning ? 'Stop looking for savage moves' : 'Find savage moves'}
        >
          {savageRow.buttonLabel}
        </button>
        <div className="min-w-0 flex-1 text-[0.6875rem] ui-text-faint" data-analysis-savage-summary={savageRow.status}>
          {savageRow.summary}
        </div>
      </div>
    </div>
  );
};
