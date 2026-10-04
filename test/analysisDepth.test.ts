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

  it('keeps the depth a saved SGF remembers until a live read passes it', async () => {
    const { useGameStore } = await import('../src/store/gameStore');
    const { analysisQueue } = await import('../src/utils/analysisQueue');
    const { parseSgf } = await import('../src/utils/sgf');
    const { encodeKaTrainKtFromAnalysis } = await import('../src/utils/katrainSgfAnalysis');

    // A whole-game review saved as SGF. Web-KaTrain stores the search it ran in
    // a KT blob, and the root visits in that blob is what the file remembers
    // about how deep the review went.
    const kt = encodeKaTrainKtFromAnalysis({
      analysis: {
        rootWinRate: 0.5,
        rootScoreLead: 0,
        rootVisits: 5000,
        moves: [
          {
            x: 3,
            y: 3,
            order: 0,
            visits: 5000,
            winRate: 0.5,
            winRateLost: 0,
            scoreLead: 0,
            scoreSelfplay: 0,
            scoreStdev: 0,
            pointsLost: 0,
            relativePointsLost: 0,
          },
        ],
        territory: Array.from({ length: 19 }, () => Array(19).fill(0)),
      },
      boardSize: 19,
    });
    const sgf = `(;GM[1]SZ[19]KT${kt.map((blob) => `[${blob}]`).join('')})`;

    const game = useGameStore.getState();
    game.resetGame();
    game.loadGame(parseSgf(sgf));

    const node = () => useGameStore.getState().currentNode;
    const depth = () => node().analysis?.rootVisits;
    expect(depth()).toBe(5000);

    // The reader then raises the live depth to 10000. A remote engine keeps no
    // search tree, so its new search starts from zero; until it passes 5000 the
    // board must keep showing what the file loaded.
    analysisQueue.clearCache();
    searchTo(400);
    await useGameStore.getState().runAnalysis({ visits: 10000 });
    expect(depth()).toBe(5000);

    // Once the restarted search is deeper, it takes over.
    analysisQueue.clearCache();
    searchTo(12000);
    await useGameStore.getState().runAnalysis({ visits: 10000 });
    expect(depth()).toBe(12000);
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

  it('re-runs a fast review over a position that is already deeper', async () => {
    const { useGameStore } = await import('../src/store/gameStore');
    const depth = () => useGameStore.getState().currentNode.analysis?.rootVisits;
    const runReview = async () => {
      useGameStore.getState().startFastGameAnalysis();
      for (let i = 0; i < 200 && useGameStore.getState().isGameAnalysisRunning; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };

    useGameStore.setState({ isAnalysisMode: false });
    useGameStore.getState().playMove(3, 3);
    useGameStore.setState({ isAnalysisMode: true });

    searchTo(9000);
    await useGameStore.getState().runAnalysis({ force: true, visits: 9000 });
    expect(depth()).toBe(9000);

    useGameStore.setState((s) => ({ settings: { ...s.settings, katagoFastVisits: 25 } }));
    searchTo(25);
    await runReview();

    // The review overwrites the deeper analysis instead of skipping it for
    // already being "deep enough".
    expect(depth()).toBe(25);

    // And a second review searches again rather than replaying the cached
    // result: the model can change with no URL change to notice, so a review is
    // the refresh, not a cache hit. Two nodes on the line, two fresh searches.
    const searched = analyzeMock.mock.calls.length;
    await runReview();
    expect(analyzeMock.mock.calls.length).toBe(searched + 2);
  });

  it('replaces positions one at a time and leaves the rest of the review alone', async () => {
    const { useGameStore } = await import('../src/store/gameStore');
    const nodeAt = (index: number) => {
      let node = useGameStore.getState().rootNode;
      for (let i = 0; i < index; i++) node = node.children[0]!;
      return node;
    };

    useGameStore.setState({ isAnalysisMode: false });
    useGameStore.getState().playMove(3, 3);
    useGameStore.getState().playMove(15, 15);
    useGameStore.getState().playMove(3, 15);
    useGameStore.setState({ isAnalysisMode: true });

    // Every position already carries an earlier model's analysis.
    searchTo(9000);
    for (const index of [0, 1, 2, 3]) {
      useGameStore.setState({ currentNode: nodeAt(index) });
      await useGameStore.getState().runAnalysis({ force: true, visits: 9000 });
      expect(nodeAt(index).analysis?.rootVisits).toBe(9000);
    }

    // Start a review and hold every answer, so nothing has been replaced yet.
    const held: Array<() => void> = [];
    analyzeMock.mockImplementation(
      () => new Promise((resolve) => held.push(() => resolve(resultAt(25)))),
    );
    useGameStore.setState((s) => ({ settings: { ...s.settings, katagoFastVisits: 25 } }));
    useGameStore.getState().startFastGameAnalysis();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Clicking review does not wipe anything: the old numbers stay on every
    // position until that position's own new result arrives.
    expect([0, 1, 2, 3].map((i) => nodeAt(i).analysis?.rootVisits)).toEqual([9000, 9000, 9000, 9000]);

    // Release one answer: exactly that position is replaced.
    expect(held.length).toBeGreaterThan(0);
    held.shift()!();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(nodeAt(0).analysis?.rootVisits).toBe(25);

    while (useGameStore.getState().isGameAnalysisRunning) {
      for (const release of held.splice(0)) release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(nodeAt(3).analysis?.rootVisits).toBe(25);
  });
});
