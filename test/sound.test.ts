import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installSoundUnlockHandlers,
  playCaptureSound,
  playNewGameSound,
  playPassSound,
  playStoneSound,
  resetAudioContextForTests,
} from '../src/utils/sound';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  resetAudioContextForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const flushAudio = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function mockFallback() {
  const srcs: string[] = [];
  const play = vi.fn(() => Promise.resolve());
  const Audio = vi.fn(function () {
    return {
      src: '', preload: '', currentTime: -1,
      play() {
        srcs.push(this.src);
        return play();
      },
    };
  });
  vi.stubGlobal('window', { Audio });
  return { Audio, srcs, play };
}

function mockWebAudio() {
  let canResume = true;
  let now = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const buffer = { duration: 0.1 } as AudioBuffer;
  const contexts: MockContext[] = [];
  class MockContext {
    state = 'suspended';
    sampleRate = 48000;
    destination = {};
    sources: Array<{ buffer: AudioBuffer | null; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> }> = [];
    resume = vi.fn(async () => {
      if (!canResume) throw new Error('User gesture required');
      this.state = 'running';
    });
    close = vi.fn(async () => { this.state = 'closed'; });
    decodeAudioData = vi.fn(async () => buffer);
    createBuffer = vi.fn(() => ({ duration: 0 }) as AudioBuffer);
    createBufferSource = vi.fn(() => {
      const source = { buffer: null as AudioBuffer | null, connect: vi.fn(), start: vi.fn() };
      this.sources.push(source);
      return source;
    });
    constructor() { contexts.push(this); }
  }
  const fetchSound = vi.fn(async (_url: string) => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
  const AudioContext = vi.fn(function () { return new MockContext(); });
  const target = Object.assign(new EventTarget(), { AudioContext });
  vi.stubGlobal('window', target);
  vi.stubGlobal('fetch', fetchSound);
  return {
    target, contexts, fetchSound, AudioContext,
    gesture: (type = 'pointerdown') => target.dispatchEvent(new Event(type)),
    allowResume: (allowed: boolean) => { canResume = allowed; },
    advance: () => { now += 100; },
    audibleStarts: () => contexts.flatMap((context) => context.sources)
      .filter((source) => source.buffer === buffer && source.start.mock.calls.length > 0).length,
  };
}

describe('sound playback', () => {
  it('does nothing outside a browser window', () => {
    vi.stubGlobal('window', undefined);
    expect(() => {
      playStoneSound(); playCaptureSound(2); playPassSound(); playNewGameSound();
      cleanups.push(installSoundUnlockHandlers());
    }).not.toThrow();
  });

  it('uses the GitHub Pages base for every fallback sound and reuses one media element', () => {
    vi.stubEnv('BASE_URL', '/web-katrain/');
    const { Audio, srcs } = mockFallback();
    playStoneSound(); playCaptureSound(2); playPassSound(); playNewGameSound();
    expect(srcs).toEqual([
      '/web-katrain/themes/sabaki/0.mp3',
      '/web-katrain/themes/sabaki/capture0.mp3',
      '/web-katrain/themes/sabaki/pass.mp3',
      '/web-katrain/themes/sabaki/newgame.mp3',
    ]);
    expect(Audio).toHaveBeenCalledTimes(1);
  });

  it('cycles through stone and capture variants', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now += 100);
    const { srcs } = mockFallback();
    for (let i = 0; i < 6; i++) playStoneSound();
    for (let i = 0; i < 6; i++) playCaptureSound(i + 1);
    expect(srcs).toEqual([
      ...[0, 1, 2, 3, 4, 0].map((i) => `/themes/sabaki/${i}.mp3`),
      ...[0, 1, 2, 3, 4, 0].map((i) => `/themes/sabaki/capture${i}.mp3`),
    ]);
  });

  it('silently tolerates blocked audio APIs', () => {
    const blockedWindow = {};
    for (const name of ['Audio', 'AudioContext']) {
      Object.defineProperty(blockedWindow, name, { get() { throw new Error('Audio blocked'); } });
    }
    vi.stubGlobal('window', blockedWindow);
    expect(() => playStoneSound()).not.toThrow();
  });

  it('retries after rejected playback without disabling later sounds', async () => {
    const { play, Audio } = mockFallback();
    play.mockRejectedValueOnce(new Error('Playback blocked'));
    playStoneSound();
    await flushAudio();
    playPassSound();
    await flushAudio();
    expect(play).toHaveBeenCalledTimes(2);
    expect(Audio).toHaveBeenCalledTimes(1);
  });

  it('debounces rapid repeats of the same sound effect', () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(120).mockReturnValueOnce(160);
    const { play } = mockFallback();
    playStoneSound(); playStoneSound(); playStoneSound();
    expect(play).toHaveBeenCalledTimes(2);
  });
});

describe('AI sound activation and recovery', () => {
  it('preloads deployed MP3s in a gesture and plays later AI replies on the same context', async () => {
    vi.stubEnv('BASE_URL', '/web-katrain/');
    const audio = mockWebAudio();
    cleanups.push(installSoundUnlockHandlers());
    audio.gesture();
    await flushAudio();
    playNewGameSound();
    await flushAudio();
    // The AI replies outside the gesture, followed by human and AI moves.
    audio.allowResume(false);
    for (let i = 0; i < 4; i++) {
      audio.advance();
      await Promise.resolve();
      playStoneSound();
      await flushAudio();
    }
    expect(audio.AudioContext).toHaveBeenCalledTimes(1);
    expect(audio.audibleStarts()).toBe(5);
    expect(audio.fetchSound).toHaveBeenCalledTimes(12);
    expect(audio.fetchSound.mock.calls.map(([url]) => url)).toContain('/web-katrain/themes/sabaki/0.mp3');
  });

  it('recovers AI sound after the first move was blocked and the human interacts', async () => {
    const audio = mockWebAudio();
    audio.allowResume(false);
    cleanups.push(installSoundUnlockHandlers());
    playStoneSound();
    await flushAudio();
    expect(audio.audibleStarts()).toBe(0);

    audio.allowResume(true);
    audio.gesture();
    await flushAudio();
    audio.advance();
    playStoneSound(); // Human move.
    await flushAudio();
    audio.allowResume(false);
    audio.advance();
    playStoneSound(); // AI reply, without a fresh gesture.
    await flushAudio();
    expect(audio.audibleStarts()).toBe(2);
    expect(audio.AudioContext).toHaveBeenCalledTimes(1);
  });

  it('resumes an interrupted context on the next touch or keyboard gesture', async () => {
    const audio = mockWebAudio();
    cleanups.push(installSoundUnlockHandlers());
    audio.gesture('touchend');
    await flushAudio();
    const context = audio.contexts[0];
    context.state = 'interrupted';
    audio.gesture('keydown');
    await flushAudio();
    playStoneSound();
    await flushAudio();
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(audio.audibleStarts()).toBe(1);
  });

  it('retries a failed preload instead of caching the failure for later moves', async () => {
    const audio = mockWebAudio();
    audio.fetchSound.mockRejectedValueOnce(new Error('Transient network error'));
    cleanups.push(installSoundUnlockHandlers());
    audio.gesture();
    await flushAudio();
    playStoneSound();
    await flushAudio();
    expect(audio.fetchSound).toHaveBeenCalledTimes(13);
    expect(audio.audibleStarts()).toBe(1);
  });

  it('recreates a closed context instead of leaving the next game silent', async () => {
    const audio = mockWebAudio();
    cleanups.push(installSoundUnlockHandlers());
    audio.gesture();
    await flushAudio();
    audio.contexts[0].state = 'closed';
    audio.gesture();
    await flushAudio();
    playStoneSound();
    await flushAudio();
    expect(audio.AudioContext).toHaveBeenCalledTimes(2);
    expect(audio.audibleStarts()).toBe(1);
  });

  it('removes gesture listeners when sound is disabled or the layout unmounts', () => {
    const audio = mockWebAudio();
    const cleanup = installSoundUnlockHandlers();
    cleanup();
    audio.gesture(); audio.gesture('touchend'); audio.gesture('keydown');
    expect(audio.AudioContext).not.toHaveBeenCalled();
  });
});
