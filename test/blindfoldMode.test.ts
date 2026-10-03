import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateMove } from '../src/types';

const analyzeMock = vi.fn();
const speakMock = vi.fn(async (_text: string): Promise<boolean> => true);
const listenMock = vi.fn(
  async (_opts?: {
    timeoutMs?: number;
    onReady?: () => void;
  }): Promise<{ ok: true; transcript: string } | { ok: false; reason: string }> => ({
    ok: false,
    reason: 'no-speech',
  })
);
const cancelListeningMock = vi.fn();
const cancelSpeechMock = vi.fn();
type PreflightResult = { ok: true; deviceLabel: string | null } | { ok: false; failure: string };
const preflightMock = vi.fn(
  async (): Promise<PreflightResult> => ({ ok: true, deviceLabel: 'Test microphone' })
);
const permissionMock = vi.fn(async (): Promise<string> => 'granted');

vi.mock('../src/engine/katago/client', () => ({
  getKataGoEngineClient: () => ({
    analyze: analyzeMock,
    evaluate: vi.fn(),
    evaluateBatch: vi.fn(),
    getEngineInfo: () => ({ backend: 'test', modelName: 'test-model', backendNote: null }),
  }),
  isKataGoCanceledError: () => false,
}));

vi.mock('../src/utils/speech', async (importOriginal) => {
  // The failure vocabulary mapper is real logic, not a browser call, so the mock
  // keeps it and only replaces the two APIs that reach the microphone.
  const actual = await importOriginal<typeof import('../src/utils/speech')>();
  return {
    ...actual,
    speak: speakMock,
    listenOnce: listenMock,
    cancelListening: cancelListeningMock,
    cancelSpeech: cancelSpeechMock,
    preflightMicrophone: preflightMock,
    queryMicrophonePermission: permissionMock,
    isSpeechRecognitionSupported: () => true,
    isSpeechSynthesisSupported: () => true,
  };
});

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
    preflightMock.mockReset();
    preflightMock.mockResolvedValue({ ok: true, deviceLabel: 'Test microphone' });
    permissionMock.mockReset();
    permissionMock.mockResolvedValue('granted');
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
    expect(useGameStore.getState().blindfold?.lastPoint).toEqual({
      text: '四之十七',
      shape: '小目',
      from: 'player',
    });
    // Only the engine's move is spoken. The player's point is shown, not said
    // back, so it must not appear among the announcements.
    const spoken = speakMock.mock.calls.map((call) => call[0]);
    // The coordinate comes with the name of the shape the move made, from the
    // shape coach: (15, 15) on an empty board is the 4-4 point, i.e. 星位.
    expect(spoken).toContain('十六之四，星位');
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
    expect(useGameStore.getState().blindfold?.lastPoint).toEqual({
      text: '十六之四',
      shape: '星位',
      from: 'engine',
    });

    useGameStore.getState().stopBlindfold();
    pending.release();
    expect(useGameStore.getState().blindfold).toBeNull();
  });

  it('says "听不清楚" and keeps listening, however many times it misses', async () => {
    // More misses than the mode used to allow before it gave up and asked the
    // player to press "继续听" again.
    let attempts = 0;
    listenMock.mockImplementation(async () => {
      attempts += 1;
      return attempts <= 5
        ? { ok: true, transcript: '随便说点什么' }
        : { ok: true, transcript: '四之十七' };
    });
    const { useGameStore } = await import('../src/store/gameStore');

    useGameStore.getState().startBlindfold({ aiColor: 'black', announce: 'xy' });
    // The sixth answer is finally a point, so the mode plays it: the retries
    // never stopped and never paused.
    await waitFor(() => useGameStore.getState().currentNode.move?.player === 'white');
    expect(useGameStore.getState().currentNode.move).toMatchObject({ x: 3, y: 2 });

    const spoken = speakMock.mock.calls.map((call) => call[0]);
    expect(spoken.filter((text) => text === '听不清楚').length).toBeGreaterThanOrEqual(5);
    expect(useGameStore.getState().blindfold?.phase).not.toBe('paused');

    useGameStore.getState().stopBlindfold();
    expect(cancelListeningMock).toHaveBeenCalled();
  });

  it('holds the turn prompt back until the recogniser is actually capturing', async () => {
    // Opening a microphone takes a moment, and whatever is said before it is open
    // is lost, so the mode has to say where it is rather than asking for a point.
    const mic: { report: () => void; release: () => void } = { report: () => undefined, release: () => undefined };
    listenMock.mockImplementation(
      (opts?: { onReady?: () => void }) => new Promise((resolve) => {
        mic.report = () => opts?.onReady?.();
        mic.release = () => resolve({ ok: false, reason: 'aborted' });
      })
    );
    const { useGameStore } = await import('../src/store/gameStore');

    useGameStore.getState().startBlindfold({ aiColor: 'black', announce: 'xy' });
    expect(useGameStore.getState().blindfold?.mic.status).toBe('checking');

    // The device opened, but the recogniser has not started: this is the window
    // the player has to be told to wait in.
    await waitFor(() => {
      const session = useGameStore.getState().blindfold;
      return session?.phase === 'listening' && session.mic.status === 'starting';
    });
    expect(useGameStore.getState().blindfold?.message).toBeNull();

    mic.report();
    await waitFor(() => useGameStore.getState().blindfold?.mic.status === 'ready');
    expect(useGameStore.getState().blindfold?.message).toContain('请说坐标');

    useGameStore.getState().stopBlindfold();
    mic.release();
  });

  it('reports a refused microphone and waits for the player to fix it', async () => {
    preflightMock.mockResolvedValue({ ok: false, failure: 'denied' });
    listenMock.mockResolvedValue({ ok: false, reason: 'not-allowed' });
    const { useGameStore } = await import('../src/store/gameStore');

    useGameStore.getState().startBlindfold({ aiColor: 'black', announce: 'xy' });
    await waitFor(() => useGameStore.getState().blindfold?.phase === 'error');

    expect(useGameStore.getState().blindfold?.mic).toMatchObject({ status: 'blocked', failure: 'denied' });
    expect(useGameStore.getState().blindfold?.message).toContain('麦克风不可用');

    // One attempt only: asking again into a closed microphone just makes noise.
    const attempts = listenMock.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(listenMock.mock.calls.length).toBe(attempts);

    useGameStore.getState().stopBlindfold();
  });
});
