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

/**
 * Search-time ceiling (in milliseconds) for a single analysis request.
 *
 * Like the visit cap above, this is a responsiveness guard: the browser engine
 * keeps the search on the page, so a request that runs too long freezes the UI
 * and builds a large tree. Every engine call clamps its own time to this value.
 *
 * Override it at build time with `VITE_KATAGO_MAX_TIME_MS`, e.g.
 *   VITE_KATAGO_MAX_TIME_MS=1200000 npm run build
 */
export const DEFAULT_ENGINE_MAX_TIME_MS = 600_000;

/** The engine never searches for less than 25 ms, so a smaller cap is useless. */
const MIN_ENGINE_MAX_TIME_MS = 25;

/**
 * Turns a configured value (the Vite env string, a number, or junk) into a
 * usable time cap, falling back to the default when nothing sensible is given.
 */
export const parseEngineMaxTimeMs = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_ENGINE_MAX_TIME_MS;
  return Math.max(MIN_ENGINE_MAX_TIME_MS, Math.floor(parsed));
};

export const ENGINE_MAX_TIME_MS = parseEngineMaxTimeMs(import.meta.env.VITE_KATAGO_MAX_TIME_MS);
