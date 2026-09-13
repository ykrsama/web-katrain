/**
 * Search-visit ceiling for a single analysis request.
 *
 * This is a responsiveness guard, not a protocol limit: the browser engine is a
 * JavaScript/WASM MCTS that keeps its whole tree in memory and runs on the page,
 * so raising it makes a search proportionally longer and more memory-hungry
 * (`MctsSearch.run` also allows up to 8x this in playouts).
 *
 * Override it at build time with `VITE_KATAGO_MAX_VISITS`, e.g.
 *   VITE_KATAGO_MAX_VISITS=250000 npm run build
 */
export const DEFAULT_ENGINE_MAX_VISITS = 500_000;

/** A cap below the minimum search size would make every request invalid. */
const MIN_ENGINE_MAX_VISITS = 16;

/**
 * Turns a configured value (the Vite env string, a number, or junk) into a
 * usable visit cap, falling back to the default when nothing sensible is given.
 */
export const parseEngineMaxVisits = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_ENGINE_MAX_VISITS;
  return Math.max(MIN_ENGINE_MAX_VISITS, Math.floor(parsed));
};

export const ENGINE_MAX_VISITS = parseEngineMaxVisits(import.meta.env.VITE_KATAGO_MAX_VISITS);

export const ENGINE_MAX_TIME_MS = 300_000;
