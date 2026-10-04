import { beforeEach, describe, expect, it, vi } from 'vitest';

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

type AnalyzeArgs = { onProgress?: (analysis: unknown) => void };

const resultAt = (visits: number) => ({
  rootWinRate: 0.5,
  rootScoreLead: 0,
  rootVisits: visits,
  moves: [{ x: 3, y: 3, order: 0, winRate: 0.5, scoreLead: 0, visits, pointsLost: 0 }],
  ownership: new Array(19 * 19).fill(0),
});

/** A search that reports `visits` mid-flight and then finishes there. */
const searchTo = (visits: number) =>
  analyzeMock.mockImplementation(async (args: AnalyzeArgs) => {
    args.onProgress?.(resultAt(visits));
    return resultAt(visits);
  });

describe('a live read against a position that already has analysis', () => {
  beforeEach(async () => {
    analyzeMock.mockReset();
    const { analysisQueue } = await import('../src/utils/analysisQueue');
    analysisQueue.cancelWhere(() => true, 'test reset');
    analysisQueue.clearCache();
    const { useGameStore } = await import('../src/store/gameStore');
    useGameStore.getState().resetGame();
    useGameStore.setState({
      isAnalysisMode: true,
      isAiPlaying: false,
      aiColor: null,
      currentPlayer: 'black',
      notification: null,
    });
  });

  it('holds the depth already there until a restarted search passes it', async () => {
    const { useGameStore } = await import('../src/store/gameStore');
    const { analysisQueue } = await import('../src/utils/analysisQueue');
    const node = () => useGameStore.getState().currentNode;
    const depth = () => node().analysis?.rootVisits;

    // A first pass reached 1000 of the 5000 asked for and was stopped (the user
    // navigated away). Nothing was finalised, so no requested depth was recorded
    // and no completed result was cached — that is why coming back re-asks.
    searchTo(1000);
    await useGameStore.getState().runAnalysis({ force: true, visits: 5000 });
    node().analysisVisitsRequested = 0;
    analysisQueue.clearCache();
    expect(depth()).toBe(1000);

    // Back on the position. A remote engine keeps no tree, so the search starts
    // from zero; on the way past 400 the board must keep showing 1000.
    searchTo(400);
    await useGameStore.getState().runAnalysis({ visits: 5000 });
    expect(analyzeMock).toHaveBeenCalledTimes(2);
    expect(depth()).toBe(1000);

    // Once it is deeper, it takes over.
    analysisQueue.clearCache();
    searchTo(1200);
    await useGameStore.getState().runAnalysis({ visits: 5000 });
    expect(depth()).toBe(1200);
  });

  it('lets an explicit extra-analysis action replace it with a shallower view', async () => {
    const { useGameStore } = await import('../src/store/gameStore');
    const depth = () => useGameStore.getState().currentNode.analysis?.rootVisits;

    searchTo(9000);
    await useGameStore.getState().runAnalysis({ force: true, visits: 9000 });
    expect(depth()).toBe(9000);

    // "Analyse without the top move" answers a different question; it must land.
    searchTo(50);
    await useGameStore.getState().runAnalysis({ force: true, visits: 50, allowShallower: true });
    expect(depth()).toBe(50);
  });
});
