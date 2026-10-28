import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisResult } from '../src/types';

const analyzeMock = vi.fn();

vi.mock('../src/engine/katago/client', () => ({
  getKataGoEngineClient: () => ({
    analyze: analyzeMock,
    evaluateBatch: vi.fn(),
    getEngineInfo: () => ({ backend: 'test', modelName: 'test-model', backendNote: null }),
  }),
  isKataGoCanceledError: (err: unknown) =>
    !!err && typeof err === 'object' && (err as { kataGoCanceled?: boolean }).kataGoCanceled === true,
}));

type AnalyzeArgs = {
  nextMove?: { x: number; y: number; player: string };
  regionOfInterest?: unknown;
};

const reply = (x: number, y: number, order: number, scoreLead: number, winRate: number) => ({
  x,
  y,
  order,
  winRate,
  scoreLead,
  visits: 20,
  pointsLost: 0,
});

const flush = async () => {
  for (let i = 0; i < 400; i++) {
    const { useGameStore } = await import('../src/store/gameStore');
    if (!useGameStore.getState().isTrickScanRunning) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('trick scan did not finish');
};

const startNineByNine = async () => {
  const { useGameStore } = await import('../src/store/gameStore');
  useGameStore.getState().startNewGame({ komi: 7.5, rules: 'chinese', boardSize: 9, handicap: 0 });
  return useGameStore.getState().currentNode;
};

/**
 * A fake engine that answers every candidate read with the opponent's replies.
 *
 * Black holds 50% at the scanned position, so White does too. The candidate at
 * (3,3) is the trap: White's best reply keeps 50% and their second choice drops
 * to 45% while losing 5 points. (4,4) also costs White points on their second
 * choice but keeps their winrate, so it must not be marked. Everything else
 * leaves a reply that holds. Scores and winrates are black-perspective, the
 * frame the app reads.
 */
const installEngine = () => {
  analyzeMock.mockImplementation(async (args: AnalyzeArgs) => {
    const move = args.nextMove;
    if (!move) throw new Error('trick scan asked for a position with no move');
    const isTrap = move.x === 3 && move.y === 3;
    const losesPointsOnly = move.x === 4 && move.y === 4;
    const secondScore = isTrap || losesPointsOnly ? 5 : 2;
    const secondWinRate = isTrap ? 0.55 : 0.45;
    return {
      rootWinRate: 0.5,
      rootScoreLead: 0,
      rootVisits: 25,
      moves: [reply(0, 5, 0, 0, 0.45), reply(1, 5, 1, secondScore, secondWinRate)],
      ownership: [],
    };
  });
};

const analysis = (): AnalysisResult => ({
  rootWinRate: 0.5,
  rootScoreLead: 0,
  rootVisits: 500,
  moves: [],
  territory: Array.from({ length: 9 }, () => Array(9).fill(0)),
});

describe('find trick moves', () => {
  beforeEach(async () => {
    analyzeMock.mockReset();
    const { analysisQueue } = await import('../src/utils/analysisQueue');
    analysisQueue.cancelWhere(() => true, 'test reset');
    analysisQueue.clearCache();
    analysisQueue.setConcurrency(1);
    const { useGameStore } = await import('../src/store/gameStore');
    useGameStore.getState().resetGame();
    useGameStore.setState({
      isAnalysisMode: true,
      isAiPlaying: false,
      aiColor: null,
      regionOfInterest: null,
      isTrickScanRunning: false,
      trickMoves: null,
      notification: null,
    });
  });

  afterEach(async () => {
    const { analysisQueue } = await import('../src/utils/analysisQueue');
    analysisQueue.setConcurrency(1);
    analysisQueue.cancelWhere(() => true, 'test done');
  });

  it('tests every legal point and marks the one that leaves a single good reply', async () => {
    const { useGameStore } = await import('../src/store/gameStore');
    const node = await startNineByNine();
    const previousAnalysis = analysis();
    node.analysis = previousAnalysis;
    installEngine();

    useGameStore.getState().findTrickMoves();
    await flush();

    const state = useGameStore.getState();
    // A 9x9 empty board has 81 legal points, and every one of them is read.
    expect(state.trickScanTotal).toBe(81);
    expect(state.trickScanDone).toBe(81);
    expect(analyzeMock).toHaveBeenCalledTimes(81);
    expect(state.trickMoves).toEqual({ nodeId: node.id, marks: [{ x: 3, y: 3, secondLoss: 5 }] });
    expect(state.notification?.message).toBe('Trick moves: 1.');
    // The scan analyses positions that were never played: it must not rewrite
    // the node, which still carries the live analysis.
    expect(node.analysis).toBe(previousAnalysis);
  });

  it('only scans the legal points inside the framed region', async () => {
    const { useGameStore } = await import('../src/store/gameStore');
    const node = await startNineByNine();
    node.analysis = analysis();
    installEngine();
    // A 3x3 box around (3,3).
    useGameStore.setState({ regionOfInterest: { xMin: 2, yMin: 2, xMax: 4, yMax: 4 } });

    useGameStore.getState().findTrickMoves();
    await flush();

    expect(analyzeMock).toHaveBeenCalledTimes(9);
    expect(useGameStore.getState().trickScanTotal).toBe(9);
    expect(useGameStore.getState().trickMoves?.marks).toEqual([{ x: 3, y: 3, secondLoss: 5 }]);
    // The region narrows the reader's own candidates, not the opponent's
    // answers: the follow-up reads are unrestricted.
    for (const call of analyzeMock.mock.calls) {
      expect((call[0] as AnalyzeArgs).regionOfInterest ?? null).toBeNull();
    }
  });

  it('dispatches the reads together instead of awaiting them one by one', async () => {
    const { useGameStore } = await import('../src/store/gameStore');
    const { analysisQueue } = await import('../src/utils/analysisQueue');
    const node = await startNineByNine();
    node.analysis = analysis();

    // Hold every answer until all 81 reads are in flight. A sequential loop
    // starts one, waits for it, and never gets there; the queue's remote window
    // is what lets the engine batch the positions.
    let started = 0;
    let release = () => {};
    const allStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    analyzeMock.mockImplementation(async () => {
      started++;
      if (started === 81) release();
      await allStarted;
      return {
        rootWinRate: 0.5,
        rootScoreLead: 0,
        rootVisits: 25,
        moves: [reply(0, 5, 0, 0, 0.45), reply(1, 5, 1, 2, 0.45)],
        ownership: [],
      };
    });
    analysisQueue.setConcurrency(81);

    useGameStore.getState().findTrickMoves();
    await flush();

    expect(started).toBe(81);
  });

  it('puts the control next to the play-elsewhere read and draws its marks on the board', () => {
    const row = readFileSync('src/components/TenukiRow.tsx', 'utf8');
    expect(row).toContain('findTrickMoves');
    expect(row).toContain('summarizeTrickRow');

    const board = readFileSync('src/components/GoBoard.tsx', 'utf8');
    expect(board).toContain('trickCanvasRef');
    expect(board).toContain('trickMoves?.nodeId === currentNode.id');
    expect(board).toContain('data-trick-move-count');
  });
});
