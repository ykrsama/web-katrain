import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../src/store/gameStore';
import { KOMI } from '../src/types';
import { rulesOf } from '../src/utils/goRules';

const initial = useGameStore.getState();
afterEach(() => {
  vi.restoreAllMocks();
  useGameStore.setState(initial);
});

describe('game review choice', () => {
  it('waits for an explicit choice and forwards full-review settings', () => {
    const start = vi.fn();
    useGameStore.setState({ startFullGameAnalysis: start });
    const options = { visits: 500, moveRange: [2, 8] as [number, number], mistakesOnly: true };
    useGameStore.getState().requestFullGameAnalysis(options);
    expect(start).not.toHaveBeenCalled();
    expect(useGameStore.getState().pendingGameReview).toMatchObject({ kind: 'full', options });
    useGameStore.getState().chooseGameReviewMode(false);
    expect(start).toHaveBeenCalledWith({ ...options, reanalyzeExisting: false });
    expect(useGameStore.getState().pendingGameReview).toBeNull();
  });

  it('forwards a fresh-analysis choice and lets cancellation stop the request', () => {
    const start = vi.fn();
    useGameStore.setState({ startFastGameAnalysis: start });
    useGameStore.getState().requestFastGameAnalysis();
    useGameStore.getState().chooseGameReviewMode(null);
    expect(start).not.toHaveBeenCalled();
    useGameStore.getState().requestFastGameAnalysis();
    useGameStore.getState().chooseGameReviewMode(true);
    expect(start).toHaveBeenCalledWith({ reanalyzeExisting: true });
  });

  it('does not apply a pending choice to a replacement game', () => {
    const start = vi.fn();
    useGameStore.setState({ startQuickGameAnalysis: start });
    useGameStore.getState().requestQuickGameAnalysis();
    useGameStore.setState({ rootNode: { ...initial.rootNode, id: 'replacement-game' } });
    useGameStore.getState().chooseGameReviewMode(true);
    expect(start).not.toHaveBeenCalled();
  });
});

describe('Chinese-rule komi defaults', () => {
  it('defaults to seven points and preserves other rulesets', () => {
    expect(KOMI).toBe(7);
    expect(rulesOf('chinese').defaultKomi).toBe(7);
    expect(rulesOf('japanese').defaultKomi).toBe(6.5);
    expect(rulesOf('aga').defaultKomi).toBe(7.5);
  });
});
