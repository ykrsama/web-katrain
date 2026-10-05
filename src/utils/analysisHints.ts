import { DEFAULT_TOP_MOVES, type CandidateMove } from '../types';

export const COMPACT_ANALYSIS_HINT_LIMIT = 5;
export const COMPACT_ANALYSIS_CELL_SIZE = 24;

export function usesCompactAnalysisHints(cellSize: number): boolean {
  return cellSize < COMPACT_ANALYSIS_CELL_SIZE;
}

/** Below this the heatmap number is a smudge rather than a readable figure. */
export const POLICY_HEATMAP_MIN_FONT = 7;
/** Comfortable reading size; the heatmap grows to it wherever the cell allows. */
export const POLICY_HEATMAP_TARGET_FONT = 9;
/** Clear space kept between one cell's number and the next one's. */
export const POLICY_HEATMAP_LABEL_GAP = 3;

/**
 * Font size for the policy heatmap's per-intersection number, or null when the
 * cell cannot carry a legible one and the colour should speak alone.
 *
 * The old `cellSize / 4` ignored both bounds at once: it produced ~6.7px text on
 * a 1280px desktop and ~4.5px on a phone, while on a big board it left the
 * number smaller than it needed to be. Sizing against the longest label the
 * current metric actually produces keeps neighbouring numbers from running
 * together — the labels are monospace, so width scales exactly with the size.
 *
 * @param longestLabelWidthPerPx width of the longest label at font size 1px.
 */
export function policyHeatmapFontSize(cellSize: number, longestLabelWidthPerPx: number): number | null {
  if (longestLabelWidthPerPx <= 0) return null;
  const fitting = (cellSize - POLICY_HEATMAP_LABEL_GAP) / longestLabelWidthPerPx;
  const preferred = Math.max(POLICY_HEATMAP_TARGET_FONT, cellSize / 4);
  const size = Math.min(preferred, fitting);
  return size >= POLICY_HEATMAP_MIN_FONT ? size : null;
}

/** Does any of the eight neighbours of (x, y) also carry a hint label? */
export function hasAdjacentHintLabel(labelled: ReadonlySet<string>, x: number, y: number): boolean {
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (ox === 0 && oy === 0) continue;
      if (labelled.has(`${x + ox},${y + oy}`)) return true;
    }
  }
  return false;
}

/**
 * Whether a two-line hint label has to fall back to its primary metric alone.
 *
 * The two lines are drawn at fixed font sizes, so on a normal 19x19 board the
 * block is both taller and wider than the cell it is centred on. Overflow onto
 * empty wood is harmless, so the label only collapses when it overflows *and*
 * an adjacent point is also labelled — the case where two candidates in the
 * same joseki cluster overlapped into an unreadable blob. The 2px slack keeps
 * a label that only just fits from touching its neighbour's.
 */
export function shouldCollapseHintLabel(
  maxLabelWidth: number,
  stackedHeight: number,
  cellSize: number,
  hasNeighbourLabel: boolean
): boolean {
  if (!hasNeighbourLabel) return false;
  return maxLabelWidth > cellSize - 2 || stackedHeight > cellSize - 2;
}

/**
 * Whether a one-line hint label has to give way to a neighbour that already
 * drew one.
 *
 * `shouldCollapseHintLabel` only rescues the two-line case by dropping the
 * secondary metric; a single metric had no rule at all. At a phone's ~17px
 * cell a 10px "+0.1" is about one and a half cells wide, so two candidates on
 * adjacent points printed straight through each other. Ranked order decides:
 * the first label in a cluster is drawn and later ones keep their marker
 * alone, which is also the one a reader cares about most. The 2px slack keeps
 * a label that only just fits from touching its neighbour's.
 */
export function shouldDropHintLabel(
  labelWidth: number,
  cellSize: number,
  hasDrawnNeighbourLabel: boolean
): boolean {
  if (!hasDrawnNeighbourLabel) return false;
  return labelWidth > cellSize - 2;
}

/**
 * The candidates the board draws, strongest first.
 *
 * `limit` is the "Top Moves" setting: how many candidates the engine was asked
 * to report is also how many the board should show, or raising the setting
 * would fill the list while the board still stopped at ten. A board whose
 * intersections are too tight for that many labels keeps its own, smaller cap —
 * a dozen numbers on a phone print through each other rather than inform.
 */
export function selectAnalysisHintMoves(
  moves: readonly CandidateMove[],
  compact: boolean,
  limit: number = DEFAULT_TOP_MOVES
): CandidateMove[] {
  const requested = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : DEFAULT_TOP_MOVES;
  const cap = compact ? Math.min(requested, COMPACT_ANALYSIS_HINT_LIMIT) : requested;
  const legalMoves = moves.filter((move) => move.x >= 0 && move.y >= 0);
  // "Top moves" is the focused alternative to the full-board heatmap. KataGo
  // can return dozens of legal candidates, and drawing all of them makes these
  // two modes visually indistinguishable. Keep the strongest ranked set here;
  // Heatmap remains the deliberate way to inspect the complete policy field.
  return [...legalMoves]
    .sort((a, b) => a.order - b.order || b.visits - a.visits)
    .slice(0, cap);
}
