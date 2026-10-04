import { beforeEach, describe, expect, it, vi } from 'vitest';

const analyzeMock = vi.fn();
const evaluateBatchMock = vi.fn();

vi.mock('../src/engine/remote/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/remote/client')>();
  return {
    ...actual,
    getRemoteEngineClient: () => ({
      analyze: analyzeMock,
      evaluate: vi.fn(),
      evaluateBatch: evaluateBatchMock,
      getEngineInfo: () => ({ backend: 'remote', modelName: 'remote', note: null }),
    }),
  };
});

const waitFor = async (predicate: () => boolean) => {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for store state');
};

const candidate = (x: number, y: number, visits = 10) => ({
  x,
  y,
  winRate: 0.5,
  scoreLead: 0,
  visits,
  pointsLost: 0,
  order: 0,
  prior: 0.5,
});

const rootPayload = (moves: ReturnType<typeof candidate>[]) => ({
  rootWinRate: 0.5,
  rootScoreLead: 0,
  rootScoreSelfplay: 0,
  rootScoreStdev: 30,
  rootVisits: 50,
  ownership: new Float32Array(19 * 19),
  moves,
});

const childPayload = () => ({
  rootWinRate: 0.6,
  rootScoreLead: 5,
  rootScoreSelfplay: 5,
  rootScoreStdev: 30,
  rootVisits: 100,
  ownership: new Float32Array(19 * 19),
  moves: [{ ...candidate(0, 0), pv: ['Q16'] }],
});

const remoteSettings = { engineMode: 'remote' as const, remoteEngineUrl: 'ws://fake.invalid/katago' };
const localSettings = { engineMode: 'local' as const };

describe('remote analysis parallelism', () => {
  beforeEach(async () => {
    analyzeMock.mockReset();
    evaluateBatchMock.mockReset();
    analyzeMock.mockImplementation(async (args: { nextMove?: unknown }) =>
      args.nextMove ? childPayload() : rootPayload([candidate(3, 3), candidate(15, 15)]),
    );

    const { analysisQueue } = await import('../src/utils/analysisQueue');
    const { useGameStore } = await import('../src/store/gameStore');
    analysisQueue.cancelWhere(() => true, 'test reset');
    analysisQueue.clearCache();
    useGameStore.getState().resetGame();
    useGameStore.setState({ engineError: null, engineStatus: 'idle', notification: null, isAnalysisMode: true });
  });

  it('serializes on the local worker and not on a remote engine', async () => {
    const { analysisQueue } = await import('../src/utils/analysisQueue');
    const { useGameStore } = await import('../src/store/gameStore');

    useGameStore.getState().updateSettings(localSettings);
    expect(analysisQueue.getConcurrency()).toBe(1);

    useGameStore.getState().updateSettings(remoteSettings);
    expect(analysisQueue.getConcurrency()).toBe(Number.POSITIVE_INFINITY);
  });

  it('equalize asks for one query per candidate, after the move, all at once', async () => {
    const { useGameStore } = await import('../src/store/gameStore');
    useGameStore.getState().updateSettings(remoteSettings);

    const store = useGameStore.getState();
    store.playMove(3, 3);
    await useGameStore.getState().runAnalysis({ force: true });

    const node = useGameStore.getState().currentNode;
    expect(node.analysis?.moves).toHaveLength(2);

    // Hold every refine query open so the test can see them all in flight.
    const held: Array<() => void> = [];
    analyzeMock.mockClear();
    analyzeMock.mockImplementation(
      (args: { nextMove?: unknown }) =>
        new Promise((resolve) => {
          held.push(() =>
            resolve(args.nextMove ? childPayload() : rootPayload([candidate(3, 3), candidate(15, 15)])),
          );
        }),
    );

    useGameStore.getState().analyzeExtra('equalize');

    await waitFor(() => held.length === 2);
    expect(analyzeMock.mock.calls).toHaveLength(2);

    const refined = analyzeMock.mock.calls.map((call) => call[0] as Record<string, unknown>);
    expect(refined.map((args) => `${(args.nextMove as { x: number }).x},${(args.nextMove as { y: number }).y}`)).toEqual([
      '3,3',
      '15,15',
    ]);
    // The engine can rank a sweep/equalize batch against live analysis.
    expect(refined.every((args) => typeof args.priority === 'number')).toBe(true);
    // The child position is described by appending the move, not by a new board.
    expect(refined[0]!.board).toBe(refined[0]!.previousBoard);

    for (const release of held) release();
    await waitFor(() => node.analysis?.moves.every((move) => move.visits === 100) ?? false);
    expect(node.analysis?.moves[0]!.scoreLead).toBe(5);
    // The PV of a refined candidate starts with the move itself.
    expect(node.analysis?.moves[0]!.pv?.[0]).toBe('D16');
  });
});
