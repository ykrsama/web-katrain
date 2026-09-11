import { formatResultScoreLead } from './manualScore';
import { t } from '../i18n';

/**
 * The one glyph the app shows where a value has not been computed yet. Three
 * spellings were in use — an em dash, a hyphen and a double hyphen — and the
 * phone's readout row managed to show two of them side by side.
 */
export const NO_VALUE = '\u2014';

export function formatAnalysisWinRate(winRate: number | null | undefined): string {
  return typeof winRate === 'number' && Number.isFinite(winRate)
    ? `${(winRate * 100).toFixed(1)}%`
    : NO_VALUE;
}

export function formatWinRateFavorLabel(winRate: number | null | undefined): string {
  if (typeof winRate !== 'number' || !Number.isFinite(winRate)) return '';
  if (winRate >= 0.48 && winRate <= 0.52) return t('Even');
  return t(winRate > 0.5 ? 'Black favored' : 'White favored');
}

export function formatAnalysisScoreLead(scoreLead: number | null | undefined): string {
  return typeof scoreLead === 'number' && Number.isFinite(scoreLead)
    ? formatResultScoreLead(scoreLead)
    : NO_VALUE;
}

export function formatReadableScoreLead(scoreLead: number | null | undefined): string {
  if (typeof scoreLead !== 'number' || !Number.isFinite(scoreLead)) return NO_VALUE;
  if (Math.abs(scoreLead) < 0.05) return t('Even');
  return `${t(scoreLead > 0 ? 'Black' : 'White')} +${Math.abs(scoreLead).toFixed(1)}`;
}

export type PointsLostSummary = {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'muted';
};

export function summarizePointsLost(pointsLost: number | null | undefined): PointsLostSummary {
  if (typeof pointsLost !== 'number' || !Number.isFinite(pointsLost)) {
    return { label: NO_VALUE, tone: 'muted' };
  }

  const absolute = Math.abs(pointsLost);
  const points = absolute.toFixed(1);
  if (absolute < 0.05) return { label: t('Best'), tone: 'success' };
  if (pointsLost < 0) return { label: t('Gain {points}', { points }), tone: 'success' };
  if (pointsLost < 1) return { label: t('Lost {points}', { points }), tone: 'warning' };
  return { label: t('Lost {points}', { points }), tone: 'danger' };
}

/** The one sentence every quality readout leans on; it used to be defined nowhere. */
export const POINTS_LOST_EXPLANATION = "How many points of final score a move gives away compared with the engine's best move.";
