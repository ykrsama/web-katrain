import { describe, expect, it } from 'vitest';
import { buildAnalysisQuery, buildQueryPosition } from '../src/engine/remote/types';
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
