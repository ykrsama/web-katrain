import { beforeEach, describe, expect, it, vi } from 'vitest';
const sounds = vi.hoisted(() => ({
  playStoneSound: vi.fn(), playCaptureSound: vi.fn(), playPassSound: vi.fn(),
  playNewGameSound: vi.fn(), playNavigationSound: vi.fn(), stopNavigationSounds: vi.fn(),
}));
vi.mock('../src/utils/sound', () => sounds);
import { useGameStore } from '../src/store/gameStore';
import { parseSgf } from '../src/utils/sgf';

beforeEach(() => {
  useGameStore.getState().resetGame();
  useGameStore.setState((state) => ({
    isAnalysisMode: false, isAiPlaying: false, isContinuousAnalysis: false,
    settings: { ...state.settings, soundEnabled: true, loadSgfFastAnalysis: false },
  }));
  useGameStore.getState().loadGame(parseSgf('(;SZ[9];B[aa];W[bb];B[cc];W[])'));
  useGameStore.getState().navigateStart();
  vi.clearAllMocks();
});

describe('forward navigation sounds from the game store', () => {
  it('sounds keyboard/button forward navigation, but not backward navigation', () => {
    useGameStore.getState().navigateForward();
    expect(sounds.playNavigationSound).toHaveBeenCalledExactlyOnceWith('stone');
    useGameStore.getState().navigateBack();
    expect(sounds.playNavigationSound).toHaveBeenCalledTimes(1);
    expect(sounds.stopNavigationSounds).toHaveBeenCalled();
  });

  it('sounds a mouse selection of a later tree node once, regardless of skipped moves', () => {
    const third = useGameStore.getState().rootNode.children[0].children[0].children[0];
    useGameStore.getState().jumpToNode(third);
    expect(sounds.playNavigationSound).toHaveBeenCalledExactlyOnceWith('stone');
    useGameStore.getState().jumpToNode(third.parent!);
    expect(sounds.playNavigationSound).toHaveBeenCalledTimes(1);
  });

  it('also sounds move-number navigation and stops at the end of the line', () => {
    useGameStore.getState().navigateToMove(3);
    expect(sounds.playNavigationSound).toHaveBeenCalledExactlyOnceWith('stone');
    useGameStore.getState().navigateEnd();
    expect(sounds.playNavigationSound).toHaveBeenLastCalledWith('pass');
    sounds.stopNavigationSounds.mockClear();
    useGameStore.getState().navigateForward();
    expect(sounds.stopNavigationSounds).toHaveBeenCalled();
  });

  it('does not duplicate sounds for an actual new move or replaying a recorded move on the board', () => {
    useGameStore.getState().playMove(0, 0);
    expect(sounds.playStoneSound).toHaveBeenCalledTimes(1);
    expect(sounds.playNavigationSound).not.toHaveBeenCalled();
    useGameStore.getState().playMove(2, 0);
    expect(sounds.playStoneSound).toHaveBeenCalledTimes(2);
    expect(sounds.playNavigationSound).not.toHaveBeenCalled();
  });

  it('respects mute and does not sound a game being loaded', () => {
    useGameStore.setState((s) => ({ settings: { ...s.settings, soundEnabled: false } }));
    useGameStore.getState().navigateForward();
    expect(sounds.playNavigationSound).not.toHaveBeenCalled();
    useGameStore.getState().loadGame(parseSgf('(;SZ[9];B[dd];W[ee])'));
    expect(sounds.playNavigationSound).not.toHaveBeenCalled();
  });
});
