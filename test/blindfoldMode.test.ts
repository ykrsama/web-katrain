import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateMove } from '../src/types';

const analyzeMock = vi.fn();
const speakMock = vi.fn(async (_text: string): Promise<boolean> => true);
const listenMock = vi.fn(
  async (_opts?: { timeoutMs?: number }): Promise<{ ok: true; transcript: string } | { ok: false; reason: string }> => ({
    ok: false,
    reason: 'no-speech',
  })
);
const cancelListeningMock = vi.fn();
const cancelSpeechMock = vi.fn();

vi.mock('../src/engine/katago/client', () => ({
  getKataGoEngineClient: () => ({
    analyze: analyzeMock,
    evaluate: vi.fn(),
    evaluateBatch: vi.fn(),
    getEngineInfo: () => ({ backend: 'test', modelName: 'test-model', backendNote: null }),
  }),
  isKataGoCanceledError: () => false,
}));

vi.mock('../src/utils/speech', () => ({
  speak: speakMock,
  listenOnce: listenMock,
  cancelListening: cancelListeningMock,
  cancelSpeech: cancelSpeechMock,
  isSpeechRecognitionSupported: () => true,
  isSpeechSynthesisSupported: () => true,
}));

const aiMove = (x: number, y: number): CandidateMove => ({
  x,
  y,
  winRate: 0.5,
  scoreLead: 0,
  visits: 16,
  pointsLost: 0,
  order: 0,
  prior: 1,
});

const waitFor = async (predicate: () => boolean, tries = 400): Promise<void> => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for the store');
};

describe('blindfold mode', () => {
  beforeEach(async () => {
    analyzeMock.mockReset();
    speakMock.mockClear();
    listenMock.mockReset();
    cancelListeningMock.mockClear();
    cancelSpeechMock.mockClear();
    analyzeMock.mockResolvedValue({
      rootWinRate: 0.5,
      rootScoreLead: 0,
      rootScoreSelfplay: 0,
      rootScoreStdev: 0,
      rootVisits: 16,
      moves: [aiMove(15, 15)],
      ownership: new Float32Array(19 * 19),
      ownershipStdev: new Float32Array(19 * 19),
      policy: new Float32Array(19 * 19 + 1),
    });
    const { analysisQueue } = await import('../src/utils/analysisQueue');
    analysisQueue.cancelWhere(() => true, 'test reset');
    analysisQueue.clearCache();
    const { useGameStore } = await import('../src/store/gameStore');
    useGameStore.getState().resetGame();
    useGameStore.setState({ isContinuousAnalysis: false, isAnalysisMode: false, notification: null });
  });

  it('announces the engine move, plays what it hears, and shows the point it read', async () => {
    // In x-y mode (3, 2) on 19x19 is the 4th column from the left and the 17th
    // row from the bottom, i.e. "四之十七".
    listenMock.mockResolvedValue({ ok: true, transcript: '四之十七' });
    const { useGameStore } = await import('../src/store/gameStore');

    useGameStore.getState().startBlindfold({ aiColor: 'black', announce: 'xy' });
    expect(useGameStore.getState().blindfold).toMatchObject({ aiColor: 'black', announce: 'xy' });
    expect(useGameStore.getState().isAiPlaying).toBe(true);
    expect(useGameStore.getState().aiColor).toBe('black');

    // The engine plays (15, 15): 16th column, 4th row from the bottom.
    await waitFor(() => useGameStore.getState().currentNode.move?.player === 'black');
    // The player answers, and their move lands on the board.
    await waitFor(() => useGameStore.getState().currentNode.move?.player === 'white');

    const playerNode = useGameStore.getState().currentNode;
    expect(playerNode.move).toMatchObject({ x: 3, y: 2, player: 'white' });
    // The board area shows the newest point of the round: first what the engine
    // announced, then what the answer was read as.
    expect(useGameStore.getState().blindfold?.lastPoint).toEqual({ text: '四之十七', from: 'player' });
    // Only the engine's move is spoken. The player's point is shown, not said
    // back, so it must not appear among the announcements.
    const spoken = speakMock.mock.calls.map((call) => call[0]);
    expect(spoken).toContain('十六之四');
    expect(spoken).not.toContain('四之十七');

    useGameStore.getState().stopBlindfold();
    expect(useGameStore.getState().blindfold).toBeNull();
    expect(useGameStore.getState().isAiPlaying).toBe(false);
    expect(useGameStore.getState().aiColor).toBeNull();
  });

  it('shows the engine move in the board area while it waits for an answer', async () => {
    // The microphone never answers on its own, so the state the player sits in
    // can be inspected: the board is covered, and the engine's point is the one
    // thing it has to show.
    const pending: { release: () => void } = { release: () => undefined };
    listenMock.mockImplementation(
      () => new Promise((resolve) => {
        pending.release = () => resolve({ ok: false, reason: 'aborted' });
      })
    );
    const { useGameStore } = await import('../src/store/gameStore');

    useGameStore.getState().startBlindfold({ aiColor: 'black', announce: 'xy' });
    // (15, 15) on 19x19 is the 16th column from the left and the 4th row from
    // the bottom.
    await waitFor(() => useGameStore.getState().blindfold?.lastPoint?.text === '十六之四');
    expect(useGameStore.getState().blindfold?.lastPoint).toEqual({ text: '十六之四', from: 'engine' });

    useGameStore.getState().stopBlindfold();
    pending.release();
    expect(useGameStore.getState().blindfold).toBeNull();
  });

  it('says "听不清楚" and listens again when the answer is not a point', async () => {
    listenMock.mockResolvedValue({ ok: true, transcript: '随便说点什么' });
    const { useGameStore } = await import('../src/store/gameStore');

    useGameStore.getState().startBlindfold({ aiColor: 'black', announce: 'xy' });
    await waitFor(() => speakMock.mock.calls.some((call) => call[0] === '听不清楚'));

    expect(listenMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Nothing was played for it: the engine is still waiting on the player.
    expect(useGameStore.getState().currentNode.move?.player).toBe('black');

    useGameStore.getState().stopBlindfold();
    expect(cancelListeningMock).toHaveBeenCalled();
  });
});
