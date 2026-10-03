import React, { useEffect, useState } from 'react';
import { FaTimes, FaAssistiveListeningSystems, FaVolumeUp, FaMicrophone, FaChevronDown } from 'react-icons/fa';
import { useGameStore } from '../store/gameStore';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { useInitialDialogFocus } from '../hooks/useInitialDialogFocus';
import { useT } from '../i18n';
import {
  blindfoldExample,
  interpretBlindfoldTranscript,
  type BlindfoldAnnounceMode,
  type BlindfoldInterpretation,
} from '../utils/blindfold';
import { formatBlindfoldCoordinate } from '../utils/blindfoldCoordinates';
import {
  cancelListening,
  cancelSpeech,
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  listenOnce,
  speak,
} from '../utils/speech';
import { BotPersonaPicker } from './BotPersonaPicker';
import { botPersonaAiPatch, findBotPersona, type BotPersona } from '../data/botPersonas';
import { describeAiStrength, estimateAiRank } from '../utils/aiStrength';
import type { Player } from '../types';

interface BlindfoldModalProps {
  onClose: () => void;
}

type MicTestState =
  | { status: 'idle' }
  | { status: 'listening' }
  | { status: 'failed'; reason: string }
  | { status: 'heard'; transcript: string; interpretation: BlindfoldInterpretation };

const COLUMN_LETTERS = 'ABCDEFGHJKLMNOPQRST';

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
  const updateSettings = useGameStore((state) => state.updateSettings);
  const boardSize = useGameStore((state) => state.board.length);
  const settings = useGameStore((state) => state.settings);
  const [aiColor, setAiColor] = useState<Player>('white');
  const [announce, setAnnounce] = useState<BlindfoldAnnounceMode>('xy');
  const [tested, setTested] = useState(false);
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [showBots, setShowBots] = useState(true);
  const [micTest, setMicTest] = useState<MicTestState>({ status: 'idle' });

  const recognitionSupported = isSpeechRecognitionSupported();
  const synthesisSupported = isSpeechSynthesisSupported();
  const example = blindfoldExample(boardSize, announce);
  const currentStrength = describeAiStrength(estimateAiRank(settings.aiStrategy, settings));

  // Closing the dialog must not leave the microphone open.
  useEffect(() => () => {
    cancelListening();
    cancelSpeech();
  }, []);

  const handleTest = () => {
    setTested(true);
    if (synthesisSupported) void speak(example);
  };

  const handleMicTest = async () => {
    if (!recognitionSupported || micTest.status === 'listening') return;
    setMicTest({ status: 'listening' });
    const heard = await listenOnce({ timeoutMs: 9000 });
    if (!heard.ok) {
      setMicTest({ status: 'failed', reason: heard.reason });
      return;
    }
    setMicTest({
      status: 'heard',
      transcript: heard.transcript,
      interpretation: interpretBlindfoldTranscript(heard.transcript, boardSize, announce),
    });
  };

  const micTestFailureText = (reason: string): string => {
    if (reason === 'not-allowed') return t('Microphone permission was refused.');
    if (reason === 'audio-capture') return t('No microphone was found.');
    if (reason === 'network') return t('The speech service could not be reached.');
    if (reason === 'unsupported') return t('This browser cannot listen for speech. Chrome or Edge is required.');
    return t('Nothing was heard. Try again, a little closer to the microphone.');
  };

  const handleStart = () => {
    if (!recognitionSupported) return;
    const persona = findBotPersona(personaId);
    if (persona) updateSettings(botPersonaAiPatch(persona));
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
          </div>

          <div className="space-y-2 rounded-lg border border-[var(--ui-border)] p-3">
            <button
              type="button"
              onClick={() => setShowBots((prev) => !prev)}
              className="flex w-full items-center justify-between text-left font-medium text-[var(--ui-text)]"
              aria-expanded={showBots}
            >
              <span>{t('Bot')}</span>
              <FaChevronDown
                aria-hidden="true"
                className={`transition-transform ${showBots ? '' : '-rotate-90'}`}
              />
            </button>
            {showBots ? (
              <div className="space-y-2">
                <BotPersonaPicker selectedId={personaId} onSelect={(persona: BotPersona) => setPersonaId(persona.id)} />
                <p className="text-[var(--ui-text-muted)]">
                  {personaId
                    ? t('The engine plays as the chosen bot.')
                    : t('No bot chosen: the engine keeps its current settings.')}
                </p>
                <p className="text-[var(--ui-text-muted)]">
                  {t('Current strength: {strength}', { strength: currentStrength })}
                </p>
              </div>
            ) : null}
          </div>

          <div className="space-y-2 rounded-lg border border-[var(--ui-border)] p-3">
            <div className="font-medium text-[var(--ui-text)]">{t('Microphone test')}</div>
            <p className="text-[var(--ui-text-muted)]">
              {t('Speak a point the way the mode expects it, for example {example}, and see what comes back.', { example })}
            </p>
            <button
              type="button"
              onClick={() => void handleMicTest()}
              disabled={!recognitionSupported || micTest.status === 'listening'}
              className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-lg border border-[var(--ui-border)] px-4 py-2 text-sm text-[var(--ui-text-muted)] hover:bg-[var(--ui-surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FaMicrophone aria-hidden="true" />
              {micTest.status === 'listening' ? t('Listening…') : t('Test the microphone')}
            </button>
            {micTest.status === 'listening' ? (
              <p className="text-[var(--ui-text-muted)]">{t('Say the point now.')}</p>
            ) : null}
            {micTest.status === 'failed' ? (
              <p className="text-[var(--ui-danger,#e53e3e)]">{micTestFailureText(micTest.reason)}</p>
            ) : null}
            {micTest.status === 'heard' ? (
              <div className="space-y-1">
                <p className="text-[var(--ui-text)]">{t('Heard: {text}', { text: micTest.transcript })}</p>
                {micTest.interpretation.kind === 'move' ? (
                  <p className="text-[var(--ui-text-muted)]">
                    {t('Read as {point} ({coordinate})', {
                      point: formatBlindfoldCoordinate(
                        micTest.interpretation.x,
                        micTest.interpretation.y,
                        boardSize,
                        announce
                      ),
                      coordinate: `${COLUMN_LETTERS[micTest.interpretation.x] ?? '?'}${boardSize - micTest.interpretation.y}`,
                    })}
                  </p>
                ) : micTest.interpretation.kind === 'pass' ? (
                  <p className="text-[var(--ui-text-muted)]">{t('That reads as a pass.')}</p>
                ) : (
                  <p className="text-[var(--ui-danger,#e53e3e)]">
                    {t('Could not read a point from that. Say it like “{example}”.', { example })}
                  </p>
                )}
              </div>
            ) : null}
          </div>

          {/* Only support problems and the after-a-test hint live here now, so
              the box is not rendered when there is nothing to say. */}
          {!recognitionSupported || !synthesisSupported || (tested && recognitionSupported) ? (
            <div className="space-y-2 rounded-lg border border-[var(--ui-border)] p-3 text-[var(--ui-text-muted)]">
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
          ) : null}
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
