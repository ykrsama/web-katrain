import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  KataGoCanceledError,
  getRemoteEngineClient,
  resetRemoteEngineClientForTests,
} from '../src/engine/remote/client';
import type { BoardState, Move, Player } from '../src/types';

const emptyBoard = (size: number): BoardState =>
  Array.from({ length: size }, () => Array<Player | null>(size).fill(null));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type SentQuery = Record<string, unknown>;

/** A WebSocket that records frames and lets the test answer them by hand. */
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

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  queries(): SentQuery[] {
    return this.sent.map((frame) => JSON.parse(frame) as SentQuery);
  }

  reply(payload: Record<string, unknown>): void {
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(payload) }));
  }
}

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

let realWebSocket: typeof WebSocket;

beforeEach(() => {
  realWebSocket = globalThis.WebSocket;
  FakeSocket.instances = [];
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  resetRemoteEngineClientForTests();
});

afterEach(() => {
  resetRemoteEngineClientForTests();
  globalThis.WebSocket = realWebSocket;
});

describe('remote engine scheduling', () => {
  it('sends the queue priority with the query so the engine can rank it', async () => {
    const client = getRemoteEngineClient('ws://fake.invalid/katago');
    const promise = client.analyze(baseArgs({ priority: 1000 }));
    promise.catch(() => undefined);

    await flush();
    const socket = FakeSocket.instances.at(-1)!;
    const query = socket.queries().at(-1)!;
    expect(query.priority).toBe(1000);

    socket.reply(analysisReply(query.id as string));
    await expect(promise).resolves.toMatchObject({ rootWinRate: 0.5 });
  });

  it('leaves priority out when the caller has no opinion', async () => {
    const client = getRemoteEngineClient('ws://fake.invalid/katago');
    const promise = client.analyze(baseArgs());
    promise.catch(() => undefined);

    await flush();
    const socket = FakeSocket.instances.at(-1)!;
    const query = socket.queries().at(-1)!;
    expect(query).not.toHaveProperty('priority');

    socket.reply(analysisReply(query.id as string));
    await promise;
  });

  it('appends `nextMove` so a candidate can be searched after the move', async () => {
    const client = getRemoteEngineClient('ws://fake.invalid/katago');
    const promise = client.analyze(baseArgs({ nextMove: { x: 3, y: 3, player: 'black' } }));
    promise.catch(() => undefined);

    await flush();
    const socket = FakeSocket.instances.at(-1)!;
    const query = socket.queries().at(-1)!;
    expect(query.moves).toEqual([['B', 'D16']]);

    socket.reply(analysisReply(query.id as string));
    await promise;
  });
});

describe('remote engine cancellation', () => {
  it('terminates the query on the engine when the signal aborts', async () => {
    const client = getRemoteEngineClient('ws://fake.invalid/katago');
    const controller = new AbortController();
    const promise = client.analyze(baseArgs({ signal: controller.signal, visits: 1000 }));
    promise.catch(() => undefined);

    await flush();
    const socket = FakeSocket.instances.at(-1)!;
    const query = socket.queries().at(-1)!;

    controller.abort();
    await flush();

    const terminate = socket.queries().at(-1)!;
    expect(terminate.action).toBe('terminate');
    expect(terminate.terminateId).toBe(query.id);

    await expect(promise).rejects.toBeInstanceOf(KataGoCanceledError);

    // The engine still answers the terminated query; nothing must blow up and
    // nothing may resolve the already-rejected promise.
    socket.reply(analysisReply(query.id as string));
    await flush();
  });

  it('does not send a query that arrives already aborted', async () => {
    const client = getRemoteEngineClient('ws://fake.invalid/katago');
    const controller = new AbortController();
    controller.abort();

    await expect(client.analyze(baseArgs({ signal: controller.signal }))).rejects.toBeInstanceOf(
      KataGoCanceledError,
    );

    // Only the connection handshake happened; no analysis query went out.
    await flush();
    const socket = FakeSocket.instances.at(-1)!;
    expect(socket.queries().filter((q) => q.moves !== undefined)).toHaveLength(0);
  });

  it('settles a query the engine reports as having no results', async () => {
    const client = getRemoteEngineClient('ws://fake.invalid/katago');
    const promise = client.analyze(baseArgs());
    promise.catch(() => undefined);

    await flush();
    const socket = FakeSocket.instances.at(-1)!;
    const query = socket.queries().at(-1)!;
    socket.reply({ id: query.id, isDuringSearch: false, noResults: true });

    await expect(promise).rejects.toBeInstanceOf(KataGoCanceledError);
  });
});

describe('remote batch eval', () => {
  it('issues every position before waiting for any reply', async () => {
    const client = getRemoteEngineClient('ws://fake.invalid/katago');
    const promise = client.evaluateBatch({
      modelUrl: '',
      positions: [
        { board: emptyBoard(19), currentPlayer: 'black', moveHistory: [], komi: 7.5 },
        { board: emptyBoard(19), currentPlayer: 'white', moveHistory: [], komi: 7.5 },
        { board: emptyBoard(19), currentPlayer: 'black', moveHistory: [], komi: 7.5 },
      ],
      rules: 'chinese',
    });
    promise.catch(() => undefined);

    await flush();
    const socket = FakeSocket.instances.at(-1)!;
    const ids = socket.queries().map((query) => query.id as string);
    expect(ids).toHaveLength(3);

    for (const id of ids) socket.reply(analysisReply(id));
    await expect(promise).resolves.toHaveLength(3);
  });
});
