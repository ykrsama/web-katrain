import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ENGINE_MAX_TIME_MS } from '../src/engine/katago/limits';

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

/** The `Max Time (ms)` setting the AI-to-move read is expected to fall back on. */
const MAX_TIME_SETTING_MS = 8_000;

const payload = (scoreLead: number) => ({
  rootWinRate: 0.5,
  rootScoreLead: scoreLead,
  rootVisits: 100,
  moves: [{ x: 15, y: 15, order: 0, winRate: 0.5, scoreLead, visits: 60, pointsLost: 0 }],
  ownership: new Array(19 * 19).fill(0),
});

const lastBudget = (): number => {
  const request = analyzeMock.mock.calls.at(-1)?.[0] as { maxTimeMs?: number } | undefined;
  if (!request || typeof request.maxTimeMs !== 'number') throw new Error('no analysis request went out');
  return request.maxTimeMs;
};

describe('the time budget a board read is given', () => {
  beforeEach(async () => {
    analyzeMock.mockReset();
    analyzeMock.mockResolvedValue(payload(0));
    const { analysisQueue } = await import('../src/utils/analysisQueue');
    analysisQueue.cancelWhere(() => true, 'test reset');
    analysisQueue.clearCache();
    const { useGameStore } = await import('../src/store/gameStore');
    useGameStore.getState().resetGame();
    useGameStore.setState({
      notification: null,
      isAnalysisMode: true,
      isTeachMode: false,
      // No bot, black to move.
      isAiPlaying: false,
      aiColor: null,
      currentPlayer: 'black',
    });
    useGameStore.setState((s) => ({ settings: { ...s.settings, katagoMaxTimeMs: MAX_TIME_SETTING_MS } }));
  });

  it('stays on the engine ceiling while two humans play', async () => {
    const { useGameStore } = await import('../src/store/gameStore');
    await useGameStore.getState().runAnalysis({ force: true });
    expect(lastBudget()).toBe(ENGINE_MAX_TIME_MS);
  });

  it('stays on the engine ceiling while the human is to move against a bot', async () => {
    const { useGameStore } = await import('../src/store/gameStore');
    useGameStore.setState({ isAiPlaying: true, aiColor: 'white', currentPlayer: 'black' });
    await useGameStore.getState().runAnalysis({ force: true });
    expect(lastBudget()).toBe(ENGINE_MAX_TIME_MS);
  });

  it('drops to the Max Time setting once the bot is the side to move', async () => {
    const { useGameStore } = await import('../src/store/gameStore');
    useGameStore.setState({ isAiPlaying: true, aiColor: 'white', currentPlayer: 'white' });
    await useGameStore.getState().runAnalysis({ force: true });
    expect(lastBudget()).toBe(MAX_TIME_SETTING_MS);
  });

  it('caps a Max Time that sits above the engine ceiling', async () => {
    const { useGameStore } = await import('../src/store/gameStore');
    useGameStore.setState((s) => ({
      settings: { ...s.settings, katagoMaxTimeMs: ENGINE_MAX_TIME_MS + 5_000 },
      isAiPlaying: true,
      aiColor: 'black',
      currentPlayer: 'black',
    }));
    await useGameStore.getState().runAnalysis({ force: true });
    expect(lastBudget()).toBe(ENGINE_MAX_TIME_MS);
  });

  it('still honours the explicit budget the extra-analysis actions pass', async () => {
    const { useGameStore } = await import('../src/store/gameStore');
    useGameStore.setState({ isAiPlaying: true, aiColor: 'white', currentPlayer: 'white' });
    await useGameStore.getState().runAnalysis({ force: true, maxTimeMs: ENGINE_MAX_TIME_MS });
    expect(lastBudget()).toBe(ENGINE_MAX_TIME_MS);
  });

  it('follows the turn: the human getting it back lifts the budget again', async () => {
    const { useGameStore } = await import('../src/store/gameStore');
    useGameStore.setState({ isAiPlaying: true, aiColor: 'white', currentPlayer: 'white' });
    await useGameStore.getState().runAnalysis({ force: true });
    expect(lastBudget()).toBe(MAX_TIME_SETTING_MS);

    // The bot plays and the human is to move in the new position.
    useGameStore.setState({ currentPlayer: 'black' });
    await useGameStore.getState().runAnalysis({ force: true });
    expect(lastBudget()).toBe(ENGINE_MAX_TIME_MS);
  });

  it('gives a fast review Max Time rather than a hidden short clock', async () => {
    const { useGameStore } = await import('../src/store/gameStore');
    useGameStore.getState().playMove(3, 3);
    useGameStore.getState().playMove(15, 15);
    analyzeMock.mockClear();

    useGameStore.getState().startFastGameAnalysis();
    for (let i = 0; i < 100 && analyzeMock.mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // It used to be `min(600, Max Time * 0.15)`, so a review set to 50000 visits
    // got whatever fit in 600 ms and reported it as the depth reached.
    expect(lastBudget()).toBe(MAX_TIME_SETTING_MS);
  });
});
