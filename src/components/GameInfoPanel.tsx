import React from 'react';
import { shallow } from 'zustand/shallow';
import { FaCheck, FaEdit, FaExternalLinkAlt } from 'react-icons/fa';
import { useGameStore } from '../store/gameStore';
import { DEFAULT_BOARD_SIZE, type GameSettings, type GameRules, type Player } from '../types';
import { getMaxHandicap, normalizeBoardSize } from '../utils/boardSize';
import { describeAiStrength, estimateAiRank } from '../utils/aiStrength';
import { BotPersonaPicker } from './BotPersonaPicker';
import { botPersonaAiPatch, type BotPersona } from '../data/botPersonas';
import { KATAGO_HUMAN_PROFILES } from '../engine/katago/searchParams';
import { describeHumanProfile } from '../utils/humanProfileLabel';
import {
  formatGameInfoPlayer,
  formatGameInfoTitle,
  formatKomiLabel,
  getFirstGameInfoLink,
  getVisibleGameInfoDetails,
  hasGameInfoMetadata,
  readRootInfoValue,
} from '../utils/gameInfoDisplay';
import { useT } from '../i18n';

type GameInfoField = {
  key: string;
  label: string;
  placeholder: string;
  className?: string;
};

const playerFields: GameInfoField[] = [
  { key: 'PB', label: 'Black', placeholder: 'Black player' },
  { key: 'BR', label: 'Rank', placeholder: 'Rank' },
  { key: 'PW', label: 'White', placeholder: 'White player' },
  { key: 'WR', label: 'Rank', placeholder: 'Rank' },
];

const detailFields: GameInfoField[] = [
  { key: 'GN', label: 'Game', placeholder: 'Game name', className: 'sm:col-span-2' },
  { key: 'EV', label: 'Event', placeholder: 'Event', className: 'sm:col-span-2' },
  { key: 'DT', label: 'Date', placeholder: 'YYYY-MM-DD' },
  { key: 'PC', label: 'Place', placeholder: 'Location' },
  { key: 'RE', label: 'Result', placeholder: 'B+R, W+2.5' },
  { key: 'TM', label: 'Time', placeholder: 'Main time' },
];

const inputClass =
  'min-h-11 w-full ui-input border rounded px-2 py-1.5 text-xs text-[var(--ui-text)] focus:border-[var(--ui-accent)] outline-none desktop-shell:min-h-0';

export const GameInfoPanel: React.FC = () => {
  const t = useT();
  const {
    rootNode,
    komi,
    gameRules,
    isAiPlaying,
    aiColor,
    currentPlayer,
    settings,
    setKomi,
    setHandicap,
    setRootProperty,
    updateSettings,
    makeAiMove,
    treeVersion,
  } = useGameStore(
    (state) => ({
      rootNode: state.rootNode,
      komi: state.komi,
      gameRules: state.settings.gameRules,
      isAiPlaying: state.isAiPlaying,
      aiColor: state.aiColor,
      currentPlayer: state.currentPlayer,
      settings: state.settings,
      setKomi: state.setKomi,
      setHandicap: state.setHandicap,
      setRootProperty: state.setRootProperty,
      updateSettings: state.updateSettings,
      makeAiMove: state.makeAiMove,
      treeVersion: state.treeVersion,
    }),
    shallow
  );
  void treeVersion;

  const rootProps = rootNode.properties ?? {};
  const valueFor = (key: string) => rootProps[key]?.[0] ?? '';
  const boardSize = normalizeBoardSize(rootNode.gameState.board.length, DEFAULT_BOARD_SIZE);
  const maxHandicap = getMaxHandicap(boardSize);
  const rawHandicap = Number.parseInt(rootProps.HA?.[0] ?? '0', 10);
  const handicap = Number.isFinite(rawHandicap) ? Math.max(0, Math.min(rawHandicap, maxHandicap)) : 0;
  const [komiInput, setKomiInput] = React.useState(() => String(komi));
  const [isEditingKomi, setIsEditingKomi] = React.useState(false);
  const [handicapInput, setHandicapInput] = React.useState(() => String(handicap));
  const [isEditingHandicap, setIsEditingHandicap] = React.useState(false);
  const [isEditingInfo, setIsEditingInfo] = React.useState(false);
  const [selectedPersonaId, setSelectedPersonaId] = React.useState<string | null>(null);
  const [showAdvancedAi, setShowAdvancedAi] = React.useState(false);
  const aiOpponent = isAiPlaying && aiColor ? aiColor : 'none';
  const showAiOptions = aiOpponent !== 'none';
  const aiStrength = estimateAiRank(settings.aiStrategy, settings);
  const updateAiConfig = (patch: Partial<GameSettings>) => updateSettings(patch);
  const selectPersona = (persona: BotPersona) => {
    setSelectedPersonaId(persona.id);
    updateAiConfig(botPersonaAiPatch(persona));
  };
  const setAiOpponent = (opponent: 'none' | Player) => {
    const nextOpponent = opponent === 'none' ? null : opponent;
    useGameStore.setState({ isAiPlaying: !!nextOpponent, aiColor: nextOpponent });
    if (nextOpponent && nextOpponent === useGameStore.getState().currentPlayer) {
      window.setTimeout(() => useGameStore.getState().makeAiMove(), 0);
    }
  };
  const title = formatGameInfoTitle(rootProps);
  const blackName = readRootInfoValue(rootProps, 'PB');
  const blackRank = readRootInfoValue(rootProps, 'BR');
  const whiteName = readRootInfoValue(rootProps, 'PW');
  const whiteRank = readRootInfoValue(rootProps, 'WR');
  const visibleDetails = getVisibleGameInfoDetails(rootProps);
  const sourceLink = getFirstGameInfoLink(rootProps);
  const hasMetadata = hasGameInfoMetadata(rootProps);
  const blackDisplay = formatGameInfoPlayer(blackName, blackRank, 'Black');
  const whiteDisplay = formatGameInfoPlayer(whiteName, whiteRank, 'White');
  const colorLabel = (color: Player): string => (color === 'black' ? t('Black') : t('White'));
  const rulesName = (rule: GameRules): string => {
    switch (rule) {
      case 'japanese':
        return t('Japanese rules');
      case 'chinese':
        return t('Chinese rules');
      case 'korean':
        return t('Korean rules');
      case 'aga':
        return t('AGA rules');
      case 'new-zealand':
        return t('New Zealand rules');
      case 'stone-scoring':
        return t('Ancient Chinese rules');
      case 'tromp-taylor':
        return t('Tromp-Taylor rules');
      default:
        return t('Japanese rules');
    }
  };

  React.useEffect(() => {
    if (!isEditingKomi) setKomiInput(String(komi));
  }, [isEditingKomi, komi]);

  React.useEffect(() => {
    if (!isEditingHandicap) setHandicapInput(String(handicap));
  }, [handicap, isEditingHandicap]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    e.stopPropagation();
  };

  const commitKomi = () => {
    const parsed = Number(komiInput.trim());
    if (Number.isFinite(parsed)) {
      setKomi(parsed);
      setKomiInput(String(Number(parsed.toFixed(2))));
    } else {
      setKomiInput(String(komi));
    }
    setIsEditingKomi(false);
  };

  const handleKomiKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    handleKeyDown(e);
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setKomiInput(String(komi));
      setIsEditingKomi(false);
      e.currentTarget.blur();
    }
  };

  const commitHandicap = () => {
    const parsed = Number.parseInt(handicapInput.trim(), 10);
    if (Number.isFinite(parsed)) {
      const next = Math.max(0, Math.min(parsed, maxHandicap));
      setHandicap(next);
      setHandicapInput(String(next));
    } else {
      setHandicapInput(String(handicap));
    }
    setIsEditingHandicap(false);
  };

  const handleHandicapKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    handleKeyDown(e);
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setHandicapInput(String(handicap));
      setIsEditingHandicap(false);
      e.currentTarget.blur();
    }
  };

  const renderPanelActions = (displayMode = false) => (
    <div
      className="ml-auto flex shrink-0 items-center gap-1"
      data-game-info-display-actions={displayMode ? 'true' : undefined}
    >
      {!isEditingInfo && sourceLink ? (
        <a
          className="panel-action-button inline-flex items-center gap-1"
          href={sourceLink.href}
          target="_blank"
          rel="noopener noreferrer"
          title={t('Open link from {source}', { source: sourceLink.sourceLabel })}
          aria-label={t('Open link from {source}', { source: sourceLink.sourceLabel })}
          data-game-info-source-link="true"
        >
          <FaExternalLinkAlt size={11} aria-hidden="true" />
          {t('Source')}
        </a>
      ) : null}
      <button
        type="button"
        className="panel-action-button inline-flex items-center gap-1"
        onClick={() => setIsEditingInfo((current) => !current)}
        aria-pressed={isEditingInfo}
        data-game-info-edit-toggle="true"
      >
        {isEditingInfo ? <FaCheck size={11} aria-hidden="true" /> : <FaEdit size={11} aria-hidden="true" />}
        {isEditingInfo ? t('Done') : t('Edit')}
      </button>
    </div>
  );

  const renderField = ({ key, label, placeholder, className }: GameInfoField) => (
    <label key={key} className={['min-w-0 space-y-1', className ?? ''].join(' ')}>
      <span className="block text-[0.625rem] font-semibold uppercase tracking-wide ui-text-faint">
        {t(label)}
      </span>
      <input
        value={valueFor(key)}
        onChange={(e) => setRootProperty(key, e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t(placeholder)}
        className={inputClass}
        spellCheck={false}
      />
    </label>
  );

  // The Edit button above is the single affordance for opening the editor; this
  // card is plain content. It used to be a role="button" too, which both doubled
  // the control and made screen readers announce the whole block as one button.
  const renderDisplayMode = () => (
    <div
      className="w-full text-left space-y-3 rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3"
      data-game-info-display="true"
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[var(--ui-text)]" title={title}>{title}</div>
          {/* Only worth a line when it explains an empty-looking card — otherwise
              the players and details are right below. */}
          {hasMetadata ? null : <div className="mt-1 text-[0.6875rem] ui-text-faint">{t('No metadata yet')}</div>}
        </div>
        {renderPanelActions(true)}
      </div>

      <div className="grid grid-cols-1 gap-2">
        <div className="flex min-w-0 items-center gap-2 rounded border border-[var(--ui-border)] bg-[var(--ui-panel)] px-2 py-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-neutral-900 ring-1 ring-white/20" aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-[0.625rem] font-semibold uppercase tracking-wide ui-text-faint">{t('Black')}</div>
            <div className="truncate text-xs text-[var(--ui-text)]">{blackDisplay}</div>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2 rounded border border-[var(--ui-border)] bg-[var(--ui-panel)] px-2 py-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-white ring-1 ring-black/30" aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-[0.625rem] font-semibold uppercase tracking-wide ui-text-faint">{t('White')}</div>
            <div className="truncate text-xs text-[var(--ui-text)]">{whiteDisplay}</div>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <dt className="text-[0.625rem] font-semibold uppercase tracking-wide ui-text-faint">{t('Komi')}</dt>
          <dd className="truncate text-xs text-[var(--ui-text)]">{formatKomiLabel(komi)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[0.625rem] font-semibold uppercase tracking-wide ui-text-faint">{t('Rules')}</dt>
          <dd className="truncate text-xs text-[var(--ui-text)]">{rulesName(gameRules)}</dd>
        </div>
        {handicap > 0 ? (
          <div className="min-w-0">
            <dt className="text-[0.625rem] font-semibold uppercase tracking-wide ui-text-faint">{t('Handicap')}</dt>
            <dd className="truncate text-xs text-[var(--ui-text)]">{handicap}</dd>
          </div>
        ) : null}
      </dl>

      {visibleDetails.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {visibleDetails.map((detail) => (
            <span
              key={detail.key}
              className="min-w-0 max-w-full rounded border border-[var(--ui-border)] bg-[var(--ui-panel)] px-2 py-1 text-[0.6875rem] text-[var(--ui-text-muted)]"
            >
              <span className="font-semibold text-[var(--ui-text)]">{t(detail.label)}:</span>{' '}
              <span className="break-words">{detail.value}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );

  const renderEditMode = () => (
    <div className="space-y-3" data-game-info-edit-form="true">
      <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
        {playerFields.map(renderField)}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {detailFields.map(renderField)}
        <label className="min-w-0 space-y-1">
          <span className="block text-[0.625rem] font-semibold uppercase tracking-wide ui-text-faint">
            {t('Komi')}
          </span>
          <input
            value={komiInput}
            onChange={(e) => setKomiInput(e.target.value)}
            onFocus={() => setIsEditingKomi(true)}
            onBlur={commitKomi}
            onKeyDown={handleKomiKeyDown}
            placeholder="7.5"
            className={inputClass}
            inputMode="decimal"
            spellCheck={false}
          />
        </label>
        <label className="min-w-0 space-y-1">
          <span className="block text-[0.625rem] font-semibold uppercase tracking-wide ui-text-faint">
            {t('Handicap')}
          </span>
          <input
            value={handicapInput}
            onChange={(e) => setHandicapInput(e.target.value)}
            onFocus={() => setIsEditingHandicap(true)}
            onBlur={commitHandicap}
            onKeyDown={handleHandicapKeyDown}
            placeholder="0"
            className={inputClass}
            inputMode="numeric"
            min={0}
            max={maxHandicap}
            spellCheck={false}
          />
        </label>
        <label className="min-w-0 space-y-1">
          <span className="block text-[0.625rem] font-semibold uppercase tracking-wide ui-text-faint">
            {t('Rules')}
          </span>
          <select
            value={gameRules}
            onChange={(e) => updateSettings({ gameRules: e.target.value as GameSettings['gameRules'] })}
            onKeyDown={handleKeyDown}
            className={inputClass}
          >
            <option value="japanese">{t('Japanese rules')}</option>
            <option value="chinese">{t('Chinese rules')}</option>
            <option value="korean">{t('Korean rules')}</option>
          </select>
        </label>
      </div>
      <div className="space-y-3 rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3" data-game-info-ai-edit="true">
        <div>
          <div className="text-xs font-semibold text-[var(--ui-text)]">{t('AI bot')}</div>
          <div className="text-[0.625rem] ui-text-faint">{t('Configure the current game opponent without starting over.')}</div>
        </div>
        <label className="min-w-0 space-y-1">
          <span className="block text-[0.625rem] font-semibold uppercase tracking-wide ui-text-faint">
            {t('Play against')}
          </span>
          <select
            value={aiOpponent}
            onChange={(e) => setAiOpponent(e.target.value as 'none' | Player)}
            onKeyDown={handleKeyDown}
            className={inputClass}
          >
            <option value="none">{t('Human (local)')}</option>
            <option value="black">{t('AI as Black')}</option>
            <option value="white">{t('AI as White')}</option>
          </select>
        </label>
        {showAiOptions ? (
          <>
            <div className="text-xs ui-text-faint">
              {t('You play as {color}.', { color: aiOpponent === 'black' ? t('White') : t('Black') })}
              {aiOpponent === currentPlayer ? ` ${t('AI is to move now.')}` : ''}
            </div>
            <div className="space-y-2">
              <div className="text-[0.6875rem] font-semibold uppercase tracking-wide ui-text-faint">{t('Choose a bot')}</div>
              <BotPersonaPicker selectedId={selectedPersonaId} onSelect={selectPersona} />
            </div>
            <button
              type="button"
              onClick={() => setShowAdvancedAi((prev) => !prev)}
              onKeyDown={handleKeyDown}
              className="text-xs font-semibold text-[var(--ui-accent)] hover:underline"
              aria-expanded={showAdvancedAi}
            >
              {showAdvancedAi ? t('Hide advanced strategy options') : t('Advanced strategy options')}
            </button>
            <div className={showAdvancedAi ? 'space-y-2' : 'hidden'}>
              <label className="min-w-0 space-y-1">
                <span className="block text-[0.625rem] font-semibold uppercase tracking-wide ui-text-faint">{t('Strategy')}</span>
                <select
                  value={settings.aiStrategy}
                  onChange={(e) => {
                    setSelectedPersonaId(null);
                    updateAiConfig({ aiStrategy: e.target.value as GameSettings['aiStrategy'] });
                  }}
                  onKeyDown={handleKeyDown}
                  className={inputClass}
                >
                  <option value="default">{t('Default (engine top move)')}</option>
                  <option value="human">{t('Human (KataGo human net)')}</option>
                  <option value="handicap">{t('KataHandicap (KaTrain)')}</option>
                  <option value="antimirror">{t('KataAntiMirror (KaTrain)')}</option>
                  <option value="rank">{t('Rank (KaTrain)')}</option>
                  <option value="simple">{t('Simple Ownership')}</option>
                  <option value="settle">{t('Settle Stones')}</option>
                  <option value="scoreloss">{t('ScoreLoss (weaker)')}</option>
                  <option value="policy">{t('Policy')}</option>
                  <option value="weighted">{t('Policy Weighted')}</option>
                  <option value="jigo">{t('Jigo')}</option>
                  <option value="pick">{t('Pick')}</option>
                  <option value="local">{t('Local')}</option>
                  <option value="tenuki">{t('Tenuki')}</option>
                  <option value="territory">{t('Territory')}</option>
                  <option value="influence">{t('Influence')}</option>
                </select>
              </label>
              <p className="text-xs ui-text-faint" data-game-info-ai-strength={aiStrength.label ?? 'none'}>
                {describeAiStrength(aiStrength)}
              </p>
              {settings.aiStrategy === 'human' ? (
                <label className="min-w-0 space-y-1">
                  <span className="block text-[0.625rem] font-semibold uppercase tracking-wide ui-text-faint">{t('Plays like')}</span>
                  <select
                    value={settings.humanSlProfile}
                    onChange={(e) => updateAiConfig({ humanSlProfile: e.target.value })}
                    onKeyDown={handleKeyDown}
                    className={inputClass}
                  >
                    {KATAGO_HUMAN_PROFILES.map((profile) => (
                      <option key={profile} value={profile}>{describeHumanProfile(profile)}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              {settings.aiStrategy === 'rank' ? (
                <label className="min-w-0 space-y-1">
                  <span className="block text-[0.625rem] font-semibold uppercase tracking-wide ui-text-faint">{t('Strength (rank target)')}</span>
                  <input
                    type="number"
                    min={-5}
                    max={20}
                    step={0.5}
                    value={settings.aiRankKyu}
                    onChange={(e) => {
                      const raw = parseFloat(e.target.value || '0');
                      updateAiConfig({ aiRankKyu: Number.isNaN(raw) ? 0 : Math.min(20, Math.max(-5, raw)) });
                    }}
                    onKeyDown={handleKeyDown}
                    className={inputClass}
                  />
                </label>
              ) : null}
              {settings.aiStrategy === 'scoreloss' ? (
                <label className="min-w-0 space-y-1">
                  <span className="block text-[0.625rem] font-semibold uppercase tracking-wide ui-text-faint">{t('Strength (c)')}</span>
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={settings.aiScoreLossStrength}
                    onChange={(e) => updateAiConfig({ aiScoreLossStrength: Math.max(0, parseFloat(e.target.value || '0')) })}
                    onKeyDown={handleKeyDown}
                    className={inputClass}
                  />
                </label>
              ) : null}
              {settings.aiStrategy === 'jigo' ? (
                <label className="min-w-0 space-y-1">
                  <span className="block text-[0.625rem] font-semibold uppercase tracking-wide ui-text-faint">{t('Target score')}</span>
                  <input
                    type="number"
                    step={0.1}
                    value={settings.aiJigoTargetScore}
                    onChange={(e) => updateAiConfig({ aiJigoTargetScore: parseFloat(e.target.value || '0') })}
                    onKeyDown={handleKeyDown}
                    className={inputClass}
                  />
                </label>
              ) : null}
              <div className="text-xs ui-text-faint">
                {t('Full per-strategy parameters remain available in Settings → AI/Engine.')}
              </div>
            </div>
            {aiOpponent === currentPlayer ? (
              <button
                type="button"
                className="min-h-9 rounded border border-[var(--ui-border)] bg-[var(--ui-surface-2)] px-3 text-xs font-semibold text-[var(--ui-text)] hover:brightness-110"
                onClick={() => makeAiMove()}
                onKeyDown={handleKeyDown}
              >
                {t('Move now')}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="space-y-3" data-game-info-panel="true">
      {isEditingInfo ? (
      <div className="game-info-edit-header flex items-center justify-between gap-2">
        {/* Display mode needs no heading: the enclosing section is already
            labelled and the game title is the next line. Edit mode keeps one
            because "Editing…" is state the reader has to see. */}
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-[var(--ui-text)]">{t('Editing game info')}</div>
          <div className="text-[0.625rem] ui-text-faint">{t('SGF root metadata')}</div>
        </div>
        {renderPanelActions()}
      </div>
      ) : null}
      {isEditingInfo ? renderEditMode() : renderDisplayMode()}
    </div>
  );
};
