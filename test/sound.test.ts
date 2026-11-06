import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installSoundUnlockHandlers,
  playCaptureSound,
  playNewGameSound,
  playPassSound,
  playStoneSound,
  playNavigationSound,
  stopNavigationSounds,
  resetAudioContextForTests,
  warmAudioContext,
  NAVIGATION_INTERVAL_MS,
  NAVIGATION_ACTIVITY_MS,
} from '../src/utils/sound';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  resetAudioContextForTests();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const flushAudio = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function mockFallback() {
  const srcs: string[] = [];
  const instances: Array<{ onended: (() => void) | null }> = [];
  const play = vi.fn(() => Promise.resolve());
  const Audio = vi.fn(function () {
    const instance = {
      src: '', preload: '', currentTime: -1,
      onended: null as (() => void) | null,
      onerror: null as (() => void) | null,
      pause: vi.fn(),
      play() {
        srcs.push(this.src);
        return play();
      },
    };
    instances.push(instance);
    return instance;
  });
  vi.stubGlobal('window', { Audio });
  return { Audio, srcs, play, instances };
}

function mockWebAudio() {
  let canResume = true;
  let now = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const buffer = { duration: 0.1 } as AudioBuffer;
  const contexts: MockContext[] = [];
  class MockContext {
    state = 'suspended';
    currentTime = 10;
    sampleRate = 48000;
    destination = {};
    sources: Array<{ buffer: AudioBuffer | null; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; onended: (() => void) | null }> = [];
    resume = vi.fn(async () => {
      if (!canResume) throw new Error('User gesture required');
      this.state = 'running';
    });
    close = vi.fn(async () => { this.state = 'closed'; });
    decodeAudioData = vi.fn(async () => buffer);
    createBuffer = vi.fn(() => ({ duration: 0 }) as AudioBuffer);
    createBufferSource = vi.fn(() => {
      const source = { buffer: null as AudioBuffer | null, connect: vi.fn(), start: vi.fn(), onended: null as (() => void) | null };
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
    key: (type: 'keydown' | 'keyup') => target.dispatchEvent(Object.assign(new Event(type), { key: 'ArrowRight', code: 'ArrowRight' })),
    endClip: () => contexts.flatMap((context) => context.sources).filter((source) => source.buffer === buffer).at(-1)?.onended?.(),
    allowResume: (allowed: boolean) => { canResume = allowed; },
    advance: (ms = 100) => {
      now += ms;
      if (vi.isFakeTimers()) vi.advanceTimersByTime(ms);
    },
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
    vi.spyOn(Math, 'random').mockReturnValue(0);
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

  it('randomly selects stone and capture variants, allowing repeats', () => {
    const variants = [4, 1, 1, 0, 3, 2];
    const random = vi.spyOn(Math, 'random');
    for (const index of [...variants, ...variants]) random.mockReturnValueOnce((index + 0.5) / 5);
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now += 100);
    const { srcs } = mockFallback();
    for (let i = 0; i < 6; i++) playStoneSound();
    for (let i = 0; i < 6; i++) playCaptureSound(i + 1);
    expect(srcs).toEqual([
      ...variants.map((i) => `/themes/sabaki/${i}.mp3`),
      ...variants.map((i) => `/themes/sabaki/capture${i}.mp3`),
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
  it('starts warmed sounds synchronously before the move updates the game and UI', async () => {
    const audio = mockWebAudio();
    cleanups.push(installSoundUnlockHandlers());
    audio.gesture();
    await flushAudio();

    for (let i = 0; i < 5; i++) {
      audio.advance();
      playStoneSound();
      // No microtask flush: state subscribers/rendering can run immediately
      // after playStoneSound returns and must not hold up sound scheduling.
      expect(audio.audibleStarts()).toBe(i + 1);
    }
    expect(audio.fetchSound).toHaveBeenCalledTimes(12);
  });

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
    vi.spyOn(Math, 'random').mockReturnValue(0);
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

describe('forward-navigation sound cadence', () => {
  const inputLead = Math.min(NAVIGATION_INTERVAL_MS, NAVIGATION_ACTIVITY_MS) / 4;
  const quietPeriod = Math.max(NAVIGATION_INTERVAL_MS, NAVIGATION_ACTIVITY_MS) * 2;

  it('lets HTML audio tails overlap on the configured beat and keeps capture after its stone', () => {
    vi.useFakeTimers();
    const audio = mockFallback();
    vi.stubGlobal('window', Object.assign(new EventTarget(), { Audio: audio.Audio }));
    cleanups.push(installSoundUnlockHandlers());
    window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'ArrowRight', code: 'ArrowRight' }));
    vi.spyOn(Math, 'random').mockReturnValue(0);
    playNavigationSound('stone');
    vi.advanceTimersByTime(NAVIGATION_INTERVAL_MS - inputLead);
    playNavigationSound('capture');
    vi.advanceTimersByTime(inputLead - 1);
    expect(audio.srcs).toEqual(['/themes/sabaki/0.mp3']);
    vi.advanceTimersByTime(1);
    expect(audio.srcs).toEqual(['/themes/sabaki/0.mp3', '/themes/sabaki/0.mp3']);
    expect(audio.instances).toHaveLength(2); // First tail was never interrupted.
    window.dispatchEvent(Object.assign(new Event('keyup'), { key: 'ArrowRight', code: 'ArrowRight' }));
    vi.advanceTimersByTime(99);
    expect(audio.srcs).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(audio.srcs).toEqual(['/themes/sabaki/0.mp3', '/themes/sabaki/0.mp3', '/themes/sabaki/capture0.mp3']);
    vi.advanceTimersByTime(quietPeriod);
    expect(audio.srcs).toHaveLength(3);
  });

  it('schedules capture 100ms after placement without delaying the next beat', async () => {
    vi.useFakeTimers();
    const audio = mockWebAudio();
    cleanups.push(installSoundUnlockHandlers());
    audio.key('keydown');
    await flushAudio();
    playNavigationSound('capture');
    const parts = audio.contexts[0].sources.filter(source => (source.buffer?.duration ?? 0) > 0);
    expect(parts).toHaveLength(2);
    expect(parts[0].start).toHaveBeenCalledWith();
    expect(parts[1].start).toHaveBeenCalledWith(10.1);
    audio.advance(NAVIGATION_INTERVAL_MS - inputLead);
    playNavigationSound('stone');
    audio.advance(inputLead);
    // Neither original part has ended, but the next placement starts anyway.
    expect(audio.audibleStarts()).toBe(3);
    parts.forEach(part => part.onended?.());
    expect(audio.audibleStarts()).toBe(3);
  });

  it.each([0.5, 1.5])('keeps the configured beat with a sample lasting %s times the interval', async ratio => {
    vi.useFakeTimers();
    const audio = mockWebAudio();
    cleanups.push(installSoundUnlockHandlers());
    audio.key('keydown');
    await flushAudio();
    playNavigationSound();
    const first = audio.contexts[0].sources.at(-1)!;
    const duration = NAVIGATION_INTERVAL_MS * ratio;
    Object.defineProperty(first.buffer, 'duration', { value: duration / 1000 });
    audio.advance(NAVIGATION_INTERVAL_MS / 2);
    if (ratio < 1) first.onended?.();
    expect(audio.audibleStarts()).toBe(1);
    audio.advance(NAVIGATION_INTERVAL_MS / 2 - inputLead);
    playNavigationSound();
    audio.advance(inputLead - 1);
    expect(audio.audibleStarts()).toBe(1);
    audio.advance(1);
    expect(audio.audibleStarts()).toBe(2);
    audio.advance(NAVIGATION_INTERVAL_MS - inputLead);
    playNavigationSound();
    audio.advance(inputLead);
    expect(audio.audibleStarts()).toBe(3);
    // Sample duration and playback rate are left intact.
    expect(first.buffer?.duration).toBe(duration / 1000);
    audio.advance(quietPeriod);
    expect(audio.audibleStarts()).toBe(3);
  });

  it('keeps only the latest move kind at each beat instead of queuing every move', async () => {
    vi.useFakeTimers();
    const audio = mockWebAudio();
    cleanups.push(installSoundUnlockHandlers());
    audio.key('keydown');
    await flushAudio();
    playNavigationSound();
    audio.advance(NAVIGATION_INTERVAL_MS - 2 * inputLead);
    playNavigationSound('capture');
    audio.advance(inputLead);
    playNavigationSound('pass');
    audio.advance(inputLead);
    expect(audio.audibleStarts()).toBe(2); // Latest pass; no stale capture pair.
    audio.advance(quietPeriod);
    expect(audio.audibleStarts()).toBe(2);
  });

  it.each(['keyup', 'stop', 'blur'])('drops the pending beat on %s without cutting the current tail', async action => {
    vi.useFakeTimers();
    const audio = mockWebAudio();
    cleanups.push(installSoundUnlockHandlers());
    audio.key('keydown');
    await flushAudio();
    playNavigationSound();
    audio.advance(inputLead);
    playNavigationSound();
    if (action === 'keyup') audio.key('keyup');
    else if (action === 'stop') stopNavigationSounds();
    else audio.gesture('blur');
    audio.advance(quietPeriod);
    audio.endClip();
    expect(audio.audibleStarts()).toBe(1);
  });

  it('discards stale movement when a delayed beat finally runs', async () => {
    vi.useFakeTimers();
    const audio = mockWebAudio();
    cleanups.push(installSoundUnlockHandlers());
    audio.key('keydown');
    await flushAudio();
    playNavigationSound();
    audio.advance(inputLead);
    playNavigationSound();
    audio.advance(quietPeriod);
    expect(audio.audibleStarts()).toBe(1);
  });

  it('sounds a new key press immediately while the preceding press still has a tail', async () => {
    vi.useFakeTimers();
    const audio = mockWebAudio();
    cleanups.push(installSoundUnlockHandlers());
    audio.key('keydown');
    await flushAudio();
    playNavigationSound();
    audio.key('keyup');
    audio.advance(inputLead);
    audio.key('keydown');
    playNavigationSound();
    expect(audio.audibleStarts()).toBe(2);
    audio.advance(quietPeriod);
    expect(audio.audibleStarts()).toBe(2);
  });

  it('does not overlap or leave queued audio after rapid mouse clicks', async () => {
    const audio = mockWebAudio();
    cleanups.push(installSoundUnlockHandlers());
    audio.gesture();
    await flushAudio();
    for (let i = 0; i < 10; i++) playNavigationSound();
    expect(audio.audibleStarts()).toBe(1);
    audio.endClip();
    expect(audio.audibleStarts()).toBe(1);
    playNavigationSound();
    expect(audio.audibleStarts()).toBe(2);
  });

  it('does not play late-decoded navigation sounds after the key was released', async () => {
    const audio = mockWebAudio();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    audio.fetchSound.mockImplementation(async () => {
      await gate;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
    });
    cleanups.push(installSoundUnlockHandlers());
    audio.key('keydown');
    playNavigationSound();
    audio.key('keyup');
    release();
    await flushAudio();
    expect(audio.audibleStarts()).toBe(0);
  });

  it('serializes mouse navigation in the HTML fallback and reuses finished elements', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.9).mockReturnValueOnce(0.3);
    const audio = mockFallback();
    for (let i = 0; i < 10; i++) playNavigationSound();
    expect(audio.play).toHaveBeenCalledTimes(1);
    audio.instances[0].onended?.();
    expect(audio.play).toHaveBeenCalledTimes(1);
    playNavigationSound();
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(audio.srcs).toEqual(['/themes/sabaki/4.mp3', '/themes/sabaki/1.mp3']);
    expect(audio.Audio).toHaveBeenCalledTimes(1);
  });

  it('tolerates the delayed capture fallback failing to create an audio element', () => {
    vi.useFakeTimers();
    const audio = mockFallback();
    audio.Audio.mockImplementationOnce(audio.Audio.getMockImplementation()!);
    audio.Audio.mockImplementationOnce(function () { throw new Error('Audio unavailable'); });
    playNavigationSound('capture');
    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
  });
});

describe('warmAudioContext', () => {
  // Building the AudioContext is what made placing a first stone cost 85-100ms
  // of synchronous work and a 91ms long task; every later move cost 0.3ms.
  // Doing it from an idle callback moved the first move to 1.56ms and left no
  // long task at all.
  class CountingAudioContext {
    static constructed = 0;
    currentTime = 0;
    destination = {};
    state: AudioContextState = 'suspended';
    resume = () => Promise.resolve();
    close = () => Promise.resolve();
    constructor() {
      CountingAudioContext.constructed += 1;
    }
    createOscillator = () => ({
      connect: () => {},
      type: 'sine',
      frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      start: () => {},
      stop: () => {},
    });
    createGain = () => ({
      connect: () => {},
      gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
    });
  }

  const installAudio = () => {
    CountingAudioContext.constructed = 0;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { AudioContext: CountingAudioContext },
    });
  };

  it('builds the context once, and the first sound then reuses it', () => {
    installAudio();

    warmAudioContext();
    expect(CountingAudioContext.constructed).toBe(1);

    // The point of warming: the move that plays the first sound must not be
    // the one that constructs the device.
    warmAudioContext();
    playStoneSound();
    expect(CountingAudioContext.constructed).toBe(1);
  });

  it('stays harmless where there is no audio API at all', () => {
    Reflect.deleteProperty(globalThis, 'window');
    expect(() => warmAudioContext()).not.toThrow();
  });

  it('is only reached when sound is switched on', () => {
    // Nobody should have an audio device started for a feature they turned
    // off, so the caller carries the gate rather than this module.
    const layout = readFileSync('src/components/Layout.tsx', 'utf8');
    const call = layout.indexOf('warmAudioContext()');
    expect(call).toBeGreaterThan(-1);
    const effectStart = layout.lastIndexOf('useEffect(() => {', call);
    expect(layout.slice(effectStart, call)).toContain('settings.soundEnabled');
  });
});
