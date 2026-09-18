/**
 * Engine client factory — routes between local (Worker + TF.js) and remote
 * (WebSocket) KataGo engine backends based on settings.
 */

import { getKataGoEngineClient } from './katago/client';
import { getRemoteEngineClient } from './remote/client';

export interface EngineSettings {
  engineMode: 'local' | 'remote';
  remoteEngineUrl: string;
}

export interface EngineClient {
  init(modelUrl?: string, backend?: string): Promise<void>;
  analyze(args: Record<string, unknown>): Promise<unknown>;
  evaluate(args: Record<string, unknown>): Promise<unknown>;
  evaluateBatch(args: Record<string, unknown>): Promise<unknown>;
  getEngineInfo(): { backend: string | null; modelName: string | null; backendNote: string | null };
  dispose(): void;
}

/**
 * The remote URL these settings resolve to, or null when the local worker is
 * the engine.
 *
 * A relative URL (e.g. "/katago-proxy") is resolved against the document's
 * origin by the remote client, so it cannot even be constructed without a DOM.
 * Outside a browser (SSR, unit tests) the local client is the only one that can
 * exist, so fall back to it rather than throwing "window is not defined" from
 * deep inside an analysis request.
 */
const remoteEngineUrlFor = (settings: EngineSettings): string | null => {
  if (settings.engineMode !== 'remote' || !settings.remoteEngineUrl) return null;
  const url = settings.remoteEngineUrl.trim();
  if (url.startsWith('/') && typeof window === 'undefined') return null;
  return settings.remoteEngineUrl;
};

/**
 * Return the active engine client for the given settings.
 *
 * When engineMode is 'remote' and remoteEngineUrl is set, returns the
 * WebSocket-based remote engine client. Otherwise returns the local
 * Worker-based client.
 */
export function getEngineClient(settings: EngineSettings) {
  const remoteUrl = remoteEngineUrlFor(settings);
  return remoteUrl ? getRemoteEngineClient(remoteUrl) : getKataGoEngineClient();
}

/**
 * Whether the engine behind these settings can deepen a search it has already
 * run.
 *
 * The local worker keeps its search tree between requests (`reuseTree`), so
 * asking again widens the same search. A remote KataGo analysis engine throws
 * its tree away for every query (`Search::setPosition` clears it), and the
 * analysis protocol has no way to ask for more — so a second request starts
 * from zero. If a time limit cut the first one short, asking again searches the
 * same thing again and gets no further.
 *
 * Continuous analysis uses this to choose between climbing to the requested
 * depth in steps (local) and asking once for the whole depth (remote).
 */
export function engineCanExtendSearch(settings: EngineSettings): boolean {
  return remoteEngineUrlFor(settings) === null;
}