/**
 * A live read over an SGF that already carries a whole-game review.
 *
 * This drives a *real* remote KataGo engine, so it is opt-in: put the server in
 * a gitignored `.env` and the suite runs, otherwise it is skipped.
 *
 *   VITE_REMOTE_ENGINE_URL=ws://host:port/katago
 *
 * Why a real engine: a remote analysis engine keeps no search tree between
 * queries, so every request starts from zero. That restart is what used to make
 * a review loaded from SGF flicker back to its first few hundred visits and
 * climb again. The mocked regression in `analysisDepth.test.ts` pins the same
 * rule without needing a network.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { resetRemoteEngineClientForTests } from '../src/engine/remote/client';
import { useGameStore } from '../src/store/gameStore';
import { parseSgf } from '../src/utils/sgf';
import { encodeKaTrainKtFromAnalysis } from '../src/utils/katrainSgfAnalysis';

const remoteUrl = (import.meta.env.VITE_REMOTE_ENGINE_URL ?? '').trim();

/** An SGF whose single KT blob remembers a whole-game review at `visits`. */
const sgfWithSavedReview = (visits: number): string => {
  const kt = encodeKaTrainKtFromAnalysis({
    analysis: {
      rootWinRate: 0.5,
      rootScoreLead: 0,
      rootVisits: visits,
      moves: [
        {
          x: 3,
          y: 3,
          order: 0,
          visits,
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
  return `(;GM[1]SZ[19]KT${kt.map((blob) => `[${blob}]`).join('')})`;
};

describe.skipIf(!remoteUrl)('live analysis over a review loaded from SGF (remote engine)', () => {
  afterEach(() => {
    useGameStore.getState().stopAnalysis();
    resetRemoteEngineClientForTests();
  });

  it('waits until the restarted search passes the depth the file already had', async () => {
    const game = useGameStore.getState();
    game.resetGame();
    useGameStore.setState((s) => ({
      isAnalysisMode: false,
      settings: {
        ...s.settings,
        engineMode: 'remote',
        remoteEngineUrl: remoteUrl,
        katagoVisits: 10_000,
        katagoFastVisits: 25,
      },
    }));
    game.loadGame(parseSgf(sgfWithSavedReview(5000)));

    const node = () => useGameStore.getState().currentNode;
    expect(node().analysis?.rootVisits).toBe(5000);

    const shown: number[] = [];
    const unsubscribe = useGameStore.subscribe((s) => {
      const visits = s.analysisData?.rootVisits;
      if (typeof visits === 'number') shown.push(visits);
    });

    // The reader raised the live depth to 10000, so a fresh query goes out and
    // starts from zero. Until it passes 5000 the board keeps the file's numbers.
    useGameStore.setState({ isAnalysisMode: true });
    await useGameStore.getState().runAnalysis({ force: true, visits: 10_000, maxTimeMs: 30_000 });
    unsubscribe();

    expect(shown.length).toBeGreaterThan(0);
    expect(Math.min(...shown)).toBeGreaterThanOrEqual(5000);
    // And the deeper search does take over once it is past the loaded depth.
    expect(Math.max(...shown)).toBeGreaterThan(5000);
    expect(node().analysis?.rootVisits ?? 0).toBeGreaterThan(5000);
    // The numbers above came from the remote engine, not a local fallback.
    expect(useGameStore.getState().engineBackend).toMatch(/^remote/);
  }, 180_000);
});
