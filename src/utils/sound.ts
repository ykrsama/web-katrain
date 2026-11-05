import { publicUrl } from './publicUrl';

type SoundEffectKey = 'stone' | 'capture' | 'pass' | 'new-game';

const MIN_SOUND_INTERVAL_MS = 50;
const MAX_SOUND_DELAY_MS = 1000;
const SABAKI_SOUND_BASE_PATH = '/themes/sabaki/';
const STONE_SOUND_COUNT = 5;
const CAPTURE_SOUND_COUNT = 5;
const SOUND_FILES = [
    ...Array.from({ length: STONE_SOUND_COUNT }, (_, i) => `${i}.mp3`),
    ...Array.from({ length: CAPTURE_SOUND_COUNT }, (_, i) => `capture${i}.mp3`),
    'pass.mp3', 'newgame.mp3',
];

const lastSoundTimeByKey = new Map<SoundEffectKey, number>();
const buffers = new Map<string, AudioBuffer>();
const pendingBuffers = new Map<string, Promise<AudioBuffer>>();
let audioContext: AudioContext | null = null;
let fallbackAudio: HTMLAudioElement | null = null;
let nextStoneSoundIndex = 0;
let nextCaptureSoundIndex = 0;

const getSoundNow = (): number => (
    typeof performance !== 'undefined' ? performance.now() : Date.now()
);

const getAudioContext = (): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    try {
        if (audioContext && audioContext.state !== 'closed') return audioContext;
        const audioWindow = window as unknown as {
            AudioContext?: typeof AudioContext;
            webkitAudioContext?: typeof AudioContext;
        };
        const Context = audioWindow.AudioContext || audioWindow.webkitAudioContext;
        if (!Context) return null;
        audioContext = new Context();
        buffers.clear();
        pendingBuffers.clear();
        return audioContext;
    } catch {
        return null;
    }
};

const resumeContext = (context: AudioContext): Promise<void> => (
    context.state === 'running' ? Promise.resolve() : context.resume()
);

const loadSound = (context: AudioContext, fileName: string): Promise<AudioBuffer> => {
    const cached = buffers.get(fileName);
    if (cached) return Promise.resolve(cached);
    const pending = pendingBuffers.get(fileName);
    if (pending) return pending;
    const loading = fetch(publicUrl(`${SABAKI_SOUND_BASE_PATH}${fileName}`))
        .then((response) => {
            if (!response.ok) throw new Error(`Sound request failed: ${response.status}`);
            return response.arrayBuffer();
        })
        .then((data) => context.decodeAudioData(data))
        .then((buffer) => {
            if (audioContext === context) buffers.set(fileName, buffer);
            return buffer;
        })
        .finally(() => {
            // A transient download/decoder failure must not mute later moves.
            if (pendingBuffers.get(fileName) === loading) pendingBuffers.delete(fileName);
        });
    pendingBuffers.set(fileName, loading);
    return loading;
};

const startSound = (context: AudioContext, buffer: AudioBuffer): void => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
};

// Unlock one shared context during a user gesture. AI replies arrive later,
// outside that gesture, so creating a fresh media element for each reply can
// leave only the AI silent under per-element autoplay restrictions.
export const installSoundUnlockHandlers = (): (() => void) => {
    if (typeof window === 'undefined') return () => undefined;
    const unlock = () => {
        const context = getAudioContext();
        if (!context) return;
        if (context.state === 'running' && buffers.size === SOUND_FILES.length) return;
        try {
            void resumeContext(context).catch(() => undefined);
            const source = context.createBufferSource();
            source.buffer = context.createBuffer(1, 1, context.sampleRate);
            source.connect(context.destination);
            source.start();
            for (const fileName of SOUND_FILES) {
                void loadSound(context, fileName).catch(() => undefined);
            }
        } catch {
            // Retry on the next gesture, including after an OS interruption.
        }
    };
    const events = ['pointerdown', 'touchend', 'keydown'] as const;
    const target = window;
    for (const event of events) target.addEventListener(event, unlock, { capture: true, passive: true });
    return () => {
        for (const event of events) target.removeEventListener(event, unlock, { capture: true });
    };
};

const playFallback = (fileName: string): void => {
    try {
        if (typeof window === 'undefined' || !window.Audio) return;
        // Reuse the element enabled by a human move or the new-game click.
        fallbackAudio ??= new window.Audio();
        fallbackAudio.src = publicUrl(`${SABAKI_SOUND_BASE_PATH}${fileName}`);
        fallbackAudio.preload = 'auto';
        fallbackAudio.currentTime = 0;
        void fallbackAudio.play()?.catch(() => undefined);
    } catch {
        // Audio is optional; leave the next move free to retry silently.
    }
};

const playAudioFile = (key: SoundEffectKey, fileName: string): void => {
    const requestedAt = getSoundNow();
    const last = lastSoundTimeByKey.get(key);
    if (last !== undefined && requestedAt - last < MIN_SOUND_INTERVAL_MS) return;
    lastSoundTimeByKey.set(key, requestedAt);

    const context = getAudioContext();
    if (!context) {
        playFallback(fileName);
        return;
    }
    try {
        const cached = buffers.get(fileName);
        if (context.state === 'running' && cached) {
            // Schedule before store subscribers and React do the work of
            // displaying the move. A resolved Promise still defers this.
            startSound(context, cached);
            return;
        }
        // Invoke resume synchronously while a human move still has activation.
        void Promise.all([resumeContext(context), loadSound(context, fileName)])
            .then(([, buffer]) => {
                if (audioContext !== context || context.state !== 'running') return;
                // Do not replay old moves in a burst after a slow load/unlock.
                if (getSoundNow() - requestedAt > MAX_SOUND_DELAY_MS) return;
                startSound(context, buffer);
            })
            .catch(() => {
                if (audioContext === context && getSoundNow() - requestedAt <= MAX_SOUND_DELAY_MS) {
                    playFallback(fileName);
                }
            });
    } catch {
        playFallback(fileName);
    }
};

export const playStoneSound = (): void => {
    const fileName = `${nextStoneSoundIndex}.mp3`;
    nextStoneSoundIndex = (nextStoneSoundIndex + 1) % STONE_SOUND_COUNT;
    playAudioFile('stone', fileName);
};

export const playCaptureSound = (_count: number): void => {
    const fileName = `capture${nextCaptureSoundIndex}.mp3`;
    nextCaptureSoundIndex = (nextCaptureSoundIndex + 1) % CAPTURE_SOUND_COUNT;
    playAudioFile('capture', fileName);
};

export const playPassSound = (): void => playAudioFile('pass', 'pass.mp3');
export const playNewGameSound = (): void => playAudioFile('new-game', 'newgame.mp3');

export const resetAudioContextForTests = (): void => {
    if (audioContext) void audioContext.close().catch(() => undefined);
    audioContext = null;
    fallbackAudio = null;
    buffers.clear();
    pendingBuffers.clear();
    lastSoundTimeByKey.clear();
    nextStoneSoundIndex = 0;
    nextCaptureSoundIndex = 0;
};
