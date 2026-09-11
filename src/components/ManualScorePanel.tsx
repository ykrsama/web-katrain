import React from 'react';
import { FaCalculator, FaChevronDown, FaChevronUp, FaMagic, FaTimes, FaUndo } from 'react-icons/fa';
import type { ManualScoreEstimate } from '../utils/scoring';
import { useT } from '../i18n';

interface ManualScorePanelProps {
  active: boolean;
  disabled?: boolean;
  isCompact?: boolean;
  commandBarOffset?: boolean;
  docked?: boolean;
  hideLauncher?: boolean;
  scoreMode?: 'manual' | 'estimate';
  score: ManualScoreEstimate;
  blackName: string;
  whiteName: string;
  capturedBlack: number;
  capturedWhite: number;
  komi: number;
  deadStoneCount: number;
  shortcutLabel?: string;
  onToggle: () => void;
  onAutoEstimate?: () => void;
  onUseManualScore?: () => void;
  canAutoEstimate?: boolean;
  estimateSource?: 'ownership' | 'playout' | null;
  onClear: () => void;
  onDone: () => void;
}

const formatScoreValue = (value: number): string => Number.isInteger(value) ? String(value) : value.toFixed(1);

export const ManualScorePanel: React.FC<ManualScorePanelProps> = ({
  active,
  disabled = false,
  isCompact = false,
  commandBarOffset = false,
  docked = false,
  hideLauncher = false,
  scoreMode = 'manual',
  score,
  blackName,
  whiteName,
  capturedBlack,
  capturedWhite,
  komi,
  deadStoneCount,
  shortcutLabel,
  onToggle,
  onAutoEstimate,
  onUseManualScore,
  canAutoEstimate = false,
  estimateSource = null,
  onClear,
  onDone,
}) => {
  const t = useT();
  const detailsId = React.useId();
  const detailsRef = React.useRef<HTMLDivElement>(null);
  // Docked (dashboard strip) and compact (mobile bottom bar) variants keep the
  // breakdown behind the Details toggle so the bar stays slim and the board keeps
  // its space; only the floating desktop panel opens expanded.
  const [showDetails, setShowDetails] = React.useState(!isCompact && !docked);
  const showShortcutLabel = !!shortcutLabel && shortcutLabel !== 'Disabled';
  const scoreTitle = disabled
    ? t('Finish editing before scoring.')
    : showShortcutLabel
      ? t('Score position ({shortcut})', { shortcut: shortcutLabel })
      : t('Score position');
  const scoreAriaLabel = showShortcutLabel
    ? t('Score position, keyboard shortcut {shortcut}', { shortcut: shortcutLabel })
    : t('Score position');

  React.useEffect(() => {
    if (active) setShowDetails(!isCompact && !docked);
  }, [active, isCompact, docked]);

  React.useEffect(() => {
    if (!active || !isCompact || docked) return;
    const frame = window.requestAnimationFrame(() => {
      const details = detailsRef.current;
      const panel = details?.closest<HTMLElement>('.manual-score-panel');
      if (!details || !panel) return;
      panel.scrollTop = showDetails ? details.offsetTop : 0;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, docked, isCompact, showDetails]);

  if (!active) {
    // When the launcher lives elsewhere (e.g. the mobile bottom bar), render
    // nothing while idle so the board stays clear; the active scoring panel
    // still appears once scoring is on.
    if (hideLauncher) return null;
    if (docked) {
      // Match the Region/Insert board chips in the dashboard action strip; the
      // shortcut stays discoverable via the title/aria-label.
      return (
        <button
          type="button"
          className="board-chip"
          onClick={onToggle}
          disabled={disabled}
          title={scoreTitle}
          aria-label={scoreAriaLabel}
        >
          <FaCalculator size={13} />
          <span className="bc-label">{t('Score')}</span>
        </button>
      );
    }
    return (
      <button
        type="button"
        className={['manual-score-launch', commandBarOffset ? 'manual-score-offset' : ''].join(' ')}
        onClick={onToggle}
        disabled={disabled}
        title={scoreTitle}
        aria-label={scoreAriaLabel}
      >
        <FaCalculator size={13} />
        <span>{t('Score')}</span>
        {showShortcutLabel && !isCompact ? <kbd className="manual-score-shortcut">{shortcutLabel}</kbd> : null}
      </button>
    );
  }

  const leaderClass = score.scoreLead > 0 ? 'black' : score.scoreLead < 0 ? 'white' : 'jigo';
  const estimateTitle =
    estimateSource === 'ownership'
      ? t('Estimate dead stones from territory ownership')
      : estimateSource === 'playout'
        ? t('Estimate dead stones with local playouts')
        : t('Run territory analysis or score a position with stones before estimating');
  const scoreSourceLabel =
    scoreMode === 'manual'
      ? t('Manual')
      : estimateSource === 'ownership'
        ? t('Ownership')
        : estimateSource === 'playout'
          ? t('Playout')
          : t('Estimate');
  const markedDeadLabel = t('{n} marked dead stones', { n: deadStoneCount });
  const resultDetailLabel =
    score.scoreLead > 0
      ? t('{name} by {n}', { name: blackName, n: formatScoreValue(score.scoreLead) })
      : score.scoreLead < 0
        ? t('{name} by {n}', { name: whiteName, n: formatScoreValue(Math.abs(score.scoreLead)) })
        : t('Even game');
  return (
    <section className={['manual-score-panel', commandBarOffset ? 'manual-score-offset' : '', docked ? 'manual-score-docked' : '', isCompact && !docked ? 'manual-score-compact' : ''].join(' ')} aria-label={t('Manual score')}>
      <div className="manual-score-header">
        <div className="manual-score-title">
          <FaCalculator size={13} />
          <span>{t('Score')}</span>
        </div>
        <span className="manual-score-count" title={t('Marked dead stones')}>
          {t('{n} dead', { n: deadStoneCount })}
        </span>
        <button type="button" className="manual-score-icon" onClick={onDone} title={t('Done')} aria-label={t('Done scoring')}>
          <FaTimes size={12} />
        </button>
      </div>

      <div className="manual-score-method" role="group" aria-label={t('Scoring method')}>
        <button
          type="button"
          className={scoreMode === 'estimate' ? 'active' : ''}
          aria-pressed={scoreMode === 'estimate'}
          onClick={onAutoEstimate}
          disabled={!onAutoEstimate || !canAutoEstimate}
          title={estimateTitle}
          data-score-estimate-source={estimateSource ?? 'none'}
        >
          <FaMagic size={11} />
          <span>{t('Estimate')}</span>
        </button>
        {/* Selected is not the same as unavailable. Disabling this while it was
            the active mode made the chosen half of the pair unfocusable and
            announced as dimmed, so the only mode a keyboard or screen-reader
            user could perceive was the one they had not picked. aria-pressed
            already carries the selection, and re-applying is a no-op. */}
        <button
          type="button"
          className={scoreMode === 'manual' ? 'active' : ''}
          aria-pressed={scoreMode === 'manual'}
          onClick={onUseManualScore}
          disabled={!onUseManualScore}
          title={t('Use current dead-stone marks as the final manual score')}
        >
          <span>{t('Final')}</span>
        </button>
      </div>

      <div className={['manual-score-result', leaderClass].join(' ')} role="status" aria-live="polite" aria-atomic="true">
        <span>
          {scoreMode === 'estimate' && <span className="manual-score-estimate-mark">≈</span>}
          {score.result}
        </span>
        <small data-manual-score-result-detail="true">{resultDetailLabel}</small>
      </div>

      <div className="manual-score-status" data-manual-score-status="true" aria-label={t('Scoring status')}>
        <div data-manual-score-status-item="mode" title={t('Scoring mode: {mode}', { mode: scoreSourceLabel })}>
          <span>{t('Mode')}</span>
          <b>{scoreSourceLabel}</b>
        </div>
        <div data-manual-score-status-item="dead" title={t('Marked dead stones')}>
          <span>{t('Dead')}</span>
          <b>{deadStoneCount}</b>
        </div>
        <div data-manual-score-status-item="neutral" title={t('Neutral points')}>
          <span>{t('Neutral')}</span>
          <b>{score.neutralPoints}</b>
        </div>
      </div>

      <div className="manual-score-totals">
        <div>
          <span className="manual-score-stone black" aria-hidden="true" />
          <span className="truncate">{blackName}</span>
          <strong>{formatScoreValue(score.blackScore)}</strong>
        </div>
        <div>
          <span className="manual-score-stone white" aria-hidden="true" />
          <span className="truncate">{whiteName}</span>
          <strong>{formatScoreValue(score.whiteScore)}</strong>
        </div>
      </div>

      <div ref={detailsRef} className="manual-score-details">
        <button
          type="button"
          className="manual-score-details-toggle"
          onClick={() => setShowDetails((value) => !value)}
          aria-expanded={showDetails}
          aria-controls={detailsId}
        >
          <span>{t('Details')}</span>
          {showDetails ? <FaChevronUp size={11} /> : <FaChevronDown size={11} />}
        </button>
        <div id={detailsId} className="manual-score-breakdown" hidden={!showDetails}>
          <div className="manual-score-breakdown-header" aria-hidden="true">
            <span />
            <b>B</b>
            <b>W</b>
          </div>
          <div>
            <span>{t('Territory')}</span>
            <b>{score.blackTerritory}</b>
            <b>{score.whiteTerritory}</b>
          </div>
          <div>
            <span>{t('Neutral')}</span>
            <b className="manual-score-muted" aria-label={t('{n} neutral points', { n: score.neutralPoints })}>
              {score.neutralPoints}
            </b>
            <b className="manual-score-muted">-</b>
          </div>
          <div>
            <span>{t('Prisoners')}</span>
            <b>{capturedWhite}</b>
            <b>{capturedBlack}</b>
          </div>
          <div>
            <span>{t('Dead stones')}</span>
            <b>{score.whiteDeadStones}</b>
            <b>{score.blackDeadStones}</b>
          </div>
          <div>
            <span>{t('Komi')}</span>
            <b className="manual-score-muted">-</b>
            <b>{formatScoreValue(komi)}</b>
          </div>
        </div>
      </div>

      <div className="manual-score-actions">
        <button
          type="button"
          onClick={onAutoEstimate}
          disabled={!onAutoEstimate || !canAutoEstimate}
          title={estimateTitle}
          data-score-estimate-source={estimateSource ?? 'none'}
          className={scoreMode === 'estimate' ? 'active' : ''}
        >
          <FaMagic size={12} />
          <span>{t('Auto')}</span>
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={deadStoneCount === 0}
          title={deadStoneCount === 0 ? t('No dead stones to clear') : t('Clear dead stones')}
        >
          <FaUndo size={12} />
          <span>{t('Clear')}</span>
        </button>
        <button type="button" className="primary" onClick={onDone}>
          <FaTimes size={12} />
          <span>{t('Done')}</span>
        </button>
      </div>

      <div className="manual-score-help" data-manual-score-help="true">
        {t('Click board stones to toggle dead chains - {n}', { n: markedDeadLabel })}
      </div>
    </section>
  );
};
