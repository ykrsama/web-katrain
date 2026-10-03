/**
 * Browser speech for the blindfold mode: Chinese announcements and one-shot
 * recognition, on top of the Web Speech API that Chrome and Edge ship.
 *
 * Two limits are worth knowing, and the UI says so instead of hiding them: the
 * recogniser always listens on the system default microphone and the
 * synthesiser always plays on the system default output. Neither API exposes
 * device choice, so there is nothing to pass a deviceId to. The default device
 * can at least be *named* — `getUserMedia` reveals the label once the player has
 * allowed the microphone — and that is what `preflightMicrophone` is for.
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
  /** Fired once the recogniser is listening; the only proof it captures audio. */
  onstart: (() => void) | null;
  /** Fired when the capture device is ready, which may precede `onstart`. */
  onaudiostart: (() => void) | null;
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
  recognition.onstart = null;
  recognition.onaudiostart = null;
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
 *
 * `onReady` fires once, at the first sign that the recogniser is actually
 * capturing — it takes a moment to open the device, and anything said before
 * that moment is lost, so a caller that asks a human to speak wants to know
 * when it became true.
 */
export const listenOnce = (opts?: { timeoutMs?: number; lang?: string; onReady?: () => void }): Promise<ListenResult> =>
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
    let announcedReady = false;
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
    const noteReady = () => {
      if (settled || announcedReady) return;
      announcedReady = true;
      opts?.onReady?.();
    };
    const timer = setTimeout(() => {
      try {
        recognition.abort();
      } catch {
        // Already finished.
      }
      finish({ ok: false, reason: 'timeout' });
    }, Math.max(2000, opts?.timeoutMs ?? 9000));

    recognition.onstart = noteReady;
    recognition.onaudiostart = noteReady;
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

// --- Microphone state -------------------------------------------------------
//
// The recogniser reports its own state, but only once it has started and only
// through events that a caller waiting on a transcript cannot see in time. The
// players of the blindfold mode need to know *before* they speak, so the mode
// asks the microphone directly: the preflight below is what raises the browser's
// permission prompt, and it comes back with the device name and with the reason
// when there is no microphone to open.

export type MicrophonePermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/**
 * What the browser thinks of the microphone permission. Chrome answers for the
 * "microphone" name; Firefox and Safari leave the API or the name out, and there
 * the recogniser's own events are the only signal, so this says "unknown".
 */
export const queryMicrophonePermission = async (): Promise<MicrophonePermission> => {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    return status.state === 'granted' || status.state === 'denied' ? status.state : 'prompt';
  } catch {
    return 'unknown';
  }
};

export type MicrophoneFailure =
  | 'denied'
  | 'no-device'
  | 'busy'
  | 'insecure'
  | 'unsupported'
  /** The prompt is still open: not a failure, just not an answer yet. */
  | 'waiting'
  | 'error';

export type MicrophonePreflight =
  | { ok: true; deviceLabel: string | null }
  | { ok: false; failure: MicrophoneFailure };

/** How long to wait for the device before letting the caller carry on. */
const MICROPHONE_OPEN_TIMEOUT_MS = 10_000;

const microphoneFailureFromError = (err: unknown): MicrophoneFailure => {
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return 'no-device';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  return 'error';
};

/** The recogniser's failure codes in the microphone vocabulary above. */
export const microphoneFailureFromListen = (reason: ListenFailureReason): MicrophoneFailure => {
  if (reason === 'not-allowed') return 'denied';
  if (reason === 'audio-capture') return 'no-device';
  if (reason === 'unsupported') return 'unsupported';
  return 'error';
};

const releaseStream = (stream: MediaStream): void => {
  try {
    stream.getTracks().forEach((track) => track.stop());
  } catch {
    // A stream that is already gone has nothing to release.
  }
};

/**
 * Open the microphone once and hand it straight back. This is what makes the
 * browser ask for permission, and calling it while the player's click is still
 * the current task puts that prompt in front of them instead of in the middle of
 * their first answer. The recogniser opens its own capture afterwards; two of
 * them at once is exactly the sort of thing that goes wrong, hence the release.
 */
export const preflightMicrophone = async (): Promise<MicrophonePreflight> => {
  if (typeof navigator === 'undefined') return { ok: false, failure: 'unsupported' };
  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices?.getUserMedia) {
    // Without `mediaDevices` the page is usually on an insecure origin, which is
    // a different thing to tell the player than "this browser cannot".
    const insecure = typeof isSecureContext === 'boolean' && !isSecureContext;
    return { ok: false, failure: insecure ? 'insecure' : 'unsupported' };
  }

  let opening: Promise<MediaStream>;
  try {
    opening = mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    return { ok: false, failure: microphoneFailureFromError(err) };
  }
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    stream = await Promise.race([
      opening,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), MICROPHONE_OPEN_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    return { ok: false, failure: microphoneFailureFromError(err) };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }

  if (!stream) {
    // The prompt is still on screen. Let the caller carry on, but keep the
    // device from staying open if the player answers later.
    void opening.then(releaseStream).catch(() => undefined);
    return { ok: false, failure: 'waiting' };
  }

  const label = (stream.getAudioTracks()[0]?.label ?? '').trim();
  releaseStream(stream);
  return { ok: true, deviceLabel: label || null };
};
