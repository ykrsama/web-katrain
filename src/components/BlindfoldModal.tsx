import React, { useState } from 'react';
import { FaTimes, FaAssistiveListeningSystems, FaVolumeUp } from 'react-icons/fa';
import { useGameStore } from '../store/gameStore';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { useInitialDialogFocus } from '../hooks/useInitialDialogFocus';
import { useT } from '../i18n';
import { blindfoldExample, type BlindfoldAnnounceMode } from '../utils/blindfold';
import { isSpeechRecognitionSupported, isSpeechSynthesisSupported, speak } from '../utils/speech';
import type { Player } from '../types';

interface BlindfoldModalProps {
  onClose: () => void;
}

const optionClass = (active: boolean): string =>
  [
    'flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
    active
      ? 'border-[var(--ui-accent)] bg-[var(--ui-surface-2)] text-[var(--ui-text)]'
      : 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-surface-2)]',
  ].join(' ');

/**
 * Setup for the blindfold (盲棋) mode: who the engine plays, and how the
 * coordinates are read out. Device pickers are deliberately absent — the Web
 * Speech APIs always use the system default microphone and output — so the
 * dialog says that instead of offering a choice that would not do anything.
 */
export const BlindfoldModal: React.FC<BlindfoldModalProps> = ({ onClose }) => {
  useEscapeToClose(onClose);
  const dialogRef = useInitialDialogFocus<HTMLDivElement>();
  const t = useT();

  const startBlindfold = useGameStore((state) => state.startBlindfold);
  const boardSize = useGameStore((state) => state.board.length);
  const [aiColor, setAiColor] = useState<Player>('white');
  const [announce, setAnnounce] = useState<BlindfoldAnnounceMode>('xy');
  const [tested, setTested] = useState(false);

  const recognitionSupported = isSpeechRecognitionSupported();
  const synthesisSupported = isSpeechSynthesisSupported();
  const example = blindfoldExample(boardSize, announce);

  const handleTest = () => {
    setTested(true);
    if (synthesisSupported) void speak(example);
  };

  const handleStart = () => {
    if (!recognitionSupported) return;
    startBlindfold({ aiColor, announce });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-3 mobile-safe-inset mobile-safe-area-bottom"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="ui-panel flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-lg border shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="blindfold-title"
        data-blindfold-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ui-bar flex items-center justify-between border-b border-[var(--ui-border)] px-4 py-3">
          <h2 id="blindfold-title" className="text-lg font-semibold text-[var(--ui-text)]">
            {t('Blindfold training')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ui-control grid place-items-center rounded-lg text-[var(--ui-text-muted)] hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-text)]"
            aria-label={t('Close blindfold training')}
          >
            <FaTimes aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm">
          <div className="space-y-2">
            <div className="font-medium text-[var(--ui-text)]">{t('Who plays the engine?')}</div>
            <div className="flex gap-2">
              <button type="button" className={optionClass(aiColor === 'black')} onClick={() => setAiColor('black')}>
                {t('Engine plays Black')}
                <span className="block text-xs text-[var(--ui-text-muted)]">{t('You play White')}</span>
              </button>
              <button type="button" className={optionClass(aiColor === 'white')} onClick={() => setAiColor('white')}>
                {t('Engine plays White')}
                <span className="block text-xs text-[var(--ui-text-muted)]">{t('You play Black')}</span>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="font-medium text-[var(--ui-text)]">{t('How are coordinates read out?')}</div>
            <div className="flex gap-2">
              <button type="button" className={optionClass(announce === 'xy')} onClick={() => setAnnounce('xy')}>
                {t('Column then row')}
                <span className="block text-xs text-[var(--ui-text-muted)]">
                  {t('Columns from the left, rows from the bottom.')}
                </span>
              </button>
              <button type="button" className={optionClass(announce === 'rowcol')} onClick={() => setAnnounce('rowcol')}>
                {t('Row then column')}
                <span className="block text-xs text-[var(--ui-text-muted)]">
                  {t('Rows from the top, columns from the left.')}
                </span>
              </button>
            </div>
            <p className="text-[var(--ui-text-muted)]">
              {t('The engine says a point like “{example}”, and expects the same shape back.', { example })}
            </p>
          </div>

          <div className="space-y-2 rounded-lg border border-[var(--ui-border)] p-3 text-[var(--ui-text-muted)]">
            <p>{t('The board hides every stone while this runs; the button on the banner brings them back.')}</p>
            <p>
              {t('Microphone and speaker both use the system default: the browser speech APIs do not expose device choice.')}
            </p>
            {!recognitionSupported ? (
              <p className="text-[var(--ui-danger,#e53e3e)]">
                {t('This browser cannot listen for speech. Chrome or Edge is required.')}
              </p>
            ) : null}
            {recognitionSupported && !synthesisSupported ? (
              <p className="text-[var(--ui-danger,#e53e3e)]">
                {t('This browser cannot speak the coordinates, so moves will only be shown as text.')}
              </p>
            ) : null}
            {tested && recognitionSupported ? (
              <p>{t('If you heard nothing, check the system output device and the browser sound permission.')}</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ui-border)] px-4 py-3">
          <button
            type="button"
            onClick={handleTest}
            disabled={!synthesisSupported}
            className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-lg border border-[var(--ui-border)] px-4 py-2 text-sm text-[var(--ui-text-muted)] hover:bg-[var(--ui-surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FaVolumeUp aria-hidden="true" />
            {t('Test the voice')}
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 whitespace-nowrap rounded-lg px-4 py-2 text-sm text-[var(--ui-text-muted)] hover:bg-[var(--ui-surface-2)]"
            >
              {t('Cancel')}
            </button>
            <button
              type="button"
              onClick={handleStart}
              disabled={!recognitionSupported}
              className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-lg bg-[var(--ui-accent)] px-4 py-2 text-sm font-semibold text-[var(--ui-accent-contrast)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FaAssistiveListeningSystems aria-hidden="true" />
              {t('Start blindfold mode')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
