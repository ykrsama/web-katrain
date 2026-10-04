import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRemoteEngineClient, resetRemoteEngineClientForTests } from '../src/engine/remote/client';
import type { BoardState, Move, Player } from '../src/types';

const emptyBoard = (size: number): BoardState =>
  Array.from({ length: size }, () => Array<Player | null>(size).fill(null));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const waitFor = async (predicate: () => boolean, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for condition');
};

const analysisReply = (id: string) => ({
  id,
  isDuringSearch: false,
  moveInfos: [],
  rootInfo: { winrate: 0.5, scoreLead: 0, scoreSelfplay: 0, scoreStdev: 0, visits: 1 },
});

const baseArgs = (overrides: Record<string, unknown> = {}) => ({
  modelUrl: '',
  board: emptyBoard(19),
  currentPlayer: 'black' as const,
  moveHistory: [] as Move[],
  komi: 7.5,
  rules: 'chinese' as const,
  visits: 20,
  ...overrides,
});

/** A socket the test can open, drop and answer at will. */
class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];

  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor() {
    FakeSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.();
    });
  }

  queries(): Array<Record<string, unknown>> {
    return this.sent.map((frame) => JSON.parse(frame) as Record<string, unknown>);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: '', wasClean: true });
  }

  /** Lose the connection the way a flaky network does. */
  drop(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: 'connection dropped', wasClean: false });
  }

  reply(payload: Record<string, unknown>): void {
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(payload) }));
  }
}

/** A socket that never completes its handshake. */
class RefusingSocket {
  static OPEN = 1;
  static constructed = 0;

  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    RefusingSocket.constructed++;
    queueMicrotask(() => this.onerror?.());
  }

  send(): void {}
  close(): void {}
}

let realWebSocket: typeof WebSocket;

beforeEach(() => {
  realWebSocket = globalThis.WebSocket;
  FakeSocket.instances = [];
  RefusingSocket.constructed = 0;
  resetRemoteEngineClientForTests();
});

afterEach(() => {
  resetRemoteEngineClientForTests();
  globalThis.WebSocket = realWebSocket;
});

/**
 * The backoff and connect budget are what make a real reconnect patient; a test
 * does not need to wait them out, and the retry *behaviour* is what is under
 * test here.
 */
const withoutBackoff = <T extends object>(client: T, connectBudgetMs = 800): T => {
  (client as unknown as { RECONNECT_BACKOFF_S: number }).RECONNECT_BACKOFF_S = 0;
  (client as unknown as { RECONNECT_MAX_BACKOFF_S: number }).RECONNECT_MAX_BACKOFF_S = 0;
  (client as unknown as { CONNECT_TOTAL_TIMEOUT_MS: number }).CONNECT_TOTAL_TIMEOUT_MS = connectBudgetMs;
  return client;
};

describe('remote engine connection sharing', () => {
  it(
    'opens one socket per attempt, not one per waiting caller, when the handshake fails',
    async () => {
      globalThis.WebSocket = RefusingSocket as unknown as typeof WebSocket;
      const client = withoutBackoff(getRemoteEngineClient('ws://unreachable.invalid/katago'));

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => client.analyze(baseArgs())),
      );

      // Twenty callers share one retry chain: a handful of sockets, not twenty
      // (and not twenty per attempt). Every caller learns the outcome instead
      // of being left pending by a superseded connection's handlers.
      expect(RefusingSocket.constructed).toBeGreaterThan(1);
      expect(RefusingSocket.constructed).toBeLessThan(20);
      expect(results.every((r) => r.status === 'rejected')).toBe(true);
    },
    30_000,
  );

  it(
    'fails fast for callers that arrive during the post-failure cooldown',
    async () => {
      globalThis.WebSocket = RefusingSocket as unknown as typeof WebSocket;
      const client = withoutBackoff(getRemoteEngineClient('ws://unreachable.invalid/katago'));

      await expect(client.analyze(baseArgs())).rejects.toBeTruthy();
      const attemptsUsed = RefusingSocket.constructed;

      // A long review must not spend the whole connect budget once per window of
      // positions: after one patient attempt, the rest fail immediately.
      const startedAt = Date.now();
      await expect(client.analyze(baseArgs())).rejects.toBeTruthy();
      expect(RefusingSocket.constructed).toBe(attemptsUsed);
      expect(Date.now() - startedAt).toBeLessThan(200);
    },
    30_000,
  );
});

describe('remote engine reconnect', () => {
  it(
    're-sends a query that was in flight when the connection dropped',
    async () => {
      globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
      const client = withoutBackoff(getRemoteEngineClient('ws://fake.invalid/katago'));

      const promise = client.analyze(baseArgs({ visits: 50 }));
      promise.catch(() => undefined);
      await flush();

      const first = FakeSocket.instances[0]!;
      const query = first.queries()[0]!;
      expect(query.visits).toBeUndefined();
      expect(query.maxVisits).toBe(50);

      first.drop();

      await waitFor(() => FakeSocket.instances.length >= 2);
      const second = FakeSocket.instances[1]!;
      await waitFor(() => second.queries().length >= 1);

      // The reopened socket knows nothing of the old queries; the client puts
      // the same query to it rather than losing it.
      const resent = second.queries()[0]!;
      expect(resent.id).toBe(query.id);
      expect(resent.maxVisits).toBe(50);

      second.reply(analysisReply(query.id as string));
      await expect(promise).resolves.toMatchObject({ rootWinRate: 0.5 });
    },
    20_000,
  );

  it(
    'does not re-send a query that was aborted while the connection was down',
    async () => {
      globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
      const client = withoutBackoff(getRemoteEngineClient('ws://fake.invalid/katago'));

      const controller = new AbortController();
      const promise = client.analyze(baseArgs({ visits: 50, signal: controller.signal }));
      promise.catch(() => undefined);
      await flush();
      expect(FakeSocket.instances[0]!.queries()).toHaveLength(1);

      // Abort while disconnected: the query is dropped locally, so the new
      // socket must not be handed work nobody is waiting for.
      FakeSocket.instances[0]!.drop();
      controller.abort();
      await expect(promise).rejects.toBeTruthy();

      await waitFor(() => FakeSocket.instances.length >= 2);
      const second = FakeSocket.instances[1]!;
      await flush();
      expect(second.queries()).toHaveLength(0);
    },
    20_000,
  );
});
