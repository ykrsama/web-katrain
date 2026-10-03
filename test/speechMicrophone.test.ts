import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listenOnce,
  microphoneFailureFromListen,
  preflightMicrophone,
  queryMicrophonePermission,
} from '../src/utils/speech';

/** The parts of a captured stream the preflight touches. */
const fakeStream = (label = 'Built-in Microphone') => {
  const track = { label, stop: vi.fn() };
  return { track, stream: { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream };
};

const failingMicrophone = (name: string) => {
  const error = new Error('the browser said no');
  error.name = name;
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => {
        throw error;
      },
    },
  });
};

class FakeRecognition {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  start(): void {
    this.onstart?.();
    this.onaudiostart?.();
  }
  stop(): void {}
  abort(): void {}
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('microphone state', () => {
  it('reports what the browser says about the permission', async () => {
    for (const state of ['granted', 'prompt', 'denied'] as const) {
      vi.stubGlobal('navigator', { permissions: { query: async () => ({ state }) } });
      await expect(queryMicrophonePermission()).resolves.toBe(state);
    }
  });

  it('says it does not know where the browser will not answer', async () => {
    // Firefox and Safari: the name is not part of the API and the call rejects.
    vi.stubGlobal('navigator', {
      permissions: {
        query: async () => {
          throw new TypeError('microphone is not a valid permission name');
        },
      },
    });
    await expect(queryMicrophonePermission()).resolves.toBe('unknown');
    // Safari has no Permissions API at all.
    vi.stubGlobal('navigator', {});
    await expect(queryMicrophonePermission()).resolves.toBe('unknown');
  });

  it('names the default device and hands it straight back', async () => {
    const { track, stream } = fakeStream();
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

    await expect(preflightMicrophone()).resolves.toEqual({ ok: true, deviceLabel: 'Built-in Microphone' });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    // The recogniser opens its own capture; two at once is what goes wrong.
    expect(track.stop).toHaveBeenCalled();
  });

  it('tells the player which way the microphone failed', async () => {
    failingMicrophone('NotAllowedError');
    await expect(preflightMicrophone()).resolves.toEqual({ ok: false, failure: 'denied' });
    failingMicrophone('NotFoundError');
    await expect(preflightMicrophone()).resolves.toEqual({ ok: false, failure: 'no-device' });
    failingMicrophone('NotReadableError');
    await expect(preflightMicrophone()).resolves.toEqual({ ok: false, failure: 'busy' });
    failingMicrophone('SomethingElse');
    await expect(preflightMicrophone()).resolves.toEqual({ ok: false, failure: 'error' });
  });

  it('explains a page that cannot reach the microphone API at all', async () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', {});
    await expect(preflightMicrophone()).resolves.toEqual({ ok: false, failure: 'unsupported' });
    // Media capture simply does not exist off a secure origin.
    vi.stubGlobal('isSecureContext', false);
    await expect(preflightMicrophone()).resolves.toEqual({ ok: false, failure: 'insecure' });
  });

  it('translates the recogniser failure codes', () => {
    expect(microphoneFailureFromListen('not-allowed')).toBe('denied');
    expect(microphoneFailureFromListen('audio-capture')).toBe('no-device');
    expect(microphoneFailureFromListen('unsupported')).toBe('unsupported');
    expect(microphoneFailureFromListen('network')).toBe('error');
  });

  it('reports the recogniser as capturing once, at its first event', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { SpeechRecognition: FakeRecognition });
    const onReady = vi.fn();

    const pending = listenOnce({ timeoutMs: 2000, onReady });
    // Both `start` and `audiostart` fire; only the first one is news.
    await vi.advanceTimersByTimeAsync(0);
    expect(onReady).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2500);
    await expect(pending).resolves.toEqual({ ok: false, reason: 'timeout' });
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
