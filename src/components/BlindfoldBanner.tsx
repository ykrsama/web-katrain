import React from 'react';
import { FaAssistiveListeningSystems, FaStop, FaPlay } from 'react-icons/fa';
import { useGameStore } from '../store/gameStore';
import { useT } from '../i18n';

/**
 * The blindfold mode's only handle on screen: it is on while the board is
 * hidden, so it has to say what the mode is doing and offer the way out.
 */
export const BlindfoldBanner: React.FC = () => {
  const t = useT();
  const blindfold = useGameStore((state) => state.blindfold);
  const stopBlindfold = useGameStore((state) => state.stopBlindfold);
  const resumeBlindfold = useGameStore((state) => state.resumeBlindfold);

  if (!blindfold) return null;

  const paused = blindfold.phase === 'paused' || blindfold.phase === 'error';
  const status =
    blindfold.phase === 'ai-thinking'
      ? t('Engine is thinking…')
      : blindfold.phase === 'listening'
        ? t('Listening for your move…')
        : blindfold.phase === 'confirming'
          ? t('Speaking the point back…')
          : t('Waiting');
  // A recognized move is shown on its own and stays until the next answer is
  // being listened for: the raw transcript next to it only made the one thing
  // worth reading harder to find. Pauses and errors still speak for themselves.
  const detail = !paused && blindfold.confirmedPoint
    ? t('Read as {point}', { point: blindfold.confirmedPoint })
    : blindfold.message ?? status;

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
        <span className={blindfold.confirmedPoint ? 'font-medium text-[var(--ui-text)]' : 'text-[var(--ui-text-muted)]'}>
          {detail}
        </span>
        {blindfold.transcript && !blindfold.confirmedPoint ? (
          <span className="rounded-full bg-[var(--ui-surface-2)] px-2 py-0.5 text-xs text-[var(--ui-text-muted)]">
            {t('Heard: {text}', { text: blindfold.transcript })}
          </span>
        ) : null}
        {paused ? (
          <button
            type="button"
            onClick={resumeBlindfold}
            className="inline-flex min-h-9 items-center gap-2 whitespace-nowrap rounded-full border border-[var(--ui-border)] px-3 py-1 text-xs text-[var(--ui-text)] hover:bg-[var(--ui-surface-2)]"
          >
            <FaPlay aria-hidden="true" />
            {t('Keep listening')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={stopBlindfold}
          className="inline-flex min-h-9 items-center gap-2 whitespace-nowrap rounded-full border border-[var(--ui-border)] px-3 py-1 text-xs text-[var(--ui-danger,#e53e3e)] hover:bg-[var(--ui-surface-2)]"
        >
          <FaStop aria-hidden="true" />
          {t('Leave blindfold mode')}
        </button>
      </div>
    </div>
  );
};
