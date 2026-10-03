import React from 'react';
import { FaAssistiveListeningSystems, FaStop, FaPlay, FaMicrophone } from 'react-icons/fa';
import { useGameStore } from '../store/gameStore';
import { useT } from '../i18n';
import type { BlindfoldMic, BlindfoldSession } from '../utils/blindfold';

interface BlindfoldBannerViewProps {
  session: BlindfoldSession;
  onResume: () => void;
  onLeave: () => void;
}

/**
 * The blindfold banner's markup, with the session handed in: the store-connected
 * wrapper below is the only part that has to know where the state comes from,
 * which keeps this renderable in a test.
 */
export const BlindfoldBannerView: React.FC<BlindfoldBannerViewProps> = ({ session, onResume, onLeave }) => {
  const t = useT();

  const paused = session.phase === 'paused' || session.phase === 'error';
  // 'confirming' has nothing to say: the mode stopped reading the point back out
  // loud, so the line would only describe something that does not happen.
  const status =
    session.phase === 'ai-thinking'
      ? t('Engine is thinking…')
      : session.phase === 'listening'
        ? t('Listening for your move…')
        : session.phase === 'confirming'
          ? ''
          : t('Waiting');

  const micFailureText = (failure: BlindfoldMic['failure']): string => {
    if (failure === 'denied') return t('permission refused');
    if (failure === 'no-device') return t('no microphone found');
    if (failure === 'busy') return t('the device is busy in another app');
    if (failure === 'insecure') return t('needs HTTPS or localhost');
    if (failure === 'unsupported') return t('this browser cannot open it');
    if (failure === 'waiting') return t('still opening');
    return t('it did not open');
  };
  // The line is only there while the microphone is a problem. Once it is open
  // the mode has nothing to add, and "已就绪" every turn is just noise.
  const micText =
    session.mic.status === 'starting'
      ? t('Microphone: starting…')
      : session.mic.status === 'permission'
        ? t('Microphone: waiting for permission')
        : session.mic.status === 'blocked'
          ? t('Microphone: {state}', { state: micFailureText(session.mic.failure) })
          : t('Microphone: checking…');

  // The player cannot answer until the recogniser is capturing: anything said
  // while it opens is lost, so the "your turn" prompt waits for it and the
  // microphone line speaks for the mode in the meantime.
  const micPending = session.phase === 'listening' && session.mic.status !== 'ready';
  // The banner reports the state of the turn, the board area shows the newest
  // point, and the point is never repeated here: once an answer has been read
  // the mode moves on to the engine, and the turn status says so.
  const detail = micPending ? null : session.message ?? status;
  // A transcript is only worth showing when the mode could not use it; after a
  // point is read the board area already shows what was heard.
  const unreadTranscript = session.lastPoint?.from === 'player' ? null : session.transcript;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-3 z-[60] flex justify-center px-3"
      data-blindfold-banner="true"
    >
      <div className="ui-panel pointer-events-auto flex max-w-[min(92vw,42rem)] flex-wrap items-center gap-3 rounded-full border px-4 py-2 text-sm shadow-xl">
        <span className="flex items-center gap-2 font-medium text-[var(--ui-text)]">
          <FaAssistiveListeningSystems className="text-[var(--ui-accent)]" aria-hidden="true" />
          {t('Blindfold mode')}
        </span>
        {session.mic.status !== 'ready' ? (
          <span
            className={`flex items-center gap-1.5 ${
              session.mic.status === 'blocked' ? 'text-[var(--ui-danger,#e53e3e)]' : 'text-[var(--ui-accent)]'
            }`}
            data-blindfold-mic={session.mic.status}
            data-blindfold-mic-failure={session.mic.failure ?? undefined}
          >
            <FaMicrophone aria-hidden="true" />
            {micText}
          </span>
        ) : null}
        {detail ? <span className="text-[var(--ui-text-muted)]">{detail}</span> : null}
        {unreadTranscript ? (
          <span className="rounded-full bg-[var(--ui-surface-2)] px-2 py-0.5 text-xs text-[var(--ui-text-muted)]">
            {t('Heard: {text}', { text: unreadTranscript })}
          </span>
        ) : null}
        {paused ? (
          <button
            type="button"
            onClick={onResume}
            className="inline-flex min-h-9 items-center gap-2 whitespace-nowrap rounded-full border border-[var(--ui-border)] px-3 py-1 text-xs text-[var(--ui-text)] hover:bg-[var(--ui-surface-2)]"
          >
            <FaPlay aria-hidden="true" />
            {t('Keep listening')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onLeave}
          className="inline-flex min-h-9 items-center gap-2 whitespace-nowrap rounded-full border border-[var(--ui-border)] px-3 py-1 text-xs text-[var(--ui-danger,#e53e3e)] hover:bg-[var(--ui-surface-2)]"
        >
          <FaStop aria-hidden="true" />
          {t('Leave blindfold mode')}
        </button>
      </div>
    </div>
  );
};

/**
 * The blindfold mode's only handle on screen: it is on while the board is
 * hidden, so it has to say what the mode is doing, whether the microphone is
 * open yet, and offer the way out.
 */
export const BlindfoldBanner: React.FC = () => {
  const blindfold = useGameStore((state) => state.blindfold);
  const stopBlindfold = useGameStore((state) => state.stopBlindfold);
  const resumeBlindfold = useGameStore((state) => state.resumeBlindfold);

  if (!blindfold) return null;

  return <BlindfoldBannerView session={blindfold} onResume={resumeBlindfold} onLeave={stopBlindfold} />;
};
