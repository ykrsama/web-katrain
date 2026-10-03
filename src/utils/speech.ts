/**
 * Browser speech for the blindfold mode: Chinese announcements and one-shot
 * recognition, on top of the Web Speech API that Chrome and Edge ship.
 *
 * Two limits are worth knowing, and the UI says so instead of hiding them: the
 * recogniser always listens on the system default microphone and the
 * synthesiser always plays on the system default output. Neither API exposes
 * device choice, so there is nothing to pass a deviceId to.
 */

export const SPEECH_LANG = 'zh-CN';

type TranscriptAlternative = { transcript?: string };
type TranscriptResult = ArrayLike<TranscriptAlternative>;
type RecognitionEvent = { results?: ArrayLike<TranscriptResult> };
type RecognitionErrorEvent = { error?: string; message?: string };

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export const getSpeechRecognitionConstructor = (): SpeechRecognitionConstructor | null => {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
};

export const isSpeechRecognitionSupported = (): boolean => getSpeechRecognitionConstructor() !== null;

export const isSpeechSynthesisSupported = (): boolean =>
  typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';

export type ListenFailureReason =
  | 'unsupported'
  | 'no-speech'
  | 'not-allowed'
  | 'audio-capture'
  | 'network'
  | 'aborted'
  | 'timeout'
  | 'error';

export type ListenResult = { ok: true; transcript: string } | { ok: false; reason: ListenFailureReason; message?: string };

let activeRecognition: SpeechRecognitionLike | null = null;
let activeUtterance: SpeechSynthesisUtterance | null = null;

const detachRecognition = (recognition: SpeechRecognitionLike): void => {
  recognition.onresult = null;
  recognition.onerror = null;
  recognition.onend = null;
};

/** Drop a listening session without waiting for its events. */
export const cancelListening = (): void => {
  const recognition = activeRecognition;
  activeRecognition = null;
  if (!recognition) return;
  detachRecognition(recognition);
  try {
    recognition.abort();
  } catch {
    // Already stopped, or the engine refused: nothing to clean up.
  }
};

/** Stop any announcement that is still speaking. */
export const cancelSpeech = (): void => {
  if (isSpeechSynthesisSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // A blocked synthesiser has nothing to cancel.
    }
  }
  if (activeUtterance) {
    activeUtterance.onend = null;
    activeUtterance.onerror = null;
    activeUtterance = null;
  }
};

const pickChineseVoice = (): SpeechSynthesisVoice | null => {
  if (!isSpeechSynthesisSupported()) return null;
  try {
    const voices = window.speechSynthesis.getVoices();
    return voices.find((voice) => (voice.lang ?? '').toLowerCase().startsWith('zh')) ?? null;
  } catch {
    return null;
  }
};

/**
 * Say `text` and resolve when it finished (or was cancelled / failed). A stuck
 * utterance resolves false after a generous estimate so a caller's loop cannot
 * hang on it.
 */
export const speak = (text: string, opts?: { rate?: number; pitch?: number }): Promise<boolean> =>
  new Promise((resolve) => {
    if (!text || !isSpeechSynthesisSupported()) {
      resolve(false);
      return;
    }
    cancelSpeech();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = SPEECH_LANG;
    if (opts?.rate !== undefined) utterance.rate = opts.rate;
    if (opts?.pitch !== undefined) utterance.pitch = opts.pitch;
    const voice = pickChineseVoice();
    if (voice) utterance.voice = voice;
    activeUtterance = utterance;

    let settled = false;
    const finish = (spoken: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (activeUtterance === utterance) activeUtterance = null;
      resolve(spoken);
    };
    const timer = setTimeout(() => finish(false), Math.max(4000, text.length * 400));

    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      finish(false);
    }
  });

/**
 * Listen for one utterance and resolve with its transcript. Only one session
 * runs at a time; starting another cancels the previous one.
 */
export const listenOnce = (opts?: { timeoutMs?: number; lang?: string }): Promise<ListenResult> =>
  new Promise((resolve) => {
    const Ctor = getSpeechRecognitionConstructor();
    if (!Ctor) {
      resolve({ ok: false, reason: 'unsupported' });
      return;
    }
    cancelListening();

    let recognition: SpeechRecognitionLike;
    try {
      recognition = new Ctor();
    } catch (err) {
      resolve({ ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) });
      return;
    }
    activeRecognition = recognition;
    recognition.lang = opts?.lang ?? SPEECH_LANG;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    let settled = false;
    const finish = (result: ListenResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (activeRecognition === recognition) activeRecognition = null;
      detachRecognition(recognition);
      try {
        recognition.stop();
      } catch {
        // Already finished.
      }
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        recognition.abort();
      } catch {
        // Already finished.
      }
      finish({ ok: false, reason: 'timeout' });
    }, Math.max(2000, opts?.timeoutMs ?? 9000));

    recognition.onresult = (event) => {
      const transcript = (event.results?.[0]?.[0]?.transcript ?? '').trim();
      finish(transcript ? { ok: true, transcript } : { ok: false, reason: 'no-speech' });
    };
    recognition.onerror = (event) => {
      const code = event.error ?? 'error';
      const known: ListenFailureReason[] = ['no-speech', 'not-allowed', 'audio-capture', 'network', 'aborted'];
      const reason: ListenFailureReason = (known as string[]).includes(code)
        ? (code as ListenFailureReason)
        : 'error';
      finish({ ok: false, reason, message: event.message });
    };
    // Silence ends the session without a result; treat it as such rather than
    // letting the caller hang.
    recognition.onend = () => finish({ ok: false, reason: 'no-speech' });

    try {
      recognition.start();
    } catch (err) {
      finish({ ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  });
