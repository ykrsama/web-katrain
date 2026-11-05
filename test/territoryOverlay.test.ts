import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisResult } from '../src/types';

const analyze = vi.fn();
vi.mock('../src/engine/katago/client', () => ({
  getKataGoEngineClient: () => ({
    analyze,
    getEngineInfo: () => ({ backend: 'test', modelName: 'test', backendNote: null }),
  }),
  isKataGoCanceledError: () => false,
}));

const { useGameStore } = await import('../src/store/gameStore');
const { analysisQueue } = await import('../src/utils/analysisQueue');
const settings = useGameStore.getInitialState().settings;
const savedReview = (): AnalysisResult => ({
  rootWinRate: 0.9, rootScoreLead: 12, rootVisits: 50000,
  moves: [], policy: Array(362).fill(0.1), territory: [], ownershipMode: 'none',
});

beforeEach(() => {
  analysisQueue.cancelWhere(() => true);
  analysisQueue.clearCache();
  useGameStore.getState().resetGame();
  useGameStore.setState({
    isAnalysisMode: false, isContinuousAnalysis: false, isAiPlaying: false,
    analysisData: null,
    settings: { ...settings, engineMode: 'local', analysisShowOwnership: true, katagoOwnershipMode: 'tree' },
  });
  analyze.mockReset();
  analyze.mockResolvedValue({
    rootWinRate: 0.4, rootScoreLead: -3, rootVisits: 25, moves: [],
    ownership: new Float32Array(361).fill(0.75),
  });
});
afterEach(() => {
  analysisQueue.cancelWhere(() => true);
  analysisQueue.clearCache();
  vi.restoreAllMocks();
});

describe('territory overlay data', () => {
  it('fetches missing territory without enabling live analysis or changing engine preferences', async () => {
    await useGameStore.getState().runAnalysis({ ownershipOnly: true });
    const state = useGameStore.getState();
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({ ownershipMode: 'root', visits: 25 }));
    expect(state.analysisData?.territory[0][0]).toBe(0.75);
    expect(state.analysisData?.ownershipMode).toBe('root');
    expect(state.isAnalysisMode).toBe(false);
    expect(state.settings.katagoOwnershipMode).toBe('tree');
  });

  it('fills a fast review without replacing its deeper win rate, score, policy or requested depth', async () => {
    const node = useGameStore.getState().currentNode;
    const review = savedReview();
    node.analysis = review;
    node.analysisVisitsRequested = 50000;
    await useGameStore.getState().runAnalysis({ ownershipOnly: true });
    expect(node.analysis).toMatchObject({
      rootVisits: 50000, rootWinRate: 0.9, rootScoreLead: 12, ownershipMode: 'root',
    });
    expect(node.analysis?.policy).toBe(review.policy);
    expect(node.analysis?.moves).toBe(review.moves);
    expect(node.analysisVisitsRequested).toBe(50000);
    expect(node.analysis?.territory[0][0]).toBe(0.75);
  });

  it('also fills ownership from a shallower live result instead of discarding it', async () => {
    const node = useGameStore.getState().currentNode;
    node.analysis = savedReview();
    useGameStore.setState({ isAnalysisMode: true });
    await useGameStore.getState().runAnalysis({ visits: 25 });
    expect(node.analysis?.rootVisits).toBe(50000);
    expect(node.analysis?.territory[0][0]).toBe(0.75);
    expect(node.analysis?.ownershipMode).toBe('root');
  });

  it('reuses complete territory, including a legitimately neutral all-zero grid', async () => {
    const node = useGameStore.getState().currentNode;
    node.analysis = {
      ...savedReview(), ownershipMode: 'root',
      territory: Array.from({ length: 19 }, () => Array(19).fill(0)),
    };
    await useGameStore.getState().runAnalysis({ ownershipOnly: true });
    expect(analyze).not.toHaveBeenCalled();
  });

  it('does not fetch when territory is disabled', async () => {
    useGameStore.setState((s) => ({ settings: { ...s.settings, analysisShowOwnership: false } }));
    await useGameStore.getState().runAnalysis({ ownershipOnly: true });
    expect(analyze).not.toHaveBeenCalled();
  });

  it('refreshes blank maps saved by the old remote client when Territory is explicitly enabled', async () => {
    const node = useGameStore.getState().currentNode;
    node.analysis = { ...savedReview(), ownershipMode: 'root',
      territory: Array.from({ length: 19 }, () => Array(19).fill(0)) };
    useGameStore.setState((s) => ({ settings: { ...s.settings, analysisShowOwnership: false } }));
    useGameStore.getState().updateSettings({ analysisShowOwnership: true });
    expect(node.analysis?.ownershipMode).toBe('none');
    await useGameStore.getState().runAnalysis({ ownershipOnly: true });
    expect(node.analysis?.territory[0][0]).toBe(0.75);
    expect(node.analysis?.rootVisits).toBe(50000);
  });

  it('does not mistake a throttled progress placeholder for completed ownership', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(10000);
    useGameStore.setState((s) => ({
      isAnalysisMode: true,
      settings: { ...s.settings, analysisShowOwnership: false },
    }));
    analyze.mockImplementationOnce(async (args) => {
      const result = { rootWinRate: 0.4, rootScoreLead: -3, rootVisits: 25, moves: [],
        ownership: new Float32Array(361).fill(0.75) };
      args.onProgress?.({ ...result, ownership: new Float32Array(361) });
      expect(useGameStore.getState().currentNode.analysis?.ownershipMode).toBe('none');
      return result;
    });
    await useGameStore.getState().runAnalysis({ visits: 25 });
    expect(useGameStore.getState().currentNode.analysis?.territory[0][0]).toBe(0.75);
    expect(useGameStore.getState().currentNode.analysis?.ownershipMode).toBe('root');
  });

  it('fetches ownership for the newly selected position instead of reusing the previous board', async () => {
    await useGameStore.getState().runAnalysis({ ownershipOnly: true });
    const parent = useGameStore.getState().currentNode;
    useGameStore.getState().playMove(3, 3);
    analyze.mockResolvedValueOnce({
      rootWinRate: 0.4, rootScoreLead: -3, rootVisits: 25, moves: [],
      ownership: new Float32Array(361).fill(-0.5),
    });
    await useGameStore.getState().runAnalysis({ ownershipOnly: true });
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(useGameStore.getState().analysisData?.territory[0][0]).toBe(-0.5);
    expect(parent.analysis?.territory[0][0]).toBe(0.75);
  });
});
