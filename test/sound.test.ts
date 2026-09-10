import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  playCaptureSound,
  playNewGameSound,
  playPassSound,
  playStoneSound,
  resetAudioContextForTests,
  resetSoundFailureReport,
  setSoundInitErrorHandler,
} from '../src/utils/sound';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

function restoreWindow() {
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  resetAudioContextForTests();
  restoreWindow();
});

describe('sound helpers', () => {
  it('does nothing outside a browser window', () => {
    Reflect.deleteProperty(globalThis, 'window');

    expect(() => playStoneSound()).not.toThrow();
    expect(() => playCaptureSound(2)).not.toThrow();
    expect(() => playPassSound()).not.toThrow();
    expect(() => playNewGameSound()).not.toThrow();
  });

  it('plays the sabaki mp3 files', () => {
    const play = vi.fn(() => Promise.resolve());
    const audioInstances: Array<{ src: string; preload?: string; currentTime: number; play: typeof play }> = [];

    class MockAudio {
      preload?: string;
      currentTime = -1;
      play = play;
      src: string;
      constructor(src: string) {
        this.src = src;
        audioInstances.push(this);
      }
    }

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { Audio: MockAudio },
    });

    playStoneSound();
    playCaptureSound(2);
    playPassSound();
    playNewGameSound();

    expect(audioInstances.map((audio) => audio.src)).toEqual([
      '/themes/sabaki/0.mp3',
      '/themes/sabaki/capture0.mp3',
      '/themes/sabaki/pass.mp3',
      '/themes/sabaki/newgame.mp3',
    ]);
    expect(audioInstances.every((audio) => audio.preload === 'auto')).toBe(true);
    expect(audioInstances.every((audio) => audio.currentTime === 0)).toBe(true);
    expect(play).toHaveBeenCalledTimes(4);
  });

  it('cycles through stone and capture variants', () => {
    const play = vi.fn(() => Promise.resolve());
    const srcs: string[] = [];
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(160)
      .mockReturnValueOnce(220)
      .mockReturnValueOnce(280)
      .mockReturnValueOnce(340)
      .mockReturnValueOnce(400)
      .mockReturnValueOnce(460)
      .mockReturnValueOnce(520)
      .mockReturnValueOnce(580)
      .mockReturnValueOnce(640)
      .mockReturnValueOnce(700)
      .mockReturnValueOnce(760);

    class MockAudio {
      preload?: string;
      currentTime = 0;
      play = play;
      constructor(src: string) {
        srcs.push(src);
      }
    }

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { Audio: MockAudio },
    });

    for (let i = 0; i < 6; i++) playStoneSound();
    for (let i = 0; i < 6; i++) playCaptureSound(i + 1);

    expect(srcs).toEqual([
      '/themes/sabaki/0.mp3',
      '/themes/sabaki/1.mp3',
      '/themes/sabaki/2.mp3',
      '/themes/sabaki/3.mp3',
      '/themes/sabaki/4.mp3',
      '/themes/sabaki/0.mp3',
      '/themes/sabaki/capture0.mp3',
      '/themes/sabaki/capture1.mp3',
      '/themes/sabaki/capture2.mp3',
      '/themes/sabaki/capture3.mp3',
      '/themes/sabaki/capture4.mp3',
      '/themes/sabaki/capture0.mp3',
    ]);
  });

  it('swallows blocked Audio construction', () => {
    class BlockedAudio {
      constructor() {
        throw new Error('audio blocked');
      }
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { Audio: BlockedAudio },
    });

    expect(() => playStoneSound()).not.toThrow();
  });

  it('reports blocked Audio construction once', () => {
    const handler = vi.fn();
    setSoundInitErrorHandler(handler);

    class BlockedAudio {
      constructor() {
        throw new Error('audio blocked');
      }
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { Audio: BlockedAudio },
    });

    expect(() => playStoneSound()).not.toThrow();
    expect(() => playPassSound()).not.toThrow();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'html-audio',
      message: 'Could not initialize audio file 0.mp3: audio blocked',
      platform: expect.any(String),
    }));
  });

  it('can report again after sound is re-enabled for a retry', () => {
    const handler = vi.fn();
    setSoundInitErrorHandler(handler);

    class BlockedAudio {
      constructor() {
        throw new Error('audio blocked');
      }
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { Audio: BlockedAudio },
    });

    playStoneSound();
    playPassSound();
    resetSoundFailureReport();
    playNewGameSound();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('swallows blocked Audio accessor reads', () => {
    const blockedWindow = {};
    Object.defineProperty(blockedWindow, 'Audio', {
      configurable: true,
      get() {
        throw new Error('audio accessor blocked');
      },
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: blockedWindow,
    });

    expect(() => playStoneSound()).not.toThrow();
  });

  it('debounces rapid repeats of the same sound effect', () => {
    const play = vi.fn(() => Promise.resolve());
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(120).mockReturnValueOnce(160);

    class MockAudio {
      preload?: string;
      currentTime = 0;
      play = play;
      src: string;
      constructor(src: string) {
        this.src = src;
      }
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { Audio: MockAudio },
    });

    playStoneSound();
    playStoneSound();
    playStoneSound();

    expect(play).toHaveBeenCalledTimes(2);
  });

  it('reports rejected audio playback', async () => {
    const handler = vi.fn();
    setSoundInitErrorHandler(handler);

    class MockAudio {
      preload?: string;
      currentTime = 0;
      play = () => Promise.reject(new Error('play blocked'));
      src: string;
      constructor(src: string) {
        this.src = src;
      }
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { Audio: MockAudio },
    });

    expect(() => playPassSound()).not.toThrow();
    await Promise.resolve();

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'html-audio',
      message: 'Could not play audio file pass.mp3: play blocked',
    }));
  });
});
