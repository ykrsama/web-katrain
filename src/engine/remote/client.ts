/**
 * Remote KataGo Analysis Engine — WebSocket client.
 *
 * Connects to a remote KataGo server that speaks the same JSON-line protocol
 * KataGo uses over stdin/stdout.  See katrain/core/remote_engine.py for the
 * Python reference implementation.
 */

import type { KataGoAnalysisPayload } from '../katago/types';
import type { BoardState, GameRules, KataGoBackendPreference, Move, Player, RegionOfInterest } from '../../types';
import { buildMoveList, coordToGtp, rulesToKataGoString, type RemoteMoveInfo, type RemoteResponse } from './types';

// ─── Helpers ─────────────────────────────────────────────────────────────

const DEFAULT_BOARD_SIZE = 19;

const takeLastMoves = (moves: Move[]): Move[] =>
  moves.length <= 5 ? moves : moves.slice(moves.length - 5);

/** Build a 19×19 policy array from a remote response. */
function buildPolicy(moveInfos: RemoteMoveInfo[], boardSize: number): number[] {
  const policy = new Array<number>(boardSize * boardSize + 1).fill(-1);
  for (const mi of moveInfos) {
    // Parse GTP move string
    const m = /^([A-HJ-T])([1-9]\d?)$/.exec(mi.move.trim().toUpperCase());
    if (!m) continue;
    const col = m[1]!;
    const x = col.charCodeAt(0) - 65 - (col > 'I' ? 1 : 0);
    const row = Number.parseInt(m[2]!, 10);
    const y = boardSize - row;
    if (x >= 0 && x < boardSize && y >= 0 && y < boardSize) {
      policy[y * boardSize + x] = mi.prior;
    }
  }
  // Pass is not in moveInfos; leave at -1.
  return policy;
}

/** Convert remote ownership array (if present) to Float32Array. */
function buildOwnership(moveInfos: RemoteMoveInfo[], boardSize: number): Float32Array {
  // Ownership is a per-root property in KataGo; return the root ownership.
  // For remote, we don't get root-level ownership array directly — it's
  // typically in the first move's ownership.  Return a zero array if unavailable.
  return new Float32Array(boardSize * boardSize);
}

/** Build a board-size×board-size ownership from the move-level data. */
function buildTerritoryFromResponse(resp: RemoteResponse): number[] | null {
  // The remote KataGo may include ownership in rootInfo or as a separate field.
  // For now, we build a simple territory from the root score.
  // The actual ownership data should come from the server if configured.
  return null;
}

// ─── Client ───────────────────────────────────────────────────────────────

export class KataGoCanceledError extends Error {
  readonly canceled = true;

  constructor(message = 'Analysis canceled') {
    super(message);
    this.name = 'KataGoCanceledError';
  }
}

export const isKataGoCanceledError = (err: unknown): err is KataGoCanceledError => {
  if (!err || typeof err !== 'object') return false;
  if ((err as { canceled?: boolean }).canceled) return true;
  return err instanceof Error && err.name === 'KataGoCanceledError';
};

type PendingQuery = {
  resolve: (a: KataGoAnalysisPayload) => void;
  reject: (e: Error) => void;
  onProgress?: (a: KataGoAnalysisPayload) => void;
};

type PendingEval = {
  resolve: (e: KataGoAnalysisPayload) => void;
  reject: (e: Error) => void;
};

type PendingEvalBatch = {
  resolve: (e: KataGoAnalysisPayload[]) => void;
  reject: (e: Error) => void;
};

/**
 * WebSocket-based remote KataGo engine client.
 *
 * Usage:
 *   const client = new RemoteEngineClient("ws://host:port/katago");
 *   await client.init();  // establishes the WebSocket
 *   const analysis = await client.analyze({ ... });
 */
class RemoteEngineClient {
  private url: string;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<string, PendingQuery>();
  private pendingEval = new Map<string, PendingEval>();
  private pendingEvalBatch = new Map<string, PendingEvalBatch>();
  private _queryBoardSizes = new Map<string, number>();
  private _closing = false;
  private _reconnecting = false;
  private _reportedDead = false;
  private _connId = 0;
  private _backend = 'remote';
  private _modelName: string | null = null;
  private _backendNote: string | null = null;
  private _crashed: Error | null = null;

  // Reconnect settings (mirrors KaTrain: RECONNECT_ATTEMPTS=6, backoff 1s→10s)
  private readonly RECONNECT_ATTEMPTS = 6;
  private readonly RECONNECT_BACKOFF_S = 1.0;
  private readonly RECONNECT_MAX_BACKOFF_S = 10.0;

  constructor(url: string) {
    if (!url) {
      throw new Error('Remote KataGo URL is required');
    }
    // Resolve relative URLs (e.g. "/katago-proxy") against the current origin.
    // This allows Vite proxy-based same-origin WebSocket connections that
    // bypass COEP/CORS restrictions.
    if (url.startsWith('ws://') || url.startsWith('wss://')) {
      this.url = url;
    } else if (url.startsWith('/')) {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      this.url = `${proto}://${window.location.host}${url}`;
    } else {
      throw new Error(`Remote KataGo URL must start with ws://, wss://, or /, got: ${url}`);
    }
  }

  // ─── Public API (same interface as KataGoEngineClient) ────────────────

  getEngineInfo(): { backend: string | null; modelName: string | null; backendNote: string | null } {
    return {
      backend: this._backend,
      modelName: this._modelName,
      backendNote: this._backendNote,
    };
  }

  async init(_modelUrl?: string, _backend?: KataGoBackendPreference): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this._closing = false;
    this._reportedDead = false;
    this._reconnecting = false;
    this._crashed = null;
    await this._connect();
  }

  dispose(): void {
    this._closing = true;
    this._failAllPending(new Error('Remote engine client disposed'));
    if (this.ws) {
      try {
        this.ws.close(1000, 'Client disposed');
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  private _connecting: Promise<void> | null = null;

  private async _ensureConnected(): Promise<void> {
    if (this._closing) throw new Error('Remote engine is shutting down');
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    // If a reconnect loop is already running, wait for it.
    if (this._reconnecting) {
      const deadline = Date.now() + 30_000;
      while (this._reconnecting && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }
      if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
      if (this._reconnecting) throw new Error('Remote engine reconnect timed out');
      if (this._crashed) throw this._crashed;
    }

    // If a connection attempt is already in progress, wait for it.
    if (this._connecting) {
      try {
        await this._connecting;
      } catch {
        // The shared attempt failed; fall through to our own retry.
      }
      if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
      if (this._crashed) throw this._crashed;
    }

    // Try to connect, with a short retry loop for transient failures.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this._closing) throw new Error('Remote engine is shutting down');
      try {
        this._connecting = this._connect();
        await this._connecting;
        this._connecting = null;
        return;
      } catch (err) {
        this._connecting = null;
        if (attempt === 2 || this._closing) throw err;
        console.info(`[remote-engine] Connect attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : err}; retrying...`);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  async analyze(args: {
    analysisGroup?: 'interactive' | 'background';
    positionId?: string;
    parentPositionId?: string;
    positionKey?: string;
    parentPositionKey?: string;
    modelUrl: string;
    backend?: KataGoBackendPreference;
    board: BoardState;
    previousBoard?: BoardState;
    previousPreviousBoard?: BoardState;
    currentPlayer: Player;
    moveHistory: Move[];
    komi: number;
    rules?: GameRules;
    regionOfInterest?: RegionOfInterest | null;
    topK?: number;
    analysisPvLen?: number;
    includeMovesOwnership?: boolean;
    wideRootNoise?: number;
    playoutDoublingAdvantage?: number;
    playoutDoublingAdvantagePla?: Player;
    nnRandomize?: boolean;
    conservativePass?: boolean;
    visits?: number;
    maxTimeMs?: number;
    batchSize?: number;
    maxChildren?: number;
    reportDuringSearchEveryMs?: number;
    ownershipRefreshIntervalMs?: number;
    reuseTree?: boolean;
    ownershipMode?: 'none' | 'root' | 'tree';
    humanModelUrl?: string;
    humanSlProfile?: string;
    humanSlRootExploreProb?: number;
    rootPolicyTemperature?: number;
    fillDameBeforePass?: boolean;
    avoidMoves?: Array<{ x: number; y: number; player?: Player; untilDepth?: number }>;
    allowMoves?: Array<{ moves: Array<{ x: number; y: number }>; player?: Player; untilDepth?: number }>;
    onProgress?: (analysis: KataGoAnalysisPayload) => void;
  }): Promise<KataGoAnalysisPayload> {
    this._rejectIfCrashed();
    await this._ensureConnected();

    const id = `QUERY:${this.nextId++}`;
    const boardSize = args.board.length || DEFAULT_BOARD_SIZE;

    const rules = args.rules ?? 'japanese';
    const komi = args.komi ?? 6.5;

    const query: Record<string, unknown> = {
      id,
      moves: buildMoveList(args.moveHistory, args.board, boardSize),
      rules: rulesToKataGoString(rules),
      komi,
      boardXSize: boardSize,
      boardYSize: boardSize,
      maxVisits: args.visits ?? 500,
      includePolicy: true,
      includeOwnership: args.ownershipMode !== 'none',
      includeMovesOwnership: args.includeMovesOwnership ?? false,
      includePVVisits: true,
      analysisPVLen: args.analysisPvLen ?? 15,
      reportDuringSearchEvery: args.reportDuringSearchEveryMs
        ? args.reportDuringSearchEveryMs / 1000
        : 0.5,
      overrideSettings: { reportAnalysisWinratesAs: 'BLACK' },
    };

    if (args.maxTimeMs) query.maxTime = args.maxTimeMs / 1000;
    if (args.topK) query.topK = args.topK;
    if (args.wideRootNoise !== undefined) query.wideRootNoise = args.wideRootNoise;
    if (args.rootPolicyTemperature !== undefined) query.rootPolicyTemperature = args.rootPolicyTemperature;
    if (args.conservativePass !== undefined) query.conservativePass = args.conservativePass;
    if (args.fillDameBeforePass !== undefined) query.fillDameBeforePass = args.fillDameBeforePass;

    // Region of interest → avoidMoves
    if (args.regionOfInterest) {
      const roi = args.regionOfInterest;
      const avoidList: string[] = [];
      for (let y = 0; y < boardSize; y++) {
        for (let x = 0; x < boardSize; x++) {
          if (x < roi.xMin || x > roi.xMax || y < roi.yMin || y > roi.yMax) {
            avoidList.push(coordToGtp(x, y, boardSize));
          }
        }
      }
      if (avoidList.length > 0) {
        query.avoidMoves = avoidList.map((move) => ({ move, untilDepth: 1 }));
      }
    }

    // Custom avoidMoves
    if (args.avoidMoves && args.avoidMoves.length > 0) {
      const existing = (query.avoidMoves as Array<{ move: string; untilDepth?: number }> | undefined) ?? [];
      for (const am of args.avoidMoves) {
        existing.push({
          move: coordToGtp(am.x, am.y, boardSize),
          untilDepth: am.untilDepth ?? 1,
        });
      }
      query.avoidMoves = existing;
    }

    // Custom allowMoves
    if (args.allowMoves && args.allowMoves.length > 0) {
      query.allowMoves = args.allowMoves.map((am) => ({
        moves: am.moves.map((m) => coordToGtp(m.x, m.y, boardSize)),
        untilDepth: am.untilDepth ?? 1,
      }));
    }

    const promise = new Promise<KataGoAnalysisPayload>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress: args.onProgress });
      this._queryBoardSizes.set(id, boardSize);
    });

    try {
      this._send(query);
    } catch (err) {
      this.pending.delete(id);
      throw err;
    }

    return promise;
  }

  async evaluate(args: {
    modelUrl: string;
    backend?: KataGoBackendPreference;
    board: BoardState;
    previousBoard?: BoardState;
    previousPreviousBoard?: BoardState;
    currentPlayer: Player;
    moveHistory: Move[];
    komi: number;
    rules?: GameRules;
    conservativePass?: boolean;
  }): Promise<KataGoAnalysisPayload> {
    await this._ensureConnected();
    // Use a lightweight analyze with 1 visit for a pure network eval.
    return this.analyze({
      ...args,
      visits: 1,
      ownershipMode: 'none',
      includeMovesOwnership: false,
      analysisPvLen: 0,
      topK: 1,
      reportDuringSearchEveryMs: undefined,
    });
  }

  async evaluateBatch(args: {
    modelUrl: string;
    backend?: KataGoBackendPreference;
    positions: Array<{
      board: BoardState;
      previousBoard?: BoardState;
      previousPreviousBoard?: BoardState;
      currentPlayer: Player;
      moveHistory: Move[];
      komi: number;
    }>;
    rules?: GameRules;
    conservativePass?: boolean;
  }): Promise<KataGoAnalysisPayload[]> {
    // Run evals sequentially — the remote server may not support batching.
    const results: KataGoAnalysisPayload[] = [];
    for (const pos of args.positions) {
      results.push(
        await this.analyze({
          modelUrl: args.modelUrl,
          backend: args.backend,
          board: pos.board,
          previousBoard: pos.previousBoard,
          previousPreviousBoard: pos.previousPreviousBoard,
          currentPlayer: pos.currentPlayer,
          moveHistory: pos.moveHistory,
          komi: pos.komi,
          rules: args.rules,
          conservativePass: args.conservativePass,
          visits: 1,
          ownershipMode: 'none',
          includeMovesOwnership: false,
          analysisPvLen: 0,
          topK: 1,
        }),
      );
    }
    return results;
  }

  // ─── WebSocket lifecycle ──────────────────────────────────────────────

  private _connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this._connId++;
      const connId = this._connId;
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== null) clearTimeout(timeoutId);
        fn();
      };

      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
        this.ws = ws;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this._crashed = error;
        reject(error);
        return;
      }

      // Timeout: if the handshake takes longer than 10s, give up.
      timeoutId = setTimeout(() => {
        settle(() => {
          try { ws.close(1000, 'Connection timeout'); } catch { /* ignore */ }
          reject(new Error('WebSocket connection timed out after 10s'));
        });
      }, 10_000);

      ws.onopen = () => {
        if (this._closing || connId !== this._connId) {
          try { ws.close(1000, 'Superseded'); } catch { /* ignore */ }
          settle(() => reject(new Error('Connection superseded')));
          return;
        }
        this._reportConnected();
        this._reportedDead = false;
        this._crashed = null;
        settle(() => resolve());
      };

      ws.onmessage = (ev: MessageEvent<string>) => {
        if (this._closing || connId !== this._connId) return;
        this._crashed = null;
        const raw = ev.data;
        if (!raw) return;
        for (const line of String(raw).split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          this._dispatchLine(trimmed);
        }
      };

      ws.onclose = (ev: CloseEvent) => {
        if (this._closing) return;
        if (connId !== this._connId) return;
        // Build a more descriptive error message.
        const reason = ev.reason || `WebSocket closed (code ${ev.code}${ev.wasClean ? ', clean' : ', abnormal'})`;
        if (!settled) {
          // Initial connection failure.
          settle(() => reject(new Error(reason)));
        } else {
          // Established connection dropped.
          this._handleDisconnect(reason, connId);
        }
      };

      ws.onerror = () => {
        if (connId === this._connId) {
          this._backendNote = 'WebSocket connection error';
        }
        // If the handshake hasn't completed yet, give the close event a moment
        // to fire (onerror is always followed by onclose). If onclose doesn't
        // fire within 200ms, reject here.
        if (!settled) {
          setTimeout(() => {
            if (!settled && connId === this._connId) {
              settle(() => reject(new Error('WebSocket connection failed (network error)')));
            }
          }, 200);
        }
      };
    });
  }

  private _handleDisconnect(reason: string, connId: number): void {
    if (this._closing || this._reconnecting) return;
    if (connId !== this._connId) return;
    this._reconnecting = true;
    this.ws = null;
    this._reconnectLoop(reason);
  }

  private async _reconnectLoop(initialReason: string): Promise<void> {
    let reason = initialReason;
    for (let attempt = 1; attempt <= this.RECONNECT_ATTEMPTS; attempt++) {
      if (this._closing) {
        this._reconnecting = false;
        return;
      }
      const delay = Math.min(
        this.RECONNECT_BACKOFF_S * attempt,
        this.RECONNECT_MAX_BACKOFF_S,
      );
      console.info(
        `[remote-engine] Disconnected (${reason}); reconnect attempt ${attempt}/${this.RECONNECT_ATTEMPTS} in ${delay.toFixed(0)}s`,
      );
      await new Promise((r) => setTimeout(r, delay * 1000));
      if (this._closing) {
        this._reconnecting = false;
        return;
      }
      try {
        await this._connect();
        this._reconnecting = false;
        this._reportedDead = false;
        console.info('[remote-engine] Reconnected');
        return;
      } catch (err) {
        reason = err instanceof Error ? err.message : String(err);
      }
    }

    // All retries exhausted.
    this._reconnecting = false;
    if (!this._closing) {
      this._reportedDead = true;
      this._failAllPending(new Error(`Remote engine disconnected: ${reason}`));
      this._crashed = new Error(`Remote engine disconnected: ${reason}`);
    }
  }

  private _reportConnected(): void {
    this._backend = `remote (${this.url})`;
    this._modelName = 'remote KataGo';
    this._backendNote = null;
  }

  // ─── Sending ──────────────────────────────────────────────────────────

  private _send(query: Record<string, unknown>): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Remote engine is not connected');
    }
    const payload = JSON.stringify(query);
    ws.send(payload);
  }

  // ─── Dispatch ────────────────────────────────────────────────────────

  private _dispatchLine(line: string): void {
    let resp: RemoteResponse;
    try {
      resp = JSON.parse(line) as RemoteResponse;
    } catch {
      console.warn(`[remote-engine] Bad JSON from server: ${line.slice(0, 200)}`);
      return;
    }

    const queryId = resp.id;
    if (!queryId) {
      if (resp.error) {
        console.warn(`[remote-engine] Error without ID: ${resp.error}`);
      }
      return;
    }

    // Handle terminate responses
    if (resp.terminateId) {
      return;
    }

    // Check if it's an eval or evalBatch
    const pendingEval = this.pendingEval.get(queryId);
    const pendingEvalBatch = this.pendingEvalBatch.get(queryId);
    const pending = this.pending.get(queryId);

    if (!pending && !pendingEval && !pendingEvalBatch) {
      return; // stale or already resolved
    }

    if (resp.error) {
      const err = new Error(resp.error);
      if (pending) {
        this.pending.delete(queryId);
        this._queryBoardSizes.delete(queryId);
        pending.reject(err);
      }
      if (pendingEval) {
        this.pendingEval.delete(queryId);
        pendingEval.reject(err);
      }
      if (pendingEvalBatch) {
        this.pendingEvalBatch.delete(queryId);
        pendingEvalBatch.reject(err);
      }
      return;
    }

    if (resp.warning) {
      console.info(`[remote-engine] Warning: ${resp.warning}`);
    }

    // Convert remote response to KataGoAnalysisPayload
    const boardSize = this._queryBoardSizes.get(queryId) ?? DEFAULT_BOARD_SIZE;
    const analysis = this._convertResponse(resp, boardSize);

    if (resp.isDuringSearch) {
      // Progress update
      pending?.onProgress?.(analysis);
      return;
    }

    // Final result
    if (pending) {
      this.pending.delete(queryId);
      this._queryBoardSizes.delete(queryId);
      pending.resolve(analysis);
    }
    if (pendingEval) {
      this.pendingEval.delete(queryId);
      pendingEval.resolve(analysis);
    }
    if (pendingEvalBatch) {
      this.pendingEvalBatch.delete(queryId);
      pendingEvalBatch.resolve([analysis]);
    }
  }

  // ─── Response conversion ──────────────────────────────────────────────

  private _convertResponse(resp: RemoteResponse, boardSize: number): KataGoAnalysisPayload {
    const ri = resp.rootInfo;
    const mi = resp.moveInfos;

    const ownership = new Float32Array(boardSize * boardSize);
    const ownershipStdev = new Float32Array(boardSize * boardSize);
    const policy = buildPolicy(mi, boardSize);

    const moves = mi.map((m, idx) => ({
      x: (() => {
        const c = /^([A-HJ-T])([1-9]\d?)$/.exec(m.move.trim().toUpperCase());
        if (!c) return -1;
        const col = c[1]!;
        return col.charCodeAt(0) - 65 - (col > 'I' ? 1 : 0);
      })(),
      y: (() => {
        const c = /^([A-HJ-T])([1-9]\d?)$/.exec(m.move.trim().toUpperCase());
        if (!c) return -1;
        const row = Number.parseInt(c[2]!, 10);
        return boardSize - row;
      })(),
      winRate: m.winrate,
      winRateLost: idx > 0 ? mi[0]!.winrate - m.winrate : 0,
      scoreLead: m.scoreLead,
      scoreSelfplay: m.scoreSelfplay,
      scoreStdev: m.scoreStdev,
      visits: m.visits,
      edgeVisits: m.edgeVisits,
      noResultValue: m.noResultValue,
      weight: m.weight,
      edgeWeight: m.edgeWeight,
      pointsLost: idx > 0 ? Math.max(0, mi[0]!.scoreLead - m.scoreLead) : 0,
      relativePointsLost: idx > 0 ? Math.max(0, mi[0]!.scoreLead - m.scoreLead) : 0,
      order: m.order,
      prior: m.prior,
      pv: m.pv,
      pvVisits: m.pvVisits,
      pvEdgeVisits: undefined,
      lcb: m.lcb,
      utilityLcb: m.utilityLcb,
      playSelectionValue: m.playSelectionValue,
      utility: m.utility,
      humanPrior: undefined,
      ownership: undefined,
    }));

    return {
      rootWinRate: ri.winrate,
      rootScoreLead: ri.scoreLead,
      rootScoreSelfplay: ri.scoreSelfplay,
      rootScoreStdev: ri.scoreStdev,
      rootVisits: ri.visits,
      rawWinRate: ri.rawWinrate,
      rawScoreLead: ri.rawScoreLead,
      rawScoreSelfplay: ri.rawScoreSelfplay,
      rawScoreSelfplayStdev: ri.rawScoreSelfplayStdev,
      rawNoResultProb: ri.rawNoResultProb,
      rawStWrError: ri.rawStWrError,
      rawStScoreError: ri.rawStScoreError,
      rawVarTimeLeft: ri.rawVarTimeLeft,
      ownership,
      ownershipStdev,
      policy,
      moves,
    };
  }

  // ─── Error handling ──────────────────────────────────────────────────

  private _rejectIfCrashed(): void {
    if (this._crashed) throw this._crashed;
  }

  private _failAllPending(error: Error): void {
    for (const [, pending] of this.pending) pending.reject(error);
    this.pending.clear();
    this._queryBoardSizes.clear();
    for (const [, pending] of this.pendingEval) pending.reject(error);
    this.pendingEval.clear();
    for (const [, pending] of this.pendingEvalBatch) pending.reject(error);
    this.pendingEvalBatch.clear();
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────

let singleton: RemoteEngineClient | null = null;

export function getRemoteEngineClient(url: string): RemoteEngineClient {
  if (singleton && singleton['url'] !== url) {
    singleton.dispose();
    singleton = null;
  }
  if (!singleton) {
    singleton = new RemoteEngineClient(url);
  }
  return singleton;
}

export function resetRemoteEngineClientForTests(): void {
  singleton?.dispose();
  singleton = null;
}

export { RemoteEngineClient };