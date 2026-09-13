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
 * Return the active engine client for the given settings.
 *
 * When engineMode is 'remote' and remoteEngineUrl is set, returns the
 * WebSocket-based remote engine client. Otherwise returns the local
 * Worker-based client.
 */
export function getEngineClient(settings: EngineSettings) {
  if (settings.engineMode === 'remote' && settings.remoteEngineUrl) {
    const url = settings.remoteEngineUrl.trim();
    // A relative URL (e.g. "/katago-proxy") is resolved against the document's
    // origin by the remote client, so it cannot even be constructed without a
    // DOM. Outside a browser (SSR, unit tests) the local client is the only one
    // that can exist, so fall back to it rather than throwing "window is not
    // defined" from deep inside an analysis request.
    const needsDocument = url.startsWith('/');
    if (!(needsDocument && typeof window === 'undefined')) {
      return getRemoteEngineClient(settings.remoteEngineUrl);
    }
  }
  return getKataGoEngineClient();
}