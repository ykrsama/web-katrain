import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisResult, CandidateMove } from '../src/types';

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
  moveHistory: Array<{ x: number; y: number; player: string }>;
  regionOfInterest?: unknown;
  currentPlayer: string;
};

const candidate = (x: number, y: number, order: number): CandidateMove => ({
  x,
  y,
  order,
  winRate: 0.5,
  scoreLead: 0,
  visits: 250,
  pointsLost: 0,
});

const analysisWith = (moves: CandidateMove[]): AnalysisResult => ({
  rootWinRate: 0.5,
  rootScoreLead: 0,
  rootVisits: 500,
  moves,
  territory: Array.from({ length: 19 }, () => Array(19).fill(0)),
});

const reply = (x: number, y: number, order: number) => ({
  x,
  y,
  order,
  winRate: 0.5,
  scoreLead: 0,
  visits: 25,
  pointsLost: 0,
});

/**
 * A fake engine whose answers depend on which candidate the scan is reading.
 *
 * The scan reads two positions per candidate of the current node: the position
 * after the candidate (its `moveHistory` is still the node's own, and it asks
 * for the replies) and, for each reply, the position after that reply (one more
 * move in the history). The replies carry different coordinates per candidate,
 * so the reply values identify the candidate without looking at the board.
 */
const installEngine = (baseHistoryLength: number) => {
  analyzeMock.mockImplementation(async (args: AnalyzeArgs) => {
    const next = args.nextMove;
    if (!next) throw new Error('savage scan asked for a position with no move');
    if (args.moveHistory.length === baseHistoryLength) {
      // Position after one of the current node's candidates: answer with the
      // opponent's replies. Candidate (3,3) will be savage, (15,15) will not.
      const replies = next.x === 3 ? [reply(10, 10, 0), reply(11, 11, 1)] : [reply(12, 12, 0), reply(13, 13, 1)];
      return { rootWinRate: 0.5, rootScoreLead: 0, rootVisits: 25, moves: replies, ownership: [] };
    }
    // Position after one of those replies: a black-perspective score. The bad
    // answers raise Black's lead; the good ones leave it alone.
    const value = next.x === 11 ? 5 : next.x === 13 ? 2 : 0;
    return { rootWinRate: 0.5, rootScoreLead: value, rootVisits: 25, moves: [], ownership: [] };
  });
};

const flush = async () => {
  for (let i = 0; i < 200; i++) {
    if (!(await import('../src/store/gameStore')).useGameStore.getState().isSavageScanRunning) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('savage scan did not finish');
};

describe('find savage moves', () => {
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
      regionOfInterest: null,
      isSavageScanRunning: false,
      savageMoves: null,
      notification: null,
    });
  });

  it('marks the candidate that leaves the opponent one reply that holds', async () => {
    const { useGameStore } = await import('../src/store/gameStore');
    const node = useGameStore.getState().currentNode;
    const before = analysisWith([candidate(3, 3, 0), candidate(15, 15, 1)]);
    node.analysis = before;
    installEngine(node.gameState.moveHistory.length);

    useGameStore.getState().findSavageMoves();
    await flush();

    const state = useGameStore.getState();
    expect(state.savageMoves).toEqual({ nodeId: node.id, marks: [{ x: 3, y: 3, secondLoss: 5 }] });
    expect(state.savageScanDone).toBe(2);
    expect(state.savageScanTotal).toBe(2);
    expect(state.notification?.message).toBe('Savage moves: 1.');
    // The scan analyses positions that were never played: it must not rewrite
    // the node, which still carries the live analysis.
    expect(node.analysis).toBe(before);
    // One reply read per candidate plus one equalizing read per reply.
    expect(analyzeMock).toHaveBeenCalledTimes(2 + 4);
  });

  it('only tests the candidates inside the framed region', async () => {
    const { useGameStore } = await import('../src/store/gameStore');
    const node = useGameStore.getState().currentNode;
    node.analysis = analysisWith([candidate(3, 3, 0), candidate(15, 15, 1)]);
    installEngine(node.gameState.moveHistory.length);
    // A corner box around (3,3): the far candidate is outside it.
    useGameStore.setState({ regionOfInterest: { xMin: 0, yMin: 0, xMax: 5, yMax: 5 } });

    useGameStore.getState().findSavageMoves();
    await flush();

    expect(useGameStore.getState().savageMoves?.marks).toEqual([{ x: 3, y: 3, secondLoss: 5 }]);
    // Only (3,3) was read: its reply query plus the two reply values.
    expect(analyzeMock).toHaveBeenCalledTimes(3);
    // The framed region restricts the reader's own candidates, not the
    // opponent's answers: the follow-up reads are unrestricted.
    for (const call of analyzeMock.mock.calls) {
      expect((call[0] as AnalyzeArgs).regionOfInterest ?? null).toBeNull();
    }
  });
});

describe('savage-move UI wiring', () => {
  it('puts the control next to the play-elsewhere read and draws its marks on the board', () => {
    const row = readFileSync('src/components/TenukiRow.tsx', 'utf8');
    expect(row).toContain('findSavageMoves');
    expect(row).toContain('summarizeSavageRow');

    const board = readFileSync('src/components/GoBoard.tsx', 'utf8');
    expect(board).toContain('savageCanvasRef');
    expect(board).toContain('savageMoves?.nodeId === currentNode.id');
    expect(board).toContain('data-savage-move-count');
  });
});
