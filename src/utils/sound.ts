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
type NavigationSound = 'stone' | 'capture' | 'pass';
type NavigationClip = { started: boolean; finished: boolean; captureTimer?: ReturnType<typeof setTimeout> };
const NAVIGATION_INTERVAL_MS = 160;
const NAVIGATION_ACTIVITY_MS = 160;
const heldKeys = new Set<string>();
const navigationClips = new Set<NavigationClip>();
const activeNavigationAudio = new Set<HTMLAudioElement>();
const idleNavigationAudio: HTMLAudioElement[] = [];
let navigationClip: NavigationClip | null = null;
let navigationBeatTimer: ReturnType<typeof setTimeout> | null = null;
let pendingNavigationSound: NavigationSound | null = null;
let lastNavigationAt = -Infinity;

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

const startSound = (context: AudioContext, buffer: AudioBuffer, onEnded?: () => void, delaySeconds = 0): void => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    if (onEnded) source.onended = onEnded;
    if (delaySeconds > 0) source.start(context.currentTime + delaySeconds);
    else source.start();
};

/** Prepare the shared audio context before the first move. */
export const warmAudioContext = (): void => {
    getAudioContext();
};

/** Let the current clip finish, but drop every unstarted navigation sound. */
export const stopNavigationSounds = (): void => {
    pendingNavigationSound = null;
    lastNavigationAt = -Infinity;
    if (navigationBeatTimer !== null) clearTimeout(navigationBeatTimer);
    navigationBeatTimer = null;
    if (navigationClip && (!navigationClip.started || navigationClip.finished)) navigationClip = null;
};

/** Held-key onsets follow a fixed beat; original sample tails may overlap. */
export const playNavigationSound = (kind: NavigationSound = 'stone'): void => {
    if (typeof window === 'undefined') return;
    lastNavigationAt = getSoundNow();
    if (navigationClip && !(heldKeys.size > 0 && navigationClip.started && navigationBeatTimer === null)) {
        // Mouse clicks that arrive during playback are simply coalesced. They
        // must not leave a sound waiting after the user has stopped clicking.
        pendingNavigationSound = heldKeys.size > 0 ? kind : null;
        return;
    }
    const clip: NavigationClip = { started: false, finished: false };
    navigationClip = clip;
    navigationClips.add(clip);
    const fileNames = [kind === 'pass' ? 'pass.mp3' : `${Math.floor(Math.random() * STONE_SOUND_COUNT)}.mp3`];
    if (kind === 'capture') fileNames.push(`capture${Math.floor(Math.random() * CAPTURE_SOUND_COUNT)}.mp3`);
    const canStart = () => navigationClip === clip && getSoundNow() - lastNavigationAt <= MAX_SOUND_DELAY_MS;
    const finish = () => {
        clip.finished = true;
        navigationClips.delete(clip);
        if (navigationClip !== clip) return;
        // Short samples must not advance the beat; long samples must not hold it.
        if (navigationBeatTimer !== null) return;
        navigationClip = null;
    };
    const startBeat = () => {
        if (heldKeys.size === 0) return;
        navigationBeatTimer = setTimeout(() => {
            navigationBeatTimer = null;
            if (navigationClip !== clip) return;
            navigationClip = null;
            const next = pendingNavigationSound;
            pendingNavigationSound = null;
            if (next && heldKeys.size > 0 && getSoundNow() - lastNavigationAt <= NAVIGATION_ACTIVITY_MS) {
                playNavigationSound(next);
            }
        }, NAVIGATION_INTERVAL_MS);
    };
    // Both parts belong to the started move, even after key release. Their
    // completion only gates mouse navigation; neither part gates the key beat.
    const ended = new Set<number>();
    const partEnded = (index: number) => {
        ended.add(index);
        if (ended.size === fileNames.length) finish();
    };
    const fallback = () => {
        if (!canStart()) { finish(); return; }
        try {
            if (!window.Audio) { finish(); return; }
            const playPart = (index: number) => {
                let audio: HTMLAudioElement;
                try { audio = idleNavigationAudio.pop() ?? new window.Audio(); }
                catch { partEnded(index); return; }
                activeNavigationAudio.add(audio);
                let released = false;
                const release = () => {
                    if (released) return;
                    released = true;
                    audio.onended = audio.onerror = null;
                    activeNavigationAudio.delete(audio);
                    idleNavigationAudio.push(audio);
                    partEnded(index);
                };
                try {
                    audio.src = publicUrl(`${SABAKI_SOUND_BASE_PATH}${fileNames[index]!}`);
                    audio.onended = audio.onerror = release;
                    void audio.play()?.catch(release);
                }
                catch { release(); }
            };
            clip.started = true;
            startBeat();
            playPart(0);
            if (fileNames.length > 1) {
                clip.captureTimer = setTimeout(() => {
                    playPart(1);
                }, 100);
            }
        } catch { finish(); }
    };
    const context = getAudioContext();
    if (!context) { fallback(); return; }
    const start = (clipBuffers: AudioBuffer[]) => {
        if (!canStart() || audioContext !== context || context.state !== 'running') { finish(); return; }
        clip.started = true;
        startBeat();
        clipBuffers.forEach((buffer, index) => startSound(context, buffer, () => partEnded(index), index * 0.1));
    };
    try {
        const cached = fileNames.map(fileName => buffers.get(fileName));
        if (context.state === 'running' && cached.every((buffer): buffer is AudioBuffer => !!buffer)) start(cached);
        else void Promise.all([resumeContext(context), Promise.all(fileNames.map(fileName => loadSound(context, fileName)))])
            .then(([, clipBuffers]) => start(clipBuffers)).catch(fallback);
    } catch { fallback(); }
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
    const target = window;
    const keyDown = (event: KeyboardEvent) => {
        const key = event.code || event.key;
        if (key && !['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) heldKeys.add(key);
        unlock();
    };
    const keyUp = (event: KeyboardEvent) => {
        heldKeys.delete(event.code || event.key);
        stopNavigationSounds();
    };
    const blur = () => { heldKeys.clear(); stopNavigationSounds(); };
    for (const event of ['pointerdown', 'touchend'] as const) {
        target.addEventListener(event, unlock, { capture: true, passive: true });
    }
    target.addEventListener('keydown', keyDown, { capture: true });
    target.addEventListener('keyup', keyUp, { capture: true });
    target.addEventListener('blur', blur);
    return () => {
        for (const event of ['pointerdown', 'touchend'] as const) target.removeEventListener(event, unlock, { capture: true });
        target.removeEventListener('keydown', keyDown, { capture: true });
        target.removeEventListener('keyup', keyUp, { capture: true });
        target.removeEventListener('blur', blur);
        blur();
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
    const fileName = `${Math.floor(Math.random() * STONE_SOUND_COUNT)}.mp3`;
    playAudioFile('stone', fileName);
};

export const playCaptureSound = (_count: number): void => {
    const fileName = `capture${Math.floor(Math.random() * CAPTURE_SOUND_COUNT)}.mp3`;
    playAudioFile('capture', fileName);
};

export const playPassSound = (): void => playAudioFile('pass', 'pass.mp3');
export const playNewGameSound = (): void => playAudioFile('new-game', 'newgame.mp3');

export const resetAudioContextForTests = (): void => {
    stopNavigationSounds();
    for (const clip of navigationClips) {
        if (clip.captureTimer !== undefined) clearTimeout(clip.captureTimer);
    }
    navigationClips.clear();
    navigationClip = null;
    pendingNavigationSound = null;
    lastNavigationAt = -Infinity;
    heldKeys.clear();
    for (const audio of [...activeNavigationAudio, ...idleNavigationAudio]) {
        audio.onended = audio.onerror = null;
        audio.pause();
    }
    activeNavigationAudio.clear();
    idleNavigationAudio.length = 0;
    if (audioContext) void audioContext.close().catch(() => undefined);
    audioContext = null;
    fallbackAudio = null;
    buffers.clear();
    pendingBuffers.clear();
    lastSoundTimeByKey.clear();
};
