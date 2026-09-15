import { describe, expect, it } from 'vitest';
import { buildAnalysisQuery, buildQueryPosition } from '../src/engine/remote/types';
import { getRemoteEngineClient, resetRemoteEngineClientForTests } from '../src/engine/remote/client';
import type { BoardState, Move, Player } from '../src/types';

const emptyBoard = (size: number): BoardState =>
  Array.from({ length: size }, () => Array<Player | null>(size).fill(null));

const place = (board: BoardState, x: number, y: number, player: Player): void => {
  board[y]![x] = player;
};

describe('remote query position', () => {
  it('sends a plain game as moves with no initial stones', () => {
    const board = emptyBoard(19);
    place(board, 15, 3, 'black');
    place(board, 3, 15, 'white');
    const moveHistory: Move[] = [
      { x: 15, y: 3, player: 'black' },
      { x: 3, y: 15, player: 'white' },
    ];

    const position = buildQueryPosition(moveHistory, board, 19, 'black');

    expect(position.initialStones).toEqual([]);
    expect(position.moves).toEqual([
      ['B', 'Q16'],
      ['W', 'D4'],
    ]);
    expect(position.initialPlayer).toBe('B');
  });

  it('rebuilds a captured stone from the move history instead of bailing out', () => {
    // On 3x3: White (0,1) is surrounded by Black (0,0), (1,1), (0,2) and captured.
    const board = emptyBoard(3);
    place(board, 1, 0, 'black');
    place(board, 0, 0, 'black');
    place(board, 0, 2, 'black');
    place(board, 1, 1, 'black');
    place(board, 2, 2, 'white');
    place(board, 2, 0, 'white');
    const moveHistory: Move[] = [
      { x: 1, y: 0, player: 'black' },
      { x: 0, y: 1, player: 'white' },
      { x: 0, y: 0, player: 'black' },
      { x: 2, y: 2, player: 'white' },
      { x: 1, y: 1, player: 'black' },
      { x: 2, y: 0, player: 'white' },
      { x: 0, y: 2, player: 'black' },
    ];

    const position = buildQueryPosition(moveHistory, board, 3, 'black');

    expect(position.initialStones).toEqual([]);
    expect(position.moves).toHaveLength(7);
    expect(position.moves.at(-1)).toEqual(['B', 'A1']);
    expect(position.initialPlayer).toBe('B');
  });

  it('sends an imported setup position as initial stones with the right side to move', () => {
    // A photo-board import: no history at all, both colours on the board, PL[W].
    const board = emptyBoard(19);
    place(board, 0, 0, 'black');
    place(board, 1, 0, 'black');
    place(board, 2, 0, 'white');
    place(board, 3, 0, 'white');

    const position = buildQueryPosition([], board, 19, 'white');

    expect(position.moves).toEqual([]);
    expect(position.initialPlayer).toBe('W');
    expect(position.initialStones).toHaveLength(4);
    expect(position.initialStones).toEqual(
      expect.arrayContaining([
        ['B', 'A19'],
        ['B', 'B19'],
        ['W', 'C19'],
        ['W', 'D19'],
      ])
    );
  });

  it('keeps handicap stones as initial stones and lets White move first', () => {
    const board = emptyBoard(19);
    place(board, 3, 3, 'black');
    place(board, 15, 15, 'black');
    place(board, 15, 3, 'white');
    const moveHistory: Move[] = [{ x: 15, y: 3, player: 'white' }];

    const position = buildQueryPosition(moveHistory, board, 19, 'black');

    expect(position.initialStones).toEqual([
      ['B', 'D16'],
      ['B', 'Q4'],
    ]);
    expect(position.moves).toEqual([['W', 'Q16']]);
    // KataGo alternates from initialPlayer, so it has to be White here.
    expect(position.initialPlayer).toBe('W');
  });

  it('falls back to a pure setup position when the board is not a continuation of its history', () => {
    // The player erased the played stone and put a White one there instead.
    const board = emptyBoard(19);
    place(board, 15, 3, 'white');
    const moveHistory: Move[] = [{ x: 15, y: 3, player: 'black' }];

    const position = buildQueryPosition(moveHistory, board, 19, 'black');

    expect(position.moves).toEqual([]);
    expect(position.initialStones).toEqual([['W', 'Q16']]);
    expect(position.initialPlayer).toBe('B');
  });
});

describe('remote query position on a ko', () => {
  // 5x5 ko. Black's (1,2) captures the lone White stone at (2,2); Black (1,2)
  // is then a single stone with one liberty, (2,2), so White may not recapture
  // there immediately — the simple ko ban KataGo only sees if the capture is in
  // the query.
  const koBefore = (): BoardState => {
    const board = emptyBoard(5);
    place(board, 1, 1, 'black');
    place(board, 0, 2, 'black');
    place(board, 1, 3, 'black');
    place(board, 2, 1, 'black');
    place(board, 2, 3, 'black');
    place(board, 3, 2, 'black');
    place(board, 2, 2, 'white');
    return board;
  };
  const koAfter = (): BoardState => {
    const board = koBefore();
    board[2]![2] = null; // White captured by Black (1,2)
    place(board, 1, 2, 'black');
    return board;
  };
  const moveHistory: Move[] = [{ x: 1, y: 2, player: 'black' }];

  it('replays the ko capture on the previous board so the ko ban survives', () => {
    const position = buildQueryPosition(moveHistory, koAfter(), 5, 'white', koBefore());

    expect(position.moves).toEqual([['B', 'B3']]);
    expect(position.initialPlayer).toBe('B');
    // The captured White stone is still on the board the move is replayed on,
    // so KataGo performs the capture and sets the ko.
    expect(position.initialStones).toContainEqual(['W', 'C3']);
    expect(position.initialStones.filter(([, gtp]) => gtp === 'B3')).toHaveLength(0);
  });

  it('without the previous board the capture is lost, which is the bug it fixes', () => {
    // Only the final board is known: the captured White stone is gone from it,
    // so this history replays a move that captured nothing and the ko is gone.
    // A remote engine then answered with the forbidden immediate recapture.
    const position = buildQueryPosition(moveHistory, koAfter(), 5, 'white');

    expect(position.moves).toEqual([['B', 'B3']]);
    expect(position.initialStones).not.toContainEqual(['W', 'C3']);
  });

  it('a pass after the capture lifts the ko and steps out of the anchor', () => {
    const position = buildQueryPosition(
      [...moveHistory, { x: -1, y: -1, player: 'white' }],
      koAfter(),
      5,
      'black',
      koAfter(),
    );

    expect(position.moves).toEqual([['B', 'B3'], ['W', 'pass']]);
    expect(position.initialPlayer).toBe('B');
    expect(position.initialStones).not.toContainEqual(['W', 'C3']);
  });

  it('ignores a previous board that is not this move\u2019s predecessor', () => {
    const board = emptyBoard(19);
    place(board, 15, 3, 'white');
    const history: Move[] = [{ x: 15, y: 3, player: 'black' }];

    // An empty "previous board" cannot produce this board, so the anchor is
    // refused and the plain setup fallback is used.
    const position = buildQueryPosition(history, board, 19, 'black', emptyBoard(19));

    expect(position).toEqual({ initialStones: [['W', 'Q16']], moves: [], initialPlayer: 'B' });
  });

  it('ignores a previous board that already holds the last move', () => {
    // "What does playing elsewhere cost" sends the current board as the board
    // before the move, so replaying that move would play onto a stone.
    const board = emptyBoard(19);
    place(board, 15, 3, 'white');
    const history: Move[] = [{ x: 15, y: 3, player: 'white' }];

    const position = buildQueryPosition(history, board, 19, 'black', board);

    expect(position).toEqual({ initialStones: [], moves: [['W', 'Q16']], initialPlayer: 'W' });
  });

  it('carries the previous board through the client into the query', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const realWebSocket = globalThis.WebSocket;

    class FakeSocket {
      static OPEN = 1;
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((ev: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor() {
        queueMicrotask(() => {
          this.readyState = 1;
          this.onopen?.();
        });
      }

      send(data: string): void {
        const query = JSON.parse(data) as Record<string, unknown>;
        sent.push(query);
        const reply = {
          id: query.id,
          isDuringSearch: false,
          moveInfos: [],
          rootInfo: { winrate: 0.5, scoreLead: 0, scoreSelfplay: 0, scoreStdev: 0, visits: 1 },
        };
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(reply) }));
      }

      close(): void {
        this.readyState = 3;
      }
    }

    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    try {
      resetRemoteEngineClientForTests();
      const client = getRemoteEngineClient('ws://fake.invalid/katago');
      await client.analyze({
        modelUrl: '',
        board: koAfter(),
        previousBoard: koBefore(),
        currentPlayer: 'white',
        moveHistory,
        komi: 7.5,
        rules: 'chinese',
        visits: 20,
      });
    } finally {
      resetRemoteEngineClientForTests();
      globalThis.WebSocket = realWebSocket;
    }

    expect(sent).toHaveLength(1);
    expect(sent[0]!.moves).toEqual([['B', 'B3']]);
    expect(sent[0]!.initialStones).toContainEqual(['W', 'C3']);
    expect(sent[0]!.initialPlayer).toBe('B');
  });
});

describe('remote analysis query', () => {
  const position = { initialStones: [['W', 'Q16']] as Array<[string, string]>, moves: [], initialPlayer: 'B' as const };
  const base = { id: 'Q1', position, boardSize: 19, komi: 7.5, rules: 'chinese' as const };

  it('sends search settings as override settings, not top-level query fields', () => {
    // KataGo reported maxTime/wideRootNoise/conservativePass/fillDameBeforePass
    // as "Unexpected or unused field" at the top level and ignored them, so the
    // remote search ran to maxVisits regardless of the requested time limit.
    const query = buildAnalysisQuery({
      ...base,
      options: {
        visits: 400,
        maxTimeMs: 8000,
        wideRootNoise: 0,
        rootPolicyTemperature: 1.1,
        conservativePass: true,
        fillDameBeforePass: false,
      },
    });

    expect(query.maxTime).toBeUndefined();
    expect(query).not.toHaveProperty('wideRootNoise');
    expect(query).not.toHaveProperty('conservativePass');
    expect(query).not.toHaveProperty('fillDameBeforePass');
    expect(query.overrideSettings).toMatchObject({
      reportAnalysisWinratesAs: 'BLACK',
      maxTime: 8,
      wideRootNoise: 0,
      rootPolicyTemperature: 1.1,
      conservativePass: true,
      fillDameBeforePass: false,
    });
  });

  it('never sends topK, which the analysis engine does not accept', () => {
    const query = buildAnalysisQuery({ ...base, options: { topK: 5 } as never });

    expect(query).not.toHaveProperty('topK');
    expect(query.overrideSettings).not.toHaveProperty('topK');
  });

  it('omits analysisPVLen when the caller asks for no PV, which KataGo rejects as 0', () => {
    // "analysisPVLen: 0" comes back as "Must be an integer from 1 to 1000", so
    // the raw-eval path (evaluate/evaluateBatch ask for no PV) used to fail.
    const noPv = buildAnalysisQuery({ ...base, options: { visits: 1, analysisPvLen: 0 } });
    expect(noPv).not.toHaveProperty('analysisPVLen');

    const withPv = buildAnalysisQuery({ ...base, options: { analysisPvLen: 12 } });
    expect(withPv.analysisPVLen).toBe(12);

    const defaulted = buildAnalysisQuery({ ...base, options: {} });
    expect(defaulted.analysisPVLen).toBe(15);
  });

  it('carries the setup stones and the side to move', () => {
    const query = buildAnalysisQuery({ ...base, options: { visits: 100 } });

    expect(query.initialStones).toEqual([['W', 'Q16']]);
    expect(query.initialPlayer).toBe('B');
    expect(query.moves).toEqual([]);
    expect(query.rules).toBe('chinese');
    expect(query.komi).toBe(7.5);
  });

  it('merges region-of-interest avoids with explicit avoid moves and allow moves', () => {
    const query = buildAnalysisQuery({
      ...base,
      options: {
        regionOfInterest: { xMin: 15, yMin: 0, xMax: 18, yMax: 3 },
        avoidMoves: [{ x: 15, y: 0 }],
        allowMoves: [{ moves: [{ x: 15, y: 0 }] }],
      },
    });

    // Every point outside the 4x4 corner is avoided, plus the explicit avoid.
    expect(query.avoidMoves).toHaveLength(19 * 19 - 16 + 1);
    expect(query.avoidMoves).toContainEqual({ move: 'Q19', untilDepth: 1 });
    expect(query.allowMoves).toEqual([{ moves: ['Q19'], untilDepth: 1 }]);
  });
});
