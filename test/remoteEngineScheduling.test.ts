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
  it.each([9, 13, 19])('keeps normal analysis and full human probabilities separate on a %s board, including streaming and pass', async size => {
    const client = getRemoteEngineClient('ws://fake.invalid/katago');
    const progress: unknown[] = [];
    const promise = client.analyze(baseArgs({ board: emptyBoard(size), currentPlayer: 'white', humanSlProfile: 'rank_4k', humanModelUrl: '/browser-only-human.bin.gz', onProgress: (value: unknown) => progress.push(value) }));
    await flush();
    const socket = FakeSocket.instances.at(-1)!;
    const query = socket.queries().at(-1)!;
    expect(query.overrideSettings).toMatchObject({ humanSLProfile: 'rank_4k' });
    expect(JSON.stringify(query)).not.toContain('browser-only-human');
    const policy = new Array(size * size + 1).fill(0);
    const humanPolicy = [...policy];
    policy[1] = 0.75; policy[size * size] = 0.25;
    humanPolicy[1] = 0.2; humanPolicy[2] = 0.3; humanPolicy[size * size] = 0.5; humanPolicy[0] = -1;
    const info = { visits: 10, winrate: 0.6, scoreLead: 2, scoreSelfplay: 2, scoreStdev: 1, prior: 0.75, pv: [], order: 0 };
    const response = { ...analysisReply(query.id as string), policy, humanPolicy,
      moveInfos: [{ ...info, move: `B${size}` }, { ...info, move: 'pass', order: 1, prior: 0.25 }] };
    socket.reply({ ...response, isDuringSearch: true });
    await flush();
    expect(progress).toHaveLength(1);
    socket.reply(response);
    const result = await promise;
    expect(result.policy[1]).toBeCloseTo(0.75);
    expect(result.humanPolicy?.[1]).toBeCloseTo(0.2);
    expect(result.humanPolicy?.[2]).toBeCloseTo(0.3); // A legal human move outside the engine's reported candidates.
    expect(result.humanPolicy?.[0]).toBe(-1);
    expect(result.moves[0]?.humanPrior).toBeCloseTo(0.2);
    expect(result.moves[1]?.humanPrior).toBeCloseTo(0.5);
    expect(result.rootWinRate).toBe(0.5);
    expect(result.rootScoreLead).toBe(0);
  });

  it('continues normal analysis when a server omits or sends malformed human policy, without labelling engine policy as human', async () => {
    const client = getRemoteEngineClient('ws://fake.invalid/katago');
    for (const humanPolicy of [undefined, [0.5], new Array(362).fill('bad'), new Array(362).fill(-0.2)]) {
      const promise = client.analyze(baseArgs({ humanSlProfile: 'rank_4k' }));
      await flush();
      const socket = FakeSocket.instances.at(-1)!;
      const query = socket.queries().at(-1)!;
      socket.reply({ ...analysisReply(query.id as string), humanPolicy });
      expect((await promise).humanPolicy).toBeUndefined();
    }
  });

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
