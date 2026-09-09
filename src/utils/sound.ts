type SoundEffectKey = 'stone' | 'capture' | 'pass' | 'new-game';

const MIN_SOUND_INTERVAL_MS = 50;
const HAPPY_STONES_SOUND_BASE_PATH = '/themes/happy-stones/';
const STONE_SOUND_COUNT = 5;
const CAPTURE_SOUND_COUNT = 5;

const lastSoundTimeByKey = new Map<SoundEffectKey, number>();
let nextStoneSoundIndex = 0;
let nextCaptureSoundIndex = 0;

export interface SoundInitError {
    message: string;
    backend: 'html-audio';
    platform: string;
}

let onSoundInitError: ((error: SoundInitError) => void) | null = null;
let soundFailureReported = false;

export const setSoundInitErrorHandler = (handler: ((error: SoundInitError) => void) | null): void => {
    onSoundInitError = handler;
};

export const resetSoundFailureReport = (): void => {
    soundFailureReported = false;
    lastSoundTimeByKey.clear();
};

const formatSoundError = (error: unknown): string => (
    error instanceof Error && error.message ? error.message : 'Unknown audio error'
);

const getPlatformLabel = (): string => {
    try {
        return typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
    } catch {
        return 'unknown';
    }
};

const reportSoundError = (message: string): void => {
    if (soundFailureReported) return;
    if (!onSoundInitError) return;
    soundFailureReported = true;
    onSoundInitError({
        message,
        backend: 'html-audio',
        platform: getPlatformLabel(),
    });
};

const getSoundNow = (): number => {
    try {
        return typeof performance !== 'undefined' ? performance.now() : Date.now();
    } catch {
        return Date.now();
    }
};

const shouldSkipRepeatedSound = (key: SoundEffectKey): boolean => {
    const now = getSoundNow();
    const last = lastSoundTimeByKey.get(key);
    if (last !== undefined && now - last < MIN_SOUND_INTERVAL_MS) return true;
    lastSoundTimeByKey.set(key, now);
    return false;
};

const getAudioConstructor = (): typeof Audio | null => {
    if (typeof window === 'undefined') return null; // Handle SSR/Test environment
    try {
        const audioWindow = window as unknown as { Audio?: typeof Audio };
        return audioWindow.Audio || null;
    } catch (error) {
        reportSoundError(`Browser audio API is blocked: ${formatSoundError(error)}`);
        return null;
    }
};

const playAudioFile = (key: SoundEffectKey, fileName: string): void => {
    if (shouldSkipRepeatedSound(key)) return;

    const AudioCtor = getAudioConstructor();
    if (!AudioCtor) {
        if (typeof window !== 'undefined') {
            reportSoundError('Browser audio API is not available.');
        }
        return;
    }

    try {
        const audio = new AudioCtor(`${HAPPY_STONES_SOUND_BASE_PATH}${fileName}`);
        audio.preload = 'auto';
        audio.currentTime = 0;
        const playResult = audio.play();
        if (playResult && typeof playResult.catch === 'function') {
            void playResult.catch((error: unknown) => {
                reportSoundError(`Could not play audio file ${fileName}: ${formatSoundError(error)}`);
            });
        }
    } catch (error) {
        reportSoundError(`Could not initialize audio file ${fileName}: ${formatSoundError(error)}`);
    }
};

const getNextStoneSoundFileName = (): string => {
    const fileName = `${nextStoneSoundIndex}.mp3`;
    nextStoneSoundIndex = (nextStoneSoundIndex + 1) % STONE_SOUND_COUNT;
    return fileName;
};

const getNextCaptureSoundFileName = (): string => {
    const fileName = `capture${nextCaptureSoundIndex}.mp3`;
    nextCaptureSoundIndex = (nextCaptureSoundIndex + 1) % CAPTURE_SOUND_COUNT;
    return fileName;
};

export const playStoneSound = () => {
    playAudioFile('stone', getNextStoneSoundFileName());
};

export const playCaptureSound = (_count: number) => {
    playAudioFile('capture', getNextCaptureSoundFileName());
};

export const playPassSound = () => {
    playAudioFile('pass', 'pass.mp3');
};

export const playNewGameSound = () => {
    playAudioFile('new-game', 'newgame.mp3');
};

export const resetAudioContextForTests = (): void => {
    onSoundInitError = null;
    soundFailureReported = false;
    lastSoundTimeByKey.clear();
    nextStoneSoundIndex = 0;
    nextCaptureSoundIndex = 0;
};
