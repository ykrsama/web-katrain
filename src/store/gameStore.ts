import { createWithEqualityFn as create } from 'zustand/traditional';
import { DEFAULT_BOARD_SIZE, DEFAULT_TOP_MOVES, KOMI, type FloatArray, type GameRules, type GameState, type BoardState, type Player, type AnalysisResult, type BoardDrawing, type GameNode, type Move, type GameSettings, type CandidateMove, type RegionOfInterest, type BoardSize, type KataGoBackendPreference, type EditTool } from '../types';
import { findMistakeNavigationTarget } from '../utils/mistakeNavigation';
import { applyCapturesInPlace, applySelfCaptureInPlace, boardsEqual, getLiberties, getLegalMoves, isEye, isValidMove } from '../utils/gameLogic';
import { playStoneSound, playCaptureSound, playPassSound, playNewGameSound, playNavigationSound, stopNavigationSounds } from '../utils/sound';
import { coordinateToSgf, expandSgfPointList, extractKaTrainUserNoteFromSgfComment, formatSgfDate, type ParsedSgf } from '../utils/sgf';
import { isKataGoCanceledError } from '../engine/katago/client';
import { engineCanExtendSearch, getEngineClient, isRemoteEngine } from '../engine/client';
import { getDefaultRemoteEngineUrl, REMOTE_ENGINE_PROXY_PATH } from '../engine/remote/defaults';
import type { KataGoAnalysisPayload } from '../engine/katago/types';
import { ENGINE_MAX_TIME_MS, ENGINE_MAX_VISITS } from '../engine/katago/limits';
import { clampAnalysisVisits } from '../utils/visitPresets';
import { DEFAULT_EVAL_THRESHOLDS } from '../utils/nodeAnalysis';
import { KATAGO_HUMAN_MODEL_URL, KATAGO_RECOMMENDED_MODEL_URL, KATAGO_SMALL_MODEL_PATH } from '../engine/katago/modelDefaults';
import { KATAGO_HUMAN_PROFILE_DEFAULT } from '../engine/katago/searchParams';
import { decodeKaTrainKt, kaTrainAnalysisToAnalysisResult } from '../utils/katrainSgfAnalysis';
import { decodeKayaKa } from '../utils/kayaSgfAnalysis';
import { publicUrl } from '../utils/publicUrl';
import { isLegacyGameEncoding } from '../utils/gameRecordImport';
import { isBoardThemeId } from '../utils/boardThemes';
import { isAppLocaleId } from '../utils/locales';
import { createEmptyBoard, getHandicapPoints, getMaxHandicap, normalizeBoardSize } from '../utils/boardSize';
import { makeAnalysisPositionKey, makeGameStateAnalysisPositionKey } from '../utils/analysisPositionKey';
import { computeTenukiValue, opponentFollowUp, type TenukiAnalysisState } from '../utils/tenukiValue';
import { evaluateTrickReplies, type TrickMoveMark, type TrickMoveMarks } from '../utils/trickMoves';
import {
  collectDrillMistakes,
  drillSummaryText,
  findNodeOnLine,
  gradeDrillGuess,
  isDrillSolved,
  type DrillSide,
  type MistakeDrillSession,
} from '../utils/mistakeDrill';
import {
  analysisQueue,
  AnalysisQueueStaleError,
  isAnalysisQueueCanceledError,
  isAnalysisQueueStaleError,
} from '../utils/analysisQueue';
import {
  findBranchTargetByIndex,
  findCurrentLineMoveTarget,
  findSiblingBranchTarget,
  getActiveChild,
  getCurrentLineNodes,
  getCurrentLineMoveNumber,
  rememberActiveBranchPath,
  type ActiveBranchMap,
} from '../utils/branchNavigation';
import { ensurePinGameId, getNodePath, getPinGameId, PIN_GAME_ID_PROP, repathPinnedVariations, resolvePinnedVariation, restorePinnedVariations, writeStoredPinnedVariations, type PinnedVariation } from '../utils/pinnedVariations';
import { describeHumanBotPick, pickHumanBotMove } from '../utils/humanBotMove';
import { komiWithHandicapBonus } from '../utils/handicap';
import {
  BLINDFOLD_SPEECH,
  blindfoldExample,
  interpretBlindfoldTranscript,
  type BlindfoldAnnounceMode,
  type BlindfoldMic,
  type BlindfoldPatch,
  type BlindfoldSession,
} from '../utils/blindfold';
import { formatBlindfoldCoordinate } from '../utils/blindfoldCoordinates';
// The shape coach names the shape a move makes. It reports in the app's
// language, so the blindfold mode asks the Chinese catalogue for the label
// instead of the interface language; see `blindfoldShapeName`.
import { getMoveInsight } from '../utils/moveInsight';
import { translate } from '../i18n/translate';
import {
  cancelListening,
  cancelSpeech,
  listenOnce,
  microphoneFailureFromListen,
  preflightMicrophone,
  queryMicrophonePermission,
  speak,
  type MicrophoneFailure,
  type MicrophonePreflight,
} from '../utils/speech';
import { humanBotPresets } from '../engine/katago/chosenMove';
import {
  countMoveTreeDescendants,
  expandAllMoveTreeBranches,
  getMoveTreeCollapseTarget,
  isNodeDescendantOf,
} from '../utils/moveTreeCollapse';
import { formatBoardMoveLabel, formatGtpMove, parseGtpMove } from '../lib/gtp';
import { buildTsumegoFrame, canFrameAsTsumego } from '../utils/tsumegoFrame';
import { clampTsumegoFrameMargin } from '../utils/tsumegoFrameOptions';
import { isGameRules, isSuicideLegal, rulesFromSgf, rulesLabel, rulesOf, rulesToSgf, suicideAllowingRulesLabel, type KoRule } from '../utils/goRules';
import { readRecordedResult, toSgfResult } from '../utils/manualScore';
import { engineHistoryBoards, koReferenceBoard } from '../utils/positionHistory';
import { situationalKey, superkoRejectionMessage } from '../utils/superko';
import { lineViolatesSuperko, repetitionHistoryForNode } from '../utils/treeSuperko';
import { chooseAntiMirrorMove, isOpponentMirroring } from '../utils/antiMirrorAi';
import { countRootHandicapStones, handicapPlayoutDoublingAdvantage } from '../utils/handicapAi';
import { getResignResult } from '../utils/resign';
import {
  admitNotification,
  autoDismissDelay,
  dismissNotification,
  emptyNotificationQueue,
} from '../utils/notificationQueue';
import { readLocalStorage, writeLocalStorage } from '../utils/storage';
import { getAnimationNow } from '../utils/animationFrame';

type BranchClipboardNode = {
  move: Move | null;
  properties: Record<string, string[]>;
  endState: string | null;
  timeUsedSeconds: number;
  note: string;
  aiThoughts: string;
  drawings?: BoardDrawing[];
  children: BranchClipboardNode[];
};

type ApplyEditToolOptions = {
  paintOnly?: boolean;
};

type GameReviewOptions = { moveRange?: [number, number] | null; reanalyzeExisting?: boolean };
type FullGameReviewOptions = GameReviewOptions & { visits: number; mistakesOnly?: boolean };
type GameReviewRequest =
  | { kind: 'quick' }
  | { kind: 'fast'; options?: GameReviewOptions }
  | { kind: 'full'; options: FullGameReviewOptions };

interface GameStore extends GameState {
  // Tree State
  rootNode: GameNode;
  currentNode: GameNode;
  treeVersion: number;
  activeBranchChildIds: ActiveBranchMap;

  // Settings & Modes
  boardRotation: 0 | 1 | 2 | 3; // 0,90,180,270 degrees clockwise (KaTrain rotate)
  regionOfInterest: RegionOfInterest | null;
  isSelectingRegionOfInterest: boolean;
  isInsertMode: boolean;
  insertAfterNodeId: string | null; // Main-branch continuation to copy after insert.
  insertAnchorNodeId: string | null; // Where insert mode started.
  isEditMode: boolean;
  editTool: EditTool;
  copiedBranch: BranchClipboardNode | null;
  editUndoCount: number;
  editRedoCount: number;
  isSelfplayToEnd: boolean;
  /** Progress of a KaTrain-style "set up position" generation, or null when idle. */
  setupPositionProgress: { move: number; untilMove: number } | null;
  isGameAnalysisRunning: boolean;
  gameAnalysisType: 'quick' | 'fast' | 'full' | null;
  gameAnalysisDone: number;
  gameAnalysisTotal: number;
  isAiPlaying: boolean;
  aiColor: Player | null;
  isAnalysisMode: boolean;
  isContinuousAnalysis: boolean;
  isTeachMode: boolean;
  /**
   * `undoable` is set by the edit actions that push onto the edit history, so
   * the toast can offer to take the change straight back — these fire from a
   * single click on the board and are easy to trigger by accident.
   */
  notification: { message: string, type: 'info' | 'error' | 'success', copyText?: string, undoable?: boolean, operationId?: string } | null;
  /**
   * Set by `loadGame` when an SGF held a move this ruleset rejects.
   *
   * A rejected move takes the rest of its line with it, so a long record can
   * come in as a handful of moves. That is worth saying out loud: it is not a
   * parse failure, nothing throws, and the game simply looks shorter than the
   * file. It is separate from `notification` because every caller of
   * `loadGame` toasts its own success message straight afterwards, which would
   * overwrite a notification set here.
   */
  sgfLoadWarning: string | null;
  analysisData: AnalysisResult | null;
  /**
   * "What do I lose by playing elsewhere?", answered by evaluating the position
   * again after the side to move passes. Kept off the game tree: it describes a
   * position that was never played, and attaching it to a node would put it in
   * exported SGF as if it had been. Carries the node id it belongs to rather
   * than being cleared on navigation -- consumers check it still matches.
   */
  tenukiAnalysis: TenukiAnalysisState | null;
  /**
   * The candidates from the last "find trick moves" scan: moves that leave the
   * opponent only one reply that does not throw points away. Kept off the game
   * tree -- the scan analyses positions that were never played -- and carries
   * the node id it belongs to, like `tenukiAnalysis`.
   */
  trickMoves: TrickMoveMarks | null;
  isTrickScanRunning: boolean;
  trickScanDone: number;
  trickScanTotal: number;
  /**
   * A run through the mistakes on the line being reviewed, one position at a
   * time, with the engine's answer hidden until the player commits to a move.
   * Null when no drill is running.
   */
  mistakeDrill: MistakeDrillSession | null;
  /**
   * The blindfold (盲棋) training session: the board is hidden, the engine plays
   * `aiColor`, its moves are announced out loud and the player answers by voice.
   * Null when the mode is off.
   */
  blindfold: BlindfoldSession | null;
  /**
   * The node whose punish-quiz guess is armed, or null. The quiz lives in the
   * board, but its answer is the node's own candidate list, which the panels
   * showed while the board hid it.
   */
  punishQuizArmedNodeId: string | null;
  setPunishQuizArmedNodeId: (nodeId: string | null) => void;
  analysisCacheSize: number;
  settings: GameSettings;
  engineStatus: 'idle' | 'loading' | 'ready' | 'error';
  engineError: string | null;
  engineBackend: string | null;
  /** Why the engine is not on the backend it was asked for, when it is not. */
  engineBackendNote: string | null;
  engineModelName: string | null;
  /** True while an AI move request is in flight, so the UI can say so. */
  isAiThinking: boolean;

  // Timer (KaTrain-like)
  timerPaused: boolean;
  timerMainTimeUsedSeconds: number; // Shared main time used (KaTrain semantics)
  timerPeriodsUsed: { black: number; white: number }; // Byo-yomi periods used per player

  // Actions
  toggleAi: (color: Player) => void;
  toggleAnalysisMode: () => void;
  toggleContinuousAnalysis: (quiet?: boolean) => void;
  stopAnalysis: () => void;
  /** Evaluate the position after the side to move passes; see `tenukiAnalysis`. */
  analyzeTenuki: () => void;
  clearTenukiAnalysis: () => void;
  /**
   * Scan every legal point of the current position for "trick moves": moves
   * that leave the opponent exactly one reply that does not lose points and
   * make their second-best reply worse for them than the position is now.
   * Equal-depth quick read at the fast-review depth, all candidates at once;
   * starts and stops are the same action.
   */
  findTrickMoves: () => void;
  stopTrickScan: () => void;
  clearAnalysisCache: () => void;
  toggleTeachMode: () => void;
  clearNotification: () => void;
  toggleTimerPaused: () => void;
  playMove: (x: number, y: number, isLoad?: boolean) => void;
  makeAiMove: (opts?: { force?: boolean }) => void;
  scheduleAiMove: (delayMs?: number) => void;
  undoMove: () => void; // Go back
  navigateBack: () => void;
  navigateForward: () => void; // Go forward (main branch)
  navigateToMove: (moveNumber: number) => void;
  navigateStart: () => void;
  navigateEnd: () => void;
  switchBranch: (direction: 1 | -1) => void;
  switchToBranchIndex: (index: number) => void;
  undoToBranchPoint: () => void;
  undoToMainBranch: () => void;
  makeCurrentNodeMainBranch: () => void;
  toggleBranchCollapse: (nodeId?: string) => void;
  addPvVariation: (pv: string[], upToMove?: number) => void;
  expandAllBranches: () => void;
  shiftCurrentVariation: (direction: 'left' | 'right') => void;
  findMistake: (direction: 'undo' | 'redo') => void;
  deleteCurrentNode: () => void;
  pruneCurrentBranch: () => void;
  undoEdit: () => void;
  redoEdit: () => void;
  copyCurrentBranch: () => void;
  pasteCopiedBranch: () => void;
  jumpToNode: (node: GameNode) => void; // Navigate to arbitrary node
  pinnedVariations: PinnedVariation[];
  pinCurrentVariation: () => void;
  recallVariation: (id: string) => void;
  unpinVariation: (id: string) => void;
  clearPinnedVariations: () => void;
  navigateNextMistake: () => void;
  navigatePrevMistake: () => void;
  /** Begin drilling the mistakes on the current line; see `mistakeDrill`. */
  startMistakeDrill: (side?: DrillSide) => void;
  /** Grade a board point as the answer to the position being drilled. */
  answerMistakeDrill: (x: number, y: number) => void;
  /** Give up on the current position and show what the engine wanted. */
  revealMistakeDrill: () => void;
  /** Move on to the next position, or finish. */
  advanceMistakeDrill: () => void;
  /** Put the board back on the position the drill is asking about. */
  resumeMistakeDrill: () => void;
  stopMistakeDrill: () => void;
  /** Start the blindfold mode; see `blindfold`. */
  startBlindfold: (opts: { aiColor: Player; announce: BlindfoldAnnounceMode }) => void;
  /** Leave the mode and put the AI settings back the way they were. */
  stopBlindfold: () => void;
  /** Runtime status of the blindfold loop, written by `useBlindfoldMode`. */
  updateBlindfold: (patch: BlindfoldPatch) => void;
  /** Wake a loop that paused on a microphone or engine problem. */
  resumeBlindfold: () => void;
  resetGame: () => void;
  loadGame: (sgf: ParsedSgf) => void;
  passTurn: () => void;
  resign: (player?: Player) => void;
  /** Write the result of a counted game onto the record; see the action. */
  /** True when the result was recorded; false when this was only an estimate. */
  recordCountedResult: (result: string) => boolean;
  runAnalysis: (opts?: {
    force?: boolean;
    /** Fill missing board ownership even with live analysis off, preserving an existing review. */
    ownershipOnly?: boolean;
    /** Automatic triggers may await current work with the same position and search settings,
     * even when its visit/time budget differs. Explicit deepening/restarts omit this. */
    ifIdle?: boolean;
    visits?: number;
    maxTimeMs?: number;
    batchSize?: number;
    maxChildren?: number;
    topK?: number;
    analysisPvLen?: number;
    wideRootNoise?: number;
    nnRandomize?: boolean;
    conservativePass?: boolean;
    reuseTree?: boolean;
    ownershipRefreshIntervalMs?: number;
    reportEveryMs?: number;
    /** Moves the search may not play at the root (KataGo avoidMoves). */
    avoidMoves?: Array<{ x: number; y: number }>;
    /**
     * Let this request replace a deeper analysis of the same position.
     *
     * Off by default: a live read must not erase a deeper result that is already
     * there. The extra-analysis actions (sweep, equalize, without-top, ...) turn
     * it on, because they answer a deliberately different or shallower question
     * and the user asked for exactly that.
     */
    allowShallower?: boolean;
  }) => Promise<void>;
  analyzeExtra: (mode: 'extra' | 'equalize' | 'sweep' | 'alternative' | 'without-top' | 'stop') => void;
  resetCurrentAnalysis: () => void;
  startSelectRegionOfInterest: () => void;
  cancelSelectRegionOfInterest: () => void;
  setRegionOfInterest: (roi: RegionOfInterest | null) => void;
  toggleInsertMode: () => void;
  toggleEditMode: () => void;
  setEditTool: (tool: EditTool) => void;
  applyEditTool: (x: number, y: number, options?: ApplyEditToolOptions) => void;
  toggleBoardPointMarkup: (x: number, y: number) => void;
  clearCurrentNodeSetupStones: () => void;
  applySetupStones: (stones: Array<{ x: number; y: number; player: Player | null }>) => number;
  frameAsTsumego: (opts: { margin: number; koAllowed: boolean }) => void;
  clearCurrentNodeAnnotations: () => void;
  addSegmentMarkup: (prop: SegmentProperty, sx: number, sy: number, ex: number, ey: number) => void;
  addNodeDrawing: (drawing: BoardDrawing) => void;
  clearNodeDrawings: () => void;
  selfplayToEnd: () => void;
  stopSelfplayToEnd: () => void;
  generateSetupPosition: (opts: { untilMove: number; targetAdvantage: number }) => void;
  stopSetupPositionGeneration: () => void;
  pendingGameReview: (GameReviewRequest & { rootId: string }) | null;
  requestQuickGameAnalysis: () => void;
  requestFastGameAnalysis: (options?: GameReviewOptions) => void;
  requestFullGameAnalysis: (options: FullGameReviewOptions) => void;
  chooseGameReviewMode: (reanalyzeExisting: boolean | null) => void;
  startQuickGameAnalysis: (opts?: { reanalyzeExisting?: boolean }) => void;
  startFastGameAnalysis: (opts?: GameReviewOptions) => void;
  startFullGameAnalysis: (opts: FullGameReviewOptions) => void;
  stopGameAnalysis: () => void;
  updateSettings: (newSettings: Partial<GameSettings>) => void;
  setKomi: (komi: number) => void;
  setHandicap: (handicap: number) => void;
  setRootProperty: (key: string, value: string) => void;
  setCurrentNodeNote: (note: string) => void;
  /** Write a note onto a node that is no longer the current one; see `getNoteDraftRescue`. */
  setNodeNote: (nodeId: string, note: string) => void;
  rotateBoard: () => void;
  startNewGame: (opts: { komi: number; rules: GameRules; boardSize: BoardSize; handicap: number }) => void;
}


type StoreNotification = NonNullable<GameStore['notification']>;

const createEmptyTerritory = (boardSize: number): number[][] =>
  Array.from({ length: boardSize }, () => Array.from({ length: boardSize }, () => 0));

const getBoardSizeFromBoard = (board: BoardState): BoardSize =>
  normalizeBoardSize(board.length, DEFAULT_BOARD_SIZE);

const applyHandicapStones = (board: BoardState, boardSize: BoardSize, handicap: number): void => {
  const points = getHandicapPoints(boardSize, handicap);
  for (const [x, y] of points) {
    if (x >= 0 && x < boardSize && y >= 0 && y < boardSize) {
      board[y]![x] = 'black';
    }
  }
};

const SETTINGS_STORAGE_KEY = 'web-katrain:settings:v3';
const LEGACY_SETTINGS_STORAGE_KEYS = ['web-katrain:settings:v2', 'web-katrain:settings:v1'] as const;
const OLD_DEFAULT_KATAGO_VISITS = 500;
/**
 * Stamped on every save. The visits default went from 500 to 5000 while this
 * key was current, so stored settings holding 500 had to be read as the old
 * default -- but a 500 chosen afterwards is a choice, and it came back as 5000
 * on every reload. Settings saved since carry this, and keep their 500.
 */
const SETTINGS_REVISION_FIELD = 'settingsRevision';
const SETTINGS_REVISION = 1;
export const DEFAULT_KATAGO_VISITS = 5000;

const normalizeModelUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(blob:|data:)/i.test(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('/models/')) return publicUrl(trimmed.slice(1));
    return trimmed;
  }
  if (trimmed.startsWith('models/')) return publicUrl(trimmed);
  return trimmed;
};

const normalizeKataGoBackend = (value: unknown): KataGoBackendPreference | null => {
  return value === 'wasm' || value === 'webgpu' || value === 'cpu' ? value : null;
};

const isLegacyDefaultModelUrl = (value: string): boolean => {
  const legacyPath = `/${KATAGO_SMALL_MODEL_PATH}`;
  return (
    value === KATAGO_RECOMMENDED_MODEL_URL ||
    value === publicUrl(KATAGO_SMALL_MODEL_PATH) ||
    value === KATAGO_SMALL_MODEL_PATH ||
    value === legacyPath ||
    value.endsWith(legacyPath)
  );
};

const resolveModelUrlForFetch = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^(blob:|data:|https?:|file:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return trimmed;
  if (typeof window === 'undefined') return trimmed;
  // Absolute paths (starting with /) resolve against the origin
  if (trimmed.startsWith('/')) {
    return new URL(trimmed, window.location.origin).toString();
  }
  // Relative paths resolve against the current page href
  return new URL(trimmed, window.location.href).toString();
};

/**
 * Visits stored by an older build (or a hand-edited localStorage entry) can sit
 * outside the current engine cap; fold them back so the stored setting and the
 * depth controls agree.
 */
const clampStoredVisits = (parsed: Record<string, unknown>, key: 'katagoVisits' | 'katagoFastVisits'): void => {
  if (!(key in parsed)) return;
  const raw = parsed[key];
  const num = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(num)) {
    delete parsed[key];
    return;
  }
  parsed[key] = Math.max(16, Math.min(ENGINE_MAX_VISITS, Math.floor(num)));
};

/**
 * Make sense of whatever is in localStorage under the settings key.
 *
 * This reads input the app did not write: the key is editable by hand, it
 * survives across versions, and a value that was valid two releases ago may name
 * a board theme or a backend that no longer exists. Every field that could reach
 * arithmetic or a lookup is checked here, and anything that fails is dropped so
 * the default takes over — losing one preference is always better than failing
 * to start.
 *
 * Separated from the read so it can be tested and fuzzed, which is the only
 * reason it is exported.
 */
export function normalizeStoredSettings(
  parsed: unknown,
  legacyKey?: string | null,
): Partial<GameSettings> | null {
  {
    const isLegacySettings = legacyKey != null;
    const isV1Settings = legacyKey === 'web-katrain:settings:v1';
    // An array is an object as far as typeof is concerned, and spreading one
    // over the defaults would put numeric keys into the settings.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if ((parsed as Record<string, unknown>).remoteEngineUrl === REMOTE_ENGINE_PROXY_PATH) {
      (parsed as Record<string, unknown>).remoteEngineUrl = getDefaultRemoteEngineUrl();
    }
    // An uploaded human net lives in a blob: URL that dies with the page, so a
    // stored one would only produce a failing fetch on the next load.
    if ('humanSlModelUrl' in parsed) {
      const stored = (parsed as { humanSlModelUrl?: unknown }).humanSlModelUrl;
      if (typeof stored !== 'string' || /^blob:/i.test(stored.trim())) {
        delete (parsed as { humanSlModelUrl?: unknown }).humanSlModelUrl;
      }
    }
    if ('katagoModelUrl' in parsed) {
      const normalized = normalizeModelUrl((parsed as { katagoModelUrl?: unknown }).katagoModelUrl);
      if (normalized) {
        (parsed as { katagoModelUrl: string }).katagoModelUrl = isLegacySettings && isLegacyDefaultModelUrl(normalized)
          ? publicUrl(KATAGO_SMALL_MODEL_PATH)
          : normalized;
      } else {
        delete (parsed as { katagoModelUrl?: unknown }).katagoModelUrl;
      }
    }
    if ('katagoBackend' in parsed) {
      const backend = normalizeKataGoBackend((parsed as { katagoBackend?: unknown }).katagoBackend);
      if (backend) {
        (parsed as { katagoBackend: KataGoBackendPreference }).katagoBackend =
          isV1Settings && backend === 'wasm' ? 'webgpu' : backend;
      } else {
        delete (parsed as { katagoBackend?: unknown }).katagoBackend;
      }
    }
    const revision = (parsed as Record<string, unknown>)[SETTINGS_REVISION_FIELD];
    delete (parsed as Record<string, unknown>)[SETTINGS_REVISION_FIELD];
    const savedBeforeRevisions = typeof revision !== 'number';
    if (savedBeforeRevisions && (parsed as { katagoVisits?: unknown }).katagoVisits === OLD_DEFAULT_KATAGO_VISITS) {
      (parsed as { katagoVisits: number }).katagoVisits = DEFAULT_KATAGO_VISITS;
    }
    clampStoredVisits(parsed as Record<string, unknown>, 'katagoVisits');
    clampStoredVisits(parsed as Record<string, unknown>, 'katagoFastVisits');
    if ('boardTheme' in parsed) {
      if (!isBoardThemeId((parsed as { boardTheme?: unknown }).boardTheme)) {
        delete (parsed as { boardTheme?: unknown }).boardTheme;
      }
    }
    if ('appLocale' in parsed) {
      if (!isAppLocaleId((parsed as { appLocale?: unknown }).appLocale)) {
        delete (parsed as { appLocale?: unknown }).appLocale;
      }
    }
    if ('legacyGameEncoding' in parsed && !isLegacyGameEncoding((parsed as { legacyGameEncoding?: unknown }).legacyGameEncoding)) {
      delete (parsed as { legacyGameEncoding?: unknown }).legacyGameEncoding;
    }
    if ('analysisExperience' in parsed) {
      const experience = (parsed as { analysisExperience?: unknown }).analysisExperience;
      if (experience !== 'coach' && experience !== 'pro') {
        delete (parsed as { analysisExperience?: unknown }).analysisExperience;
      }
    }
    if ('defaultBoardSize' in parsed) {
      const sizeRaw = (parsed as { defaultBoardSize?: unknown }).defaultBoardSize;
      const sizeNum = typeof sizeRaw === 'number' ? sizeRaw : Number.parseInt(String(sizeRaw ?? ''), 10);
      (parsed as { defaultBoardSize: BoardSize }).defaultBoardSize = normalizeBoardSize(sizeNum, DEFAULT_BOARD_SIZE);
    }
    if ('defaultHandicap' in parsed) {
      const size = (parsed as { defaultBoardSize?: BoardSize }).defaultBoardSize ?? DEFAULT_BOARD_SIZE;
      const max = getMaxHandicap(size);
      const raw = (parsed as { defaultHandicap?: unknown }).defaultHandicap;
      const num = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
      (parsed as { defaultHandicap: number }).defaultHandicap = Number.isFinite(num)
        ? Math.max(0, Math.min(Math.floor(num), max))
        : 0;
    }

    /**
     * The fields above are each checked by hand because each needs a different
     * repair. The rest only need "is this still one of the shapes the UI can
     * read?", so they are listed rather than written out, and anything that
     * fails is dropped so the default takes over.
     *
     * These were missed, and `trainerEvalThresholds` was the one that mattered:
     * the readers all guard with `?.length`, which a *string* passes, so a
     * stored `"abc"` reached `computeGameReport` and threw on `thresholds.map`
     * — the Game Report died on settings the app had itself declared valid.
     * The others degrade quietly rather than throwing (`data-ui-theme="nope"`
     * matches no CSS; `trainerShowDots: 7` indexes to `undefined`), which is
     * worse to diagnose, not better.
     */
    const oneOf = <T extends string>(...allowed: T[]) => (value: unknown): boolean =>
      typeof value === 'string' && (allowed as string[]).includes(value);
    const arrayOf = (test: (item: unknown) => boolean) => (value: unknown): boolean =>
      Array.isArray(value) && value.length > 0 && value.every(test);
    const topMovesMetric = oneOf(
      'top_move_score', 'top_move_delta_score', 'top_move_winrate',
      'top_move_delta_winrate', 'top_move_visits', 'top_move_nothing',
    );
    /**
     * Every remaining numeric setting, which must be a real number.
     *
     * The readers clamp, but `Math.max(1, Math.min(value, 64))` is not a
     * clamp: given a string or NaN both comparisons are false and the result
     * is NaN, which then passes for a number all the way down. Measured with
     * the real engine: a batch size of NaN makes `jobs.length < batchSize`
     * false on the first try, so the batch comes back empty, the root never
     * gains a visit, and the search's own stuck-batch guard breaks out --
     * analysis returns nothing at all, immediately, with no error anywhere.
     *
     * `defaultBoardSize` and `defaultHandicap` are absent because they are
     * repaired above rather than dropped; each has a meaningful nearest value.
     */
    const numericSettings = [
      'noteFontScale', 'tsumegoFrameMargin', 'setupPositionMove', 'setupPositionAdvantage',
      'timerMainTimeMinutes', 'timerByoLengthSeconds', 'timerByoPeriods', 'timerMinimalUseSeconds',
      'showLastNMistakes', 'mistakeThreshold', 'animPvTimeSeconds', 'animPvMoves',
      'trainerLowVisits', 'katagoVisits', 'katagoFastVisits', 'katagoMaxTimeMs',
      'katagoBatchSize', 'katagoMaxChildren', 'katagoTopK', 'katagoWideRootNoise',
      'katagoRootPolicyTemperature', 'katagoAnalysisPvLen',
    ] as const satisfies ReadonlyArray<keyof GameSettings>;
    const numericFields = parsed as Record<string, unknown>;
    for (const key of numericSettings) {
      if (!(key in numericFields)) continue;
      const value = numericFields[key];
      if (typeof value === 'number' && Number.isFinite(value)) continue;
      // A number written as text still says what the reader wanted, the way
      // `defaultBoardSize` above treats one. Anything else has no number in it.
      // `Number('')` and `Number('   ')` are both 0, which is a value nobody
      // wrote down; only text with something in it can name a number.
      const text = typeof value === 'string' ? value.trim() : '';
      const parsedNumber = text ? Number(text) : Number.NaN;
      if (Number.isFinite(parsedNumber)) numericFields[key] = parsedNumber;
      else delete numericFields[key];
    }

    const checks: Array<[keyof GameSettings, (value: unknown) => boolean]> = [
      // `labels` in computeGameReport names the second-to-last threshold, so a
      // single-entry list is not a usable ladder even though it is an array.
      ['trainerEvalThresholds', (value) =>
        Array.isArray(value) && value.length >= 2
        && value.every((item) => typeof item === 'number' && Number.isFinite(item))],
      ['trainerShowDots', arrayOf((item) => typeof item === 'boolean')],
      ['trainerSaveFeedback', arrayOf((item) => typeof item === 'boolean')],
      ['uiTheme', oneOf('system', 'noir', 'kaya', 'studio', 'light')],
      ['uiDensity', oneOf('compact', 'comfortable', 'large')],
      ['gameRules', isGameRules],
      ['trainerTheme', oneOf('theme:normal', 'theme:red-green-colourblind')],
      ['trainerTopMovesShow', topMovesMetric],
      ['trainerTopMovesShowSecondary', topMovesMetric],
      ['analysisPolicyMetric', oneOf('policy', 'delta_score', 'delta_winrate')],
      ['analysisSwingCompare', oneOf('previous', 'best')],
      ['katagoOwnershipMode', oneOf('root', 'tree')],
      ['humanSlBotStyle', oneOf('imitate', 'search')],
      ['analysisPolicySource', oneOf('engine', 'human')],
      ['aiStrategy', oneOf(
        'default', 'human', 'handicap', 'antimirror', 'rank', 'scoreloss', 'policy', 'weighted',
        'pick', 'local', 'tenuki', 'territory', 'influence', 'jigo', 'simple', 'settle',
      )],
      ['teachNumUndoPrompts', (value) =>
        Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item))],
    ];
    const fields = parsed as Record<string, unknown>;
    for (const [key, isValid] of checks) {
      if (key in fields && !isValid(fields[key])) delete fields[key];
    }

    // Whatever is left must at least have its default's type. A stored
    // `humanSlProfile: null` reached describeHumanProfile, whose
    // `profile.startsWith` threw while the desktop notes panel rendered -- the
    // whole UI failed to start on one corrupt field.
    const defaults = defaultSettings as unknown as Record<string, unknown>;
    for (const key of Object.keys(fields)) {
      if (!(key in defaults)) continue;
      const expected = defaults[key];
      const value = fields[key];
      if (Array.isArray(expected)) {
        if (!Array.isArray(value)) delete fields[key];
      } else if (typeof expected === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) delete fields[key];
      } else if (typeof expected === 'string' || typeof expected === 'boolean') {
        if (typeof value !== typeof expected) delete fields[key];
      }
    }

    return parsed as Partial<GameSettings>;
  }
}

const loadStoredSettings = (): Partial<GameSettings> | null => {
  try {
    const rawCurrent = readLocalStorage(SETTINGS_STORAGE_KEY);
    const legacyEntry = rawCurrent
      ? null
      : LEGACY_SETTINGS_STORAGE_KEYS.map((key) => ({ key, raw: readLocalStorage(key) })).find((entry) => entry.raw);
    const raw = rawCurrent ?? legacyEntry?.raw;
    if (!raw) return null;
    return normalizeStoredSettings(JSON.parse(raw), legacyEntry?.key ?? null);
  } catch {
    return null;
  }
};

const saveStoredSettings = (settings: GameSettings): void => {
  writeLocalStorage(SETTINGS_STORAGE_KEY, JSON.stringify({ ...settings, [SETTINGS_REVISION_FIELD]: SETTINGS_REVISION }));
};

const rulesToSgfRu = (rules: GameRules): string => rulesToSgf(rules);

const parseSgfRu = (ru: string | undefined): GameRules | null => rulesFromSgf(ru);

const ownershipToTerritoryGrid = (ownership: ArrayLike<number>, boardSize: number): number[][] => {
  const territory: number[][] = Array(boardSize)
    .fill(0)
    .map(() => Array(boardSize).fill(0));
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      const v = ownership[y * boardSize + x];
      territory[y][x] = typeof v === 'number' ? v : 0;
    }
  }
  return territory;
};

const isPassMove = (m: Move | null | undefined): boolean => !!m && (m.x < 0 || m.y < 0);

const moveKey = (m: Move): string => `${m.player}:${m.x},${m.y}`;

const collectNodesInTree = (root: GameNode): GameNode[] => {
  const out: GameNode[] = [];
  const stack: GameNode[] = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    out.push(n);
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]!);
  }
  return out;
};

const nodeMoveIndex = (node: GameNode): number => node.gameState.moveHistory.length - 1;

const nodeIsInMoveRange = (node: GameNode, moveRange: [number, number] | null): boolean => {
  if (!moveRange) return true;
  const moveIndex = nodeMoveIndex(node);
  return moveIndex >= moveRange[0] && moveIndex <= moveRange[1];
};

const nodeIsParentOfMoveInRange = (node: GameNode, moveRange: [number, number] | null): boolean => {
  if (!moveRange) return false;
  return node.children.some((child) => nodeIsInMoveRange(child, moveRange));
};

const computePointsLostForNode = (node: GameNode): number | null => {
  const move = node.move;
  const parent = node.parent;
  if (!move || !parent) return null;

  const parentScore = parent.analysis?.rootScoreLead;
  const childScore = node.analysis?.rootScoreLead;
  if (typeof parentScore === 'number' && typeof childScore === 'number') {
    const sign = move.player === 'black' ? 1 : -1;
    return sign * (parentScore - childScore);
  }
  return null;
};

const nodeHasMistakeContext = (node: GameNode, mistakesThreshold: number): boolean => {
  let maxLoss = Math.max(0, computePointsLostForNode(node) ?? 0);
  for (const child of node.children) {
    maxLoss = Math.max(maxLoss, Math.max(0, computePointsLostForNode(child) ?? 0));
  }
  return maxLoss > mistakesThreshold;
};

export const selectFullGameAnalysisNodes = (args: {
  rootNode: GameNode;
  moveRange: [number, number] | null;
  mistakesOnly: boolean;
  mistakesThreshold: number;
}): GameNode[] => {
  return collectNodesInTree(args.rootNode).filter((node) => {
    if (args.moveRange && !nodeIsInMoveRange(node, args.moveRange) && !nodeIsParentOfMoveInRange(node, args.moveRange)) {
      return false;
    }
    if (args.mistakesOnly && !nodeHasMistakeContext(node, args.mistakesThreshold)) return false;
    return true;
  });
};

const normalizeRegionOfInterest = (roi: RegionOfInterest | null, boardSize: number): RegionOfInterest | null => {
  if (!roi) return null;
  const xMin = Math.max(0, Math.min(boardSize - 1, Math.min(roi.xMin, roi.xMax)));
  const xMax = Math.max(0, Math.min(boardSize - 1, Math.max(roi.xMin, roi.xMax)));
  const yMin = Math.max(0, Math.min(boardSize - 1, Math.min(roi.yMin, roi.yMax)));
  const yMax = Math.max(0, Math.min(boardSize - 1, Math.max(roi.yMin, roi.yMax)));
  const isSinglePoint = xMin === xMax && yMin === yMax;
  const isWholeBoard = xMin === 0 && yMin === 0 && xMax === boardSize - 1 && yMax === boardSize - 1;
  if (isSinglePoint || isWholeBoard) return null; // KaTrain semantics.
  return { xMin, xMax, yMin, yMax };
};

const isMoveInRegion = (m: CandidateMove, roi: RegionOfInterest): boolean => {
  if (m.x < 0 || m.y < 0) return true; // Pass always allowed.
  return m.x >= roi.xMin && m.x <= roi.xMax && m.y >= roi.yMin && m.y <= roi.yMax;
};

const createNode = (
    parent: GameNode | null,
    move: Move | null,
    gameState: GameState,
    idOverride?: string
): GameNode => {
    return {
        id: idOverride || Math.random().toString(36).substr(2, 9),
        parent,
        children: [],
        move,
        gameState,
        endState: null,
        timeUsedSeconds: 0,
        analysis: null,
        analysisVisitsRequested: 0,
        autoUndo: null,
        undoThreshold: Math.random(),
        aiThoughts: '',
        note: '',
        properties: {}
    };
};

const createRootNodeId = (): string => `root-${Math.random().toString(36).slice(2, 11)}`;

const nodeAnalysisPositionKey = (node: GameNode, rules: GameRules): string =>
  makeGameStateAnalysisPositionKey(node.gameState, rules, repetitionHistoryForNode(node, rules));

const parentAnalysisPositionKey = (node: GameNode, rules: GameRules): string | undefined =>
  node.parent ? nodeAnalysisPositionKey(node.parent, rules) : undefined;

const nodeAnalysisVisitCount = (node: GameNode): number => {
  const rootVisits = node.analysis?.rootVisits;
  if (typeof rootVisits === 'number' && Number.isFinite(rootVisits)) return Math.max(0, Math.floor(rootVisits));
  const requested = node.analysisVisitsRequested ?? 0;
  return Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0;
};

/**
 * The visits a position's analysis actually reached.
 *
 * Used to keep the deeper of two results: a live read runs at whatever depth the
 * ladder is on, so without this a quick pass landing after a deep review — or
 * simply out of order, with several requests in flight — replaced the deeper
 * numbers with shallower ones. Whole-game and fast review write their nodes
 * directly and are deliberately not subject to this.
 */
const analysisDepth = (analysis: AnalysisResult | null | undefined): number => {
  const visits = analysis?.rootVisits;
  return typeof visits === 'number' && Number.isFinite(visits) ? Math.max(0, Math.floor(visits)) : 0;
};

const findNodeById = (root: GameNode, id: string): GameNode | null => {
  if (root.id === id) return root;
  const stack: GameNode[] = [...root.children];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.id === id) return n;
    for (let i = 0; i < n.children.length; i++) stack.push(n.children[i]!);
  }
  return null;
};

const MARKER_PROPERTIES = ['TR', 'SQ', 'CR', 'MA'] as const;
type MarkerProperty = (typeof MARKER_PROPERTIES)[number];
// Two-point segment markup: SGF AR (arrows) and LN (lines). Stored as
// 'startCoord:endCoord' and deliberately kept out of the point-list expansion.
const SEGMENT_PROPERTIES = ['AR', 'LN'] as const;
export type SegmentProperty = (typeof SEGMENT_PROPERTIES)[number];
const SETUP_PROPERTIES = ['AB', 'AW', 'AE'] as const;

/**
 * What a move written into an SGF root node takes with it when the loader
 * splits that node into our root and a first move. Everything else -- game
 * info, setup, the comment, properties we do not know -- stays on the root.
 * The first move used to get a copy of the whole node, so its comment and
 * game info were written twice on save and read back that way for good.
 */
const ROOT_MOVE_NODE_PROPERTIES = new Set([
  'B', 'W', 'KO', 'MN',
  'BL', 'WL', 'OB', 'OW',
  'BM', 'DO', 'IT', 'TE',
  'DM', 'GB', 'GW', 'HO', 'UC', 'V',
  'AR', 'CR', 'DD', 'LB', 'LN', 'MA', 'SL', 'SQ', 'TR',
  'KT', 'KA',
]);

const editToolToMarkerProperty = (tool: EditTool): MarkerProperty | null => {
  switch (tool) {
    case 'marker-triangle':
      return 'TR';
    case 'marker-square':
      return 'SQ';
    case 'marker-circle':
      return 'CR';
    case 'marker-cross':
      return 'MA';
    default:
      return null;
  }
};

const cloneBoard = (board: BoardState): BoardState => board.map((row) => [...row]);


const ensureNodeProperties = (node: GameNode): Record<string, string[]> => {
  node.properties = node.properties ?? {};
  return node.properties;
};

const cloneNodeProperties = (props: Record<string, string[]> | undefined): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  if (!props) return out;
  for (const [key, values] of Object.entries(props)) out[key] = [...values];
  return out;
};

const cloneDrawings = (drawings: BoardDrawing[] | undefined): BoardDrawing[] | undefined =>
  drawings?.map((drawing) => ({ ...drawing, points: drawing.points.map((point) => ({ ...point })) }));

const copyBranchSnapshot = (node: GameNode): BranchClipboardNode => {
  const copyNode = (source: GameNode): BranchClipboardNode => ({
    move: source.move ? { ...source.move } : null,
    properties: cloneNodeProperties(source.properties),
    endState: source.endState ?? null,
    timeUsedSeconds: source.timeUsedSeconds ?? 0,
    note: source.note ?? '',
    aiThoughts: source.aiThoughts ?? '',
    drawings: cloneDrawings(source.drawings),
    children: [],
  });
  const root = copyNode(node);
  const pending = [{ source: node, target: root }];
  while (pending.length) {
    const { source, target } = pending.pop()!;
    for (const child of source.children) {
      const copy = copyNode(child);
      target.children.push(copy);
      pending.push({ source: child, target: copy });
    }
  }
  return root;
};

const countClipboardNodes = (node: BranchClipboardNode): number => {
  let count = 0;
  const pending = [node];
  while (pending.length) {
    const current = pending.pop()!;
    count++;
    for (const child of current.children) pending.push(child);
  }
  return count;
};

const removeValue = (props: Record<string, string[]>, key: string, shouldRemove: (value: string) => boolean): void => {
  const values = props[key];
  if (!values) return;
  const next = values.filter((value) => !shouldRemove(value));
  if (next.length > 0) props[key] = next;
  else delete props[key];
};

const removeSetupCoord = (props: Record<string, string[]>, coord: string): void => {
  for (const key of SETUP_PROPERTIES) removeValue(props, key, (value) => value === coord);
};

const removeSetupProperties = (props: Record<string, string[]>): number => {
  let removed = 0;
  for (const key of SETUP_PROPERTIES) {
    removed += props[key]?.length ?? 0;
    delete props[key];
  }
  return removed;
};

const removeMarkupCoord = (props: Record<string, string[]>, coord: string): void => {
  for (const key of MARKER_PROPERTIES) removeValue(props, key, (value) => value === coord);
  removeValue(props, 'LB', (value) => value.split(':', 1)[0] === coord);
};

const hasMarkupCoord = (props: Record<string, string[]>, coord: string): boolean =>
  MARKER_PROPERTIES.some((key) => props[key]?.includes(coord)) ||
  (props.LB ?? []).some((value) => value.split(':', 1)[0] === coord);

const hasSetupCoord = (props: Record<string, string[]>, coord: string): boolean =>
  SETUP_PROPERTIES.some((key) => props[key]?.includes(coord));

const addUniqueValue = (props: Record<string, string[]>, key: string, value: string): void => {
  const values = props[key] ?? [];
  if (!values.includes(value)) props[key] = [...values, value];
};

const nextAlternateSetupStone = (props: Record<string, string[]>, currentStone: Player | null): Player | null => {
  if (currentStone === 'black') return 'white';
  if (currentStone === 'white') return null;
  const blackCount = props.AB?.length ?? 0;
  const whiteCount = props.AW?.length ?? 0;
  return blackCount <= whiteCount ? 'black' : 'white';
};

const nextAlphaLabel = (props: Record<string, string[]>): string => {
  let max = -1;
  for (const value of props.LB ?? []) {
    const label = value.slice(value.indexOf(':') + 1).trim().toUpperCase();
    if (/^[A-Z]+$/.test(label)) {
      let n = 0;
      for (const ch of label) n = n * 26 + (ch.charCodeAt(0) - 64);
      max = Math.max(max, n - 1);
    }
  }
  let n = max + 1;
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
};

const nextNumberLabel = (props: Record<string, string[]>): string => {
  let max = 0;
  for (const value of props.LB ?? []) {
    const label = value.slice(value.indexOf(':') + 1).trim();
    if (/^\d+$/.test(label)) max = Math.max(max, Number.parseInt(label, 10));
  }
  return String(max + 1);
};

const applySetupPropsToBoard = (
  board: BoardState,
  props: Record<string, string[]> | undefined,
  boardSize = board.length
): BoardState => {
  if (!props?.AB?.length && !props?.AW?.length && !props?.AE?.length) return board;
  const next = cloneBoard(board);
  const place = (player: Player, coords: string[] | undefined) => {
    for (const coord of coords ?? []) {
      for (const { x, y } of expandSgfPointList(coord, boardSize)) {
        next[y]![x] = player;
      }
    }
  };
  place('black', props.AB);
  place('white', props.AW);
  for (const coord of props.AE ?? []) {
    for (const { x, y } of expandSgfPointList(coord, boardSize)) {
      next[y]![x] = null;
    }
  }
  return next;
};

const applySetupPropsToNode = (node: GameNode, props: Record<string, string[]> | undefined, boardSize?: number): void => {
  const nextBoard = applySetupPropsToBoard(node.gameState.board, props, boardSize ?? node.gameState.board.length);
  if (nextBoard !== node.gameState.board) {
    node.gameState = { ...node.gameState, board: nextBoard };
  }
};

const playerFromSgfPlayerToMove = (props: Record<string, string[]> | undefined): Player | null => {
  const value = props?.PL?.[0]?.toUpperCase();
  if (value === 'B') return 'black';
  if (value === 'W') return 'white';
  return null;
};

const applySgfPlayerToMoveToNode = (node: GameNode, props: Record<string, string[]> | undefined): void => {
  const player = playerFromSgfPlayerToMove(props);
  if (player) node.gameState = { ...node.gameState, currentPlayer: player };
};

const countNodes = (node: GameNode): number => {
  let count = 0;
  const stack = [node];
  while (stack.length > 0) {
    const n = stack.pop()!;
    count++;
    for (const child of n.children) stack.push(child);
  }
  return count;
};

const clearAnalysisInSubtree = (node: GameNode): void => {
  const stack = [node];
  while (stack.length > 0) {
    const n = stack.pop()!;
    n.analysis = null;
    n.analysisVisitsRequested = 0;
    for (const child of n.children) stack.push(child);
  }
};

const countAnalyzedNodes = (node: GameNode): number => {
  let count = 0;
  const stack = [node];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.analysis) count++;
    for (const child of n.children) stack.push(child);
  }
  return count;
};

const getAnalysisCacheSize = (rootNode: GameNode): number =>
  Math.max(countAnalyzedNodes(rootNode), analysisQueue.getCacheSize());

type EditHistoryEntry = {
  rootNode: GameNode;
  currentNodeId: string;
  activeBranchChildIds: ActiveBranchMap;
  gameRules: GameRules;
  analysisRevision: number;
};

const EDIT_HISTORY_LIMIT = 50;
let editUndoStack: EditHistoryEntry[] = [];
let editRedoStack: EditHistoryEntry[] = [];
let analysisRevision = 0;

const cloneMove = (move: Move | null): Move | null => (move ? { ...move } : null);

const cloneGameState = (gameState: GameState): GameState => ({
  board: cloneBoard(gameState.board),
  currentPlayer: gameState.currentPlayer,
  moveHistory: gameState.moveHistory.map((move) => ({ ...move })),
  capturedBlack: gameState.capturedBlack,
  capturedWhite: gameState.capturedWhite,
  komi: gameState.komi,
});

const cloneGameNodeTree = (node: GameNode): GameNode => {
  // Positions are immutable: setup edits, replay and komi changes replace
  // gameState instead of mutating its board or move history. Reuse them here;
  // copying the full history at every node made each annotation cost O(n²)
  // on a long line, multiplied by up to 50 retained undo snapshots.
  const copyNode = (source: GameNode, parent: GameNode | null): GameNode => ({
    ...source,
    parent,
    children: [],
    move: cloneMove(source.move),
    properties: cloneNodeProperties(source.properties),
    drawings: cloneDrawings(source.drawings),
  });
  const copy = copyNode(node, null);
  const stack = [{ source: node, copy }];
  while (stack.length > 0) {
    const task = stack.pop()!;
    for (const child of task.source.children) {
      const childCopy = copyNode(child, task.copy);
      task.copy.children.push(childCopy);
      stack.push({ source: child, copy: childCopy });
    }
  }
  return copy;
};

const editHistoryCounts = () => ({
  editUndoCount: editUndoStack.length,
  editRedoCount: editRedoStack.length,
});

const clearEditHistory = () => {
  editUndoStack = [];
  editRedoStack = [];
  return editHistoryCounts();
};

const captureEditHistory = (state: GameStore): EditHistoryEntry => ({
  rootNode: cloneGameNodeTree(state.rootNode),
  currentNodeId: state.currentNode.id,
  activeBranchChildIds: { ...state.activeBranchChildIds },
  gameRules: state.settings.gameRules,
  analysisRevision,
});

/** Record a snapshot taken earlier, for edits that only know afterwards whether they changed anything. */
const commitEditHistory = (entry: EditHistoryEntry) => {
  editUndoStack.push(entry);
  if (editUndoStack.length > EDIT_HISTORY_LIMIT) editUndoStack.shift();
  editRedoStack = [];
  return editHistoryCounts();
};

const pushEditHistory = (state: GameStore) => commitEditHistory(captureEditHistory(state));

/**
 * Pins follow their nodes through an edit that moves children around, and
 * the stored copy -- which is by path, since node ids do not survive a reload
 * -- follows too. `root` is the tree after the edit.
 */
const repathPins = (root: GameNode, pins: PinnedVariation[]): { pinnedVariations?: PinnedVariation[] } => {
  const next = repathPinnedVariations(root, pins);
  if (next === pins) return {};
  writeStoredPinnedVariations(getPinGameId(root), next);
  return { pinnedVariations: next };
};

const restoreEditHistory = (entry: EditHistoryEntry, state: GameStore) => {
  // Pinning names the game on its root (WKID) without recording an edit, so
  // an older snapshot lacks it; restored without it, the pins could not be
  // found again after a reload.
  const pinGameId = getPinGameId(state.rootNode);
  if (pinGameId && !getPinGameId(entry.rootNode)) {
    entry.rootNode.properties = { ...entry.rootNode.properties, [PIN_GAME_ID_PROP]: [pinGameId] };
  }
  const rulesChanged = entry.gameRules !== state.settings.gameRules;
  const settings = rulesChanged ? { ...state.settings, gameRules: entry.gameRules } : state.settings;
  if (rulesChanged) {
    analysisRevision++;
    analysisQueue.clearCache();
    saveStoredSettings(settings);
  }
  // Old edits can outlive a model switch or an explicit cache clear. Keep
  // their annotations and positions, but never revive their stale evaluations.
  if (entry.analysisRevision !== analysisRevision) clearAnalysisInSubtree(entry.rootNode);
  const currentNode = findNodeById(entry.rootNode, entry.currentNodeId) ?? entry.rootNode;
  return {
    settings,
    rootNode: entry.rootNode,
    currentNode,
    activeBranchChildIds: { ...entry.activeBranchChildIds },
    board: currentNode.gameState.board,
    currentPlayer: currentNode.gameState.currentPlayer,
    moveHistory: currentNode.gameState.moveHistory,
    capturedBlack: currentNode.gameState.capturedBlack,
    capturedWhite: currentNode.gameState.capturedWhite,
    komi: currentNode.gameState.komi,
    analysisData: currentNode.analysis || null,
    analysisCacheSize: getAnalysisCacheSize(entry.rootNode),
    treeVersion: state.treeVersion + 1,
    // Undo and redo stop every running job (their tokens are bumped and the
    // queue cancelled); the flags go with them, or a review sat at "0/3" and
    // play-to-end read as running with nothing behind either.
    isAiThinking: false,
    isContinuousAnalysis: false,
    isSelfplayToEnd: false,
    setupPositionProgress: null,
    isGameAnalysisRunning: false,
    gameAnalysisType: null,
  };
};

const applyKomiToSubtree = (node: GameNode, komi: number): void => {
  const stack = [node];
  while (stack.length > 0) {
    const n = stack.pop()!;
    n.gameState = { ...n.gameState, komi };
    for (const child of n.children) stack.push(child);
  }
};

const formatKomiProperty = (komi: number): string =>
  Number.isInteger(komi) ? String(komi) : String(Number(komi.toFixed(2)));

const parseHandicapProperty = (props: Record<string, string[]> | undefined, boardSize: BoardSize): number => {
  const raw = props?.HA?.[0];
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(parsed, getMaxHandicap(boardSize)));
};

const applyRootHandicap = (board: BoardState, boardSize: BoardSize, oldHandicap: number, nextHandicap: number): BoardState => {
  const next = cloneBoard(board);
  for (const [x, y] of getHandicapPoints(boardSize, oldHandicap)) {
    if (next[y]?.[x] === 'black') next[y]![x] = null;
  }
  for (const [x, y] of getHandicapPoints(boardSize, nextHandicap)) {
    next[y]![x] = 'black';
  }
  return next;
};

const rootSetupPropertiesFromBoard = (
  board: BoardState,
  boardSize: BoardSize,
  handicap: number
): { AB?: string[]; AW?: string[] } => {
  const ab: string[] = [];
  const aw: string[] = [];
  const seenBlack = new Set<string>();
  const addBlack = (x: number, y: number) => {
    if (board[y]?.[x] !== 'black') return;
    const coord = coordinateToSgf(x, y);
    if (!seenBlack.has(coord)) {
      seenBlack.add(coord);
      ab.push(coord);
    }
  };

  for (const [x, y] of getHandicapPoints(boardSize, handicap)) addBlack(x, y);
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      const stone = board[y]?.[x] ?? null;
      if (stone === 'black') addBlack(x, y);
      else if (stone === 'white') aw.push(coordinateToSgf(x, y));
    }
  }

  return {
    ...(ab.length > 0 ? { AB: ab } : {}),
    ...(aw.length > 0 ? { AW: aw } : {}),
  };
};

const syncRootSetupPropertiesFromBoard = (
  props: Record<string, string[]>,
  board: BoardState,
  boardSize: BoardSize,
  handicap: number
): void => {
  const setup = rootSetupPropertiesFromBoard(board, boardSize, handicap);
  delete props.AB;
  delete props.AW;
  delete props.AE;
  if (setup.AB) props.AB = setup.AB;
  if (setup.AW) props.AW = setup.AW;
};

const rootSetupPropertiesMatchBoard = (
  props: Record<string, string[]> | undefined,
  board: BoardState,
  boardSize: BoardSize,
  handicap: number
): boolean => {
  const setup = rootSetupPropertiesFromBoard(board, boardSize, handicap);
  return JSON.stringify({
    AB: props?.AB ?? [],
    AW: props?.AW ?? [],
    AE: props?.AE ?? [],
  }) === JSON.stringify({
    AB: setup.AB ?? [],
    AW: setup.AW ?? [],
    AE: [],
  });
};

const replayChildMove = (parent: GameNode, child: GameNode, suicideLegal = false): GameState | null => {
  const move = child.move;
  const parentState = parent.gameState;
  if (!move) {
    // Comment/setup nodes do not add a move. Positions are immutable, and
    // applying setup properties already copies the board when stones change.
    return {
      ...parentState,
      board: applySetupPropsToBoard(parentState.board, child.properties),
      currentPlayer: playerFromSgfPlayerToMove(child.properties) ?? parentState.currentPlayer,
    };
  }
  const nextPlayer: Player = move.player === 'black' ? 'white' : 'black';

  if (move.x < 0 || move.y < 0) {
    const passMove: Move = { x: -1, y: -1, player: move.player };
    return {
      // Setup on a pass node applies here as on any other node; the loader
      // placed it, and a rebuild that skipped it lost the stones.
      board: applySetupPropsToBoard(cloneBoard(parentState.board), child.properties),
      currentPlayer: playerFromSgfPlayerToMove(child.properties) ?? nextPlayer,
      moveHistory: [...parentState.moveHistory, passMove],
      capturedBlack: parentState.capturedBlack,
      capturedWhite: parentState.capturedWhite,
      komi: parentState.komi,
    };
  }

  if (parentState.board[move.y]?.[move.x] !== null) return null;

  const tentativeBoard = cloneBoard(parentState.board);
  tentativeBoard[move.y]![move.x] = move.player;
  const captured = applyCapturesInPlace(tentativeBoard, move.x, move.y, move.player);
  // A group played to death is legal under New Zealand and Tromp-Taylor
  // rules; playMove allows it, and a replay that refused it dropped the node
  // and its whole subtree from a loaded or rebuilt game.
  let selfCaptured = 0;
  if (captured.length === 0) {
    const { liberties, group } = getLiberties(tentativeBoard, move.x, move.y);
    if (liberties === 0) {
      if (!suicideLegal || group.length <= 1) return null;
      selfCaptured = applySelfCaptureInPlace(tentativeBoard, move.x, move.y).length;
    }
  }

  const koBoard = koReferenceBoard(parent);
  if (koBoard && boardsEqual(tentativeBoard, koBoard)) return null;

  const newCapturedBlack =
    parentState.capturedBlack + (move.player === 'white' ? captured.length : 0) + (move.player === 'black' ? selfCaptured : 0);
  const newCapturedWhite =
    parentState.capturedWhite + (move.player === 'black' ? captured.length : 0) + (move.player === 'white' ? selfCaptured : 0);
  return {
    board: applySetupPropsToBoard(tentativeBoard, child.properties),
    currentPlayer: playerFromSgfPlayerToMove(child.properties) ?? nextPlayer,
    moveHistory: [...parentState.moveHistory, { x: move.x, y: move.y, player: move.player }],
    capturedBlack: newCapturedBlack,
    capturedWhite: newCapturedWhite,
    komi: parentState.komi,
  };
};

const pasteBranchSnapshot = (parent: GameNode, source: BranchClipboardNode, suicideLegal = false): GameNode | null => {
  const pasteNode = (parent: GameNode, source: BranchClipboardNode): GameNode | null => {
    const node = createNode(parent, cloneMove(source.move), parent.gameState);
    node.properties = cloneNodeProperties(source.properties);
    node.endState = source.endState;
    node.timeUsedSeconds = source.timeUsedSeconds;
    node.note = source.note;
    node.aiThoughts = source.aiThoughts;
    node.drawings = cloneDrawings(source.drawings);

    const rebuiltState = replayChildMove(parent, node, suicideLegal);
    if (!rebuiltState) return null;
    node.gameState = rebuiltState;
    return node;
  };

  const root = pasteNode(parent, source);
  if (!root) return null;
  const pending = [{ source, target: root }];
  while (pending.length) {
    const { source, target } = pending.pop()!;
    for (const child of source.children) {
      const pastedChild = pasteNode(target, child);
      if (!pastedChild) continue;
      target.children.push(pastedChild);
      pending.push({ source: child, target: pastedChild });
    }
  }
  return root;
};

const rebuildDescendants = (node: GameNode, suicideLegal = false): number => {
  let pruned = 0;
  const pending = [node];
  while (pending.length) {
    const parent = pending.pop()!;
    const kept: GameNode[] = [];
    for (const child of parent.children) {
      const rebuiltState = replayChildMove(parent, child, suicideLegal);
      if (!rebuiltState) {
        pruned += countNodes(child);
        continue;
      }
      child.gameState = rebuiltState;
      child.analysis = null;
      child.analysisVisitsRequested = 0;
      kept.push(child);
      pending.push(child);
    }
    parent.children = kept;
  }
  return pruned;
};

const defaultSettings: GameSettings = {
  appLocale: 'en',
  soundEnabled: true,
  showCoordinates: true,
  showMoveNumbers: false,
  showBoardControls: true,
  showAnalysisBar: true,
  noteFontScale: 1,
  fuzzyStonePlacement: false,
  showNextMovePreview: true,
  boardTheme: 'sabaki',
  // 'system' resolves to noir/light per the device's color-scheme preference.
  uiTheme: 'system',
  uiDensity: 'comfortable',
  analysisExperience: 'pro',
  showShapeCoach: false,
  gamepadNavigation: true,
  hapticFeedback: true,
  defaultBoardSize: DEFAULT_BOARD_SIZE,
  defaultHandicap: 0,
  tsumegoFrameMargin: 4,
  tsumegoFrameKoAllowed: false,
  setupPositionMove: 100,
  setupPositionAdvantage: 20,
  timerSound: true,
  timerMainTimeMinutes: 0,
  timerByoLengthSeconds: 30,
  timerByoPeriods: 5,
  timerMinimalUseSeconds: 0,
  showLastNMistakes: 3,
  mistakeThreshold: 3.0,
  legacyGameEncoding: 'auto',
  loadSgfRewind: true,
  loadSgfFastAnalysis: false,
  animPvTimeSeconds: 0.5,
  animPvMoves: 100,
  gameRules: 'chinese',
  trainerLowVisits: 25,
  trainerTheme: 'theme:normal',
  trainerEvalThresholds: [...DEFAULT_EVAL_THRESHOLDS],
  trainerShowDots: [true, true, true, true, true, true],
  trainerSaveFeedback: [true, true, true, true, false, false],
  trainerEvalShowAi: true,
  trainerTopMovesShow: 'top_move_winrate',
  trainerTopMovesShowSecondary: 'top_move_visits',
  trainerExtraPrecision: false,
  trainerSaveAnalysis: true,
  trainerSaveMarks: false,
  trainerLockAi: false,
  analysisShowChildren: true,
  analysisShowEval: true,
  analysisShowHints: true,
  analysisShowPolicy: false,
  analysisPolicyMetric: 'policy',
  analysisShowOwnership: true,
  engineMode: 'remote' as const,
  remoteEngineUrl: getDefaultRemoteEngineUrl(),
  analysisShowSwing: false,
  analysisSwingCompare: 'previous',
  katagoModelUrl: publicUrl(KATAGO_SMALL_MODEL_PATH),
  katagoBackend: 'webgpu',
  katagoVisits: DEFAULT_KATAGO_VISITS,
  katagoFastVisits: 25,
  katagoMaxTimeMs: 8000,
  katagoBatchSize: 16,
  katagoMaxChildren: DEFAULT_BOARD_SIZE * DEFAULT_BOARD_SIZE,
  katagoTopK: DEFAULT_TOP_MOVES,
  katagoReuseTree: true,
  katagoOwnershipMode: 'root',
  katagoWideRootNoise: 0.04,
  katagoRootPolicyTemperature: 1.0,
  katagoFillDameBeforePass: true,
  katagoAnalysisPvLen: 15,
  katagoNnRandomize: true,
  katagoConservativePass: true,
  humanSlEnabled: false,
  humanSlModelUrl: KATAGO_HUMAN_MODEL_URL,
  humanSlProfile: KATAGO_HUMAN_PROFILE_DEFAULT,
  humanSlBotStyle: 'imitate',
  analysisPolicySource: 'engine',
  teachNumUndoPrompts: [1, 1, 1, 0.5, 0, 0],

  aiStrategy: 'rank',
  aiHandicapAutomatic: true,
  aiHandicapPda: 0,
  aiRankKyu: 4.0,
  aiScoreLossStrength: 0.2,
  aiPolicyOpeningMoves: 22,
  aiWeightedPickOverride: 1.0,
  aiWeightedWeakenFac: 1.25,
  aiWeightedLowerBound: 0.001,

  aiPickPickOverride: 0.95,
  aiPickPickN: 5,
  aiPickPickFrac: 0.35,

  aiLocalPickOverride: 0.95,
  aiLocalStddev: 1.5,
  aiLocalPickN: 15,
  aiLocalPickFrac: 0.0,
  aiLocalEndgame: 0.5,

  aiTenukiPickOverride: 0.85,
  aiTenukiStddev: 7.5,
  aiTenukiPickN: 5,
  aiTenukiPickFrac: 0.4,
  aiTenukiEndgame: 0.45,

  aiInfluencePickOverride: 0.95,
  aiInfluencePickN: 5,
  aiInfluencePickFrac: 0.3,
  aiInfluenceThreshold: 3.5,
  aiInfluenceLineWeight: 10,
  aiInfluenceEndgame: 0.4,

  aiTerritoryPickOverride: 0.95,
  aiTerritoryPickN: 5,
  aiTerritoryPickFrac: 0.3,
  aiTerritoryThreshold: 3.5,
  aiTerritoryLineWeight: 2,
  aiTerritoryEndgame: 0.4,

  aiJigoTargetScore: 0.5,

  aiOwnershipMaxPointsLost: 1.75,
  aiOwnershipSettledWeight: 1.0,
  aiOwnershipOpponentFac: 0.5,
  aiOwnershipMinVisits: 3,
  aiOwnershipAttachPenalty: 1.0,
  aiOwnershipTenukiPenalty: 0.5,
};

const initialSettings: GameSettings = {
  ...defaultSettings,
  // English until the player picks otherwise. Every string in the app is
  // English, and this only sets <html lang>: guessed from the browser, a
  // French system marked the whole UI French, and screen readers read it with
  // French pronunciation (WCAG 3.1.1).
  appLocale: 'en',
  ...(loadStoredSettings() ?? {}),
};
// Construct the startup position after loading preferences, as New Game does.
// Building it before settings were read always opened an empty 19x19 board.
const initialBoardSize = initialSettings.defaultBoardSize;
const initialHandicap = initialSettings.defaultHandicap;
const initialBoard = createEmptyBoard(initialBoardSize);
if (initialHandicap > 0) applyHandicapStones(initialBoard, initialBoardSize, initialHandicap);
const initialGameState: GameState = {
  board: initialBoard,
  currentPlayer: initialHandicap > 0 ? 'white' : 'black',
  moveHistory: [],
  capturedBlack: 0,
  capturedWhite: 0,
  komi: rulesOf(initialSettings.gameRules).defaultKomi,
};
const initialRoot = createNode(null, null, initialGameState, createRootNodeId());
initialRoot.properties = { RU: [rulesToSgfRu(initialSettings.gameRules)], SZ: [String(initialBoardSize)] };
if (initialHandicap > 0) {
  initialRoot.properties.HA = [String(initialHandicap)];
  initialRoot.properties.PL = ['W'];
  syncRootSetupPropertiesFromBoard(initialRoot.properties, initialBoard, initialBoardSize, initialHandicap);
}

/**
 * How many analyses may be in flight against the engine.
 *
 * A remote engine parallelizes across positions, so several at once is the
 * point. It must still be a window rather than "everything": a whole-game
 * review is a few hundred positions, and pushing them all onto one WebSocket at
 * once both bursts the wire and, in Chrome, exhausts the browser's WebSocket
 * budget ("Connection failed: Insufficient resources"), after which every
 * further connect fails. 32 is wider than any sensible server's
 * `numAnalysisThreads`, so it costs no throughput in practice.
 *
 * The local worker keeps one search tree and cancels a background group down to
 * its newest request, so it stays serialized.
 */
const REMOTE_ANALYSIS_WINDOW = 32;
const engineAnalysisWindow = (settings: GameSettings): number =>
  isRemoteEngine(settings) ? REMOTE_ANALYSIS_WINDOW : 1;

analysisQueue.setConcurrency(engineAnalysisWindow(initialSettings));

let continuousToken = 0;
const scheduledAnalysisTimers = new Set<ReturnType<typeof setTimeout>>();

// Moves and setup edits defer analysis until after their state update. Stop
// must cancel these callbacks too: they have not entered analysisQueue yet.
const scheduleAnalysis = (run: () => void, delayMs: number): void => {
  const timer = setTimeout(() => {
    scheduledAnalysisTimers.delete(timer);
    run();
  }, delayMs);
  scheduledAnalysisTimers.add(timer);
};

const cancelScheduledAnalysis = (): void => {
  for (const timer of scheduledAnalysisTimers) clearTimeout(timer);
  scheduledAnalysisTimers.clear();
};

// AI replies have their own timers and ownership. Cancellation must invalidate
// the caller too, otherwise its rejected promise can schedule the move again.
let aiMoveGeneration = 0;
/** Whether the AI search in flight is a one-off request, not the opponent's reply. */
let aiMoveWorkIsOnDemand = false;
const scheduledAiMoveTimers = new Set<ReturnType<typeof setTimeout>>();

const clearScheduledAiMoves = (): void => {
  for (const timer of scheduledAiMoveTimers) clearTimeout(timer);
  scheduledAiMoveTimers.clear();
};

const cancelAiMoveWork = (): void => {
  aiMoveGeneration++;
  clearScheduledAiMoves();
  analysisQueue.cancelGroup('ai-move');
};

const scheduleAiMoveTask = (run: () => void, delayMs: number, onPositionChanged?: () => void): void => {
  const generation = aiMoveGeneration;
  const node = useGameStore.getState().currentNode;
  const position = node.gameState;
  const timer = setTimeout(() => {
    scheduledAiMoveTimers.delete(timer);
    if (generation !== aiMoveGeneration) return;
    const current = useGameStore.getState().currentNode;
    if (current.id === node.id && current.gameState === position) run();
    else onPositionChanged?.();
  }, delayMs);
  scheduledAiMoveTimers.add(timer);
};

export { lineViolatesSuperko } from '../utils/treeSuperko';

/**
 * Both players have passed, so the game is over.
 *
 * The only sign of this was a small "Game ended" chip in the game strip, which
 * assumes the reader already knows that Go ends on two passes and that someone
 * now has to count. Say it, and name the control that does the counting.
 */
const announceGameEnd = (set: (partial: { notification: StoreNotification }) => void) => {
  set({
    notification: {
      message: 'Both players passed, so the game is over. Choose Score to count the territory.',
      type: 'info',
    },
  });
};

/** Replay a move for insert mode or adding a variation, under the same ko rules as playMove. */
const createChildForMove = (parent: GameNode, move: Move, suicideLegal = false, koRule: KoRule = 'simple'): GameNode | null => {
  const st = parent.gameState;
  if (st.currentPlayer !== move.player) return null;

  if (isPassMove(move)) {
    const nextPlayer: Player = st.currentPlayer === 'black' ? 'white' : 'black';
    const nextState: GameState = {
      board: st.board,
      currentPlayer: nextPlayer,
      moveHistory: [...st.moveHistory, move],
      capturedBlack: st.capturedBlack,
      capturedWhite: st.capturedWhite,
      komi: st.komi,
    };
    const child = createNode(parent, move, nextState);
    parent.children.push(child);
    return child;
  }

  if (st.board[move.y]?.[move.x] !== null) return null;
  const tentativeBoard = st.board.map((row) => [...row]);
  tentativeBoard[move.y]![move.x] = st.currentPlayer;
  const captured = applyCapturesInPlace(tentativeBoard, move.x, move.y, st.currentPlayer);
  const newBoard = tentativeBoard;
  let selfCaptured = 0;
  if (captured.length === 0) {
    const { liberties, group } = getLiberties(newBoard, move.x, move.y);
    if (liberties === 0) {
      if (!suicideLegal || group.length <= 1) return null;
      selfCaptured = applySelfCaptureInPlace(newBoard, move.x, move.y).length;
    }
  }
  const koBoard = koReferenceBoard(parent);
  if (koBoard && boardsEqual(newBoard, koBoard)) return null;
  const nextPlayer: Player = st.currentPlayer === 'black' ? 'white' : 'black';
  if (lineViolatesSuperko(parent, newBoard, nextPlayer, koRule)) return null;

  const newCapturedBlack =
    st.capturedBlack +
    (st.currentPlayer === 'white' ? captured.length : 0) +
    (st.currentPlayer === 'black' ? selfCaptured : 0);
  const newCapturedWhite =
    st.capturedWhite +
    (st.currentPlayer === 'black' ? captured.length : 0) +
    (st.currentPlayer === 'white' ? selfCaptured : 0);
  const nextState: GameState = {
    board: newBoard,
    currentPlayer: nextPlayer,
    moveHistory: [...st.moveHistory, move],
    capturedBlack: newCapturedBlack,
    capturedWhite: newCapturedWhite,
    komi: st.komi,
  };

  const child = createNode(parent, move, nextState);
  parent.children.push(child);
  return child;
};

/**
 * One fast engine read of the current position, used by the play-to-end and
 * set-up-position generators. Both walk the game forward move by move, so they
 * always analyze wherever the board currently is.
 */
const analyzeForPlayout = (
  s: GameStore,
  opts: { group: string; label: string; id: string; wideRootNoise?: number }
): Promise<KataGoAnalysisPayload> => {
  const node = s.currentNode;
  const { previousBoard: parentBoard, previousPreviousBoard: grandparentBoard } = engineHistoryBoards(node);
  const modelUrl = resolveModelUrlForFetch(s.settings.katagoModelUrl);
  const rules = s.settings.gameRules;
  const visits = clampAnalysisVisits(s.settings.katagoFastVisits);
  const maxTimeMs = Math.max(250, Math.min(s.settings.katagoMaxTimeMs, ENGINE_MAX_TIME_MS));
  const wideRootNoise = opts.wideRootNoise ?? 0.0;
  return analysisQueue.enqueue<KataGoAnalysisPayload>({
    id: opts.id,
    label: opts.label,
    group: opts.group,
    priority: ANALYSIS_QUEUE_PRIORITY.selfplay,
    cacheKey: analysisCacheKey(
      opts.group,
      node.id,
      nodeAnalysisPositionKey(node, rules),
      modelUrl,
      s.settings.katagoBackend,
      rules,
      visits,
      maxTimeMs,
      s.settings.katagoBatchSize,
      s.settings.katagoMaxChildren,
      s.settings.katagoConservativePass,
      wideRootNoise
    ),
    run: (ctx) => getEngineClient(s.settings).analyze({
      positionId: node.id,
      parentPositionId: node.parent?.id,
      positionKey: nodeAnalysisPositionKey(node, rules),
      parentPositionKey: parentAnalysisPositionKey(node, rules),
      modelUrl,
      backend: s.settings.katagoBackend,
      board: s.board,
      previousBoard: parentBoard,
      previousPreviousBoard: grandparentBoard,
      currentPlayer: s.currentPlayer,
      moveHistory: s.moveHistory,
      repetitionHistory: repetitionHistoryForNode(node, rules),
      komi: komiWithHandicapBonus(s.rootNode.gameState.board, rules, s.komi),
      rules,
      topK: Math.max(1, Math.min(s.settings.katagoTopK, 10)),
      analysisPvLen: Math.max(0, Math.min(s.settings.katagoAnalysisPvLen, 30)),
      includeMovesOwnership: false,
      wideRootNoise,
      rootPolicyTemperature: 1.0,
      fillDameBeforePass: s.settings.katagoFillDameBeforePass,
      nnRandomize: false,
      conservativePass: s.settings.katagoConservativePass,
      visits,
      maxTimeMs,
      batchSize: s.settings.katagoBatchSize,
      maxChildren: s.settings.katagoMaxChildren,
      reuseTree: false,
      ownershipMode: 'none',
      analysisGroup: 'background',
      priority: ctx.priority,
      signal: ctx.signal,
    }),
  });
};

/** Black-positive score lead as "B+3.5" / "W+3.5" / "even". */
const formatScoreLead = (score: number): string => {
  if (Math.abs(score) < 0.05) return 'even';
  return `${score > 0 ? 'B' : 'W'}+${Math.abs(score).toFixed(1)}`;
};

/** Pick one entry with probability proportional to its weight. */
const weightedPick = <T,>(entries: Array<{ move: T; weight: number }>): T | null => {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (!(total > 0)) return entries[0]?.move ?? null;
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= Math.max(0, entry.weight);
    if (roll <= 0) return entry.move;
  }
  return entries[entries.length - 1]?.move ?? null;
};

let selfplayToken = 0;
// The node the player created with their last move or pass. Teach-mode undo
// only ever judges that node: stepping through a loaded game, or navigating
// while an analysis is in flight, must not undo anything.
let lastPlayedNodeId: string | null = null;
let skipNavigationSoundForNodeId: string | null = null;

// Moves the engine plays for itself -- the AI opponent, its heuristic
// fallback, selfplay and the set-up position generator -- run inside
// asEngineMove. Everything else is the player's hand.
let engineMoveDepth = 0;
const asEngineMove = <T,>(play: () => T): T => {
  engineMoveDepth += 1;
  try {
    return play();
  } finally {
    engineMoveDepth -= 1;
  }
};

/**
 * Whether a move or pass from the player has to wait for the AI's reply.
 *
 * Neither playMove nor passTurn asked whose turn it was, so a second Pass (or
 * P) while the AI thought was recorded as the AI's pass and ended the game on
 * a move it never chose, and a board click placed a stone in its colour. Only
 * at the end of the line: an earlier position the player stepped back to is
 * one the AI will not answer, and trying a variation there stays allowed.
 */
const isAwaitingAiReply = (state: { isAiPlaying: boolean; aiColor: Player | null; currentPlayer: Player; currentNode: GameNode }) =>
  engineMoveDepth === 0
  && state.isAiPlaying
  && state.aiColor === state.currentPlayer
  && state.currentNode.children.length === 0
  // Two passes ended the game: the AI will not move again, and play on
  // (dispute, resumption) is the player's to choose.
  && !(isPassMove(state.currentNode.move) && isPassMove(state.currentNode.parent?.move))
  && !state.currentNode.endState;

const AI_REPLY_PENDING_MESSAGE = 'The AI is to move. Wait for its reply, or turn the AI opponent off.';

/**
 * Refuse the player's move on the AI's turn -- and make sure a reply is on
 * its way. Stepping forward onto the end of the line (Redo after an Undo that
 * dropped the AI's search) left the AI to move with nothing scheduled, so the
 * refusal alone would have stalled the game for good.
 */
const refuseWhileAwaitingAi = (
  set: (partial: { notification: StoreNotification }) => void,
  get: () => { isAiThinking: boolean; scheduleAiMove: (delayMs?: number) => void }
) => {
  set({ notification: { message: AI_REPLY_PENDING_MESSAGE, type: 'info' } });
  const state = get();
  if (!state.isAiThinking && scheduledAiMoveTimers.size === 0) state.scheduleAiMove(0);
};

/**
 * After a setup edit changed the stones on the board: the analysis in flight
 * was for the old position and would land on the new one by node id, and
 * nothing asked for a fresh read (Layout's effect keys on the node id, which
 * did not change). Cancel the old, request the new.
 */
const afterBoardEdit = (get: () => GameStore): void => {
  analysisQueue.cancelGroup('interactive');
  analysisQueue.cancelGroup('tenuki');
  tenukiToken++;
  const state = get();
  // The token bump stops a pending answer from landing, but the pending
  // marker itself stayed -- "Checking..." for good -- and a finished price
  // stayed drawn over stones the edit had changed. Drop it for the edited
  // position and everything below it.
  const tenuki = state.tenukiAnalysis;
  if (tenuki) {
    const tenukiNode = findNodeById(state.rootNode, tenuki.nodeId);
    if (!tenukiNode || tenukiNode === state.currentNode || isNodeDescendantOf(tenukiNode, state.currentNode)) {
      useGameStore.setState({ tenukiAnalysis: null });
    }
  }
  if (state.isAnalysisMode && !state.isSelfplayToEnd) {
    scheduleAnalysis(() => void get().runAnalysis({ force: true }), 0);
  }
};
let setupPositionToken = 0;
// Where the current play-to-end began, so the finished line can be folded away.
let selfplayStartNodeId: string | null = null;
/**
 * The first node the playout itself added. It can walk into moves the game
 * already has -- the engine's choice is often the game's next move -- and
 * folding the start's child then hid the real game, with the real moves it
 * walked through counted as played out. Only what the playout made is folded.
 */
let selfplayHeadNodeId: string | null = null;

/**
 * Fold a finished play-to-end line into a collapsed branch and step back to
 * where it started, the way KaTrain adds the playout as a shortcut.
 */
const collapseFinishedSelfplay = (
  state: GameStore
): Partial<GameStore> => {
  const startId = selfplayStartNodeId;
  const headId = selfplayHeadNodeId;
  selfplayStartNodeId = null;
  selfplayHeadNodeId = null;
  if (!startId || !headId) return {};
  const start = findNodeById(state.rootNode, startId);
  if (!start || !isNodeDescendantOf(state.currentNode, start)) return {};
  const head = findNodeById(start, headId);
  if (!head || !(head === state.currentNode || isNodeDescendantOf(state.currentNode, head))) return {};
  if (head.children.length === 0) return {};
  head.collapsed = true;
  const hidden = countMoveTreeDescendants(head);
  return {
    currentNode: start,
    board: start.gameState.board,
    currentPlayer: start.gameState.currentPlayer,
    moveHistory: start.gameState.moveHistory,
    capturedBlack: start.gameState.capturedBlack,
    capturedWhite: start.gameState.capturedWhite,
    analysisData: start.analysis || null,
    activeBranchChildIds: rememberActiveBranchPath(state.activeBranchChildIds, start),
    treeVersion: state.treeVersion + 1,
    notification: {
      message: `Played out ${hidden + 1} moves and folded them into a collapsed branch.`,
      type: 'info' as const,
    },
  };
};
let gameAnalysisToken = 0;
/** Bumped per sweep/equalize run; a new one supersedes the previous refine batch. */
let refineToken = 0;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Bumped per play-elsewhere request; see `analyzeTenuki`. */
let tenukiToken = 0;
/** Bumped per trick-move scan; `stopTrickScan` and navigation retire a run. */
let trickToken = 0;

const ANALYSIS_QUEUE_PRIORITY = {
  interactive: 100,
  aiMove: 70,
  // Asked for explicitly, so it should feel responsive -- but not at the cost
  // of stalling a move the AI owes the user in a live game.
  tenuki: 60,
  selfplay: 55,
  equalize: 40,
  // Explicitly asked for, but a scan behind the live read: it must not preempt
  // anything, and it only orders among the jobs already queued.
  trick: 30,
  fullGame: 20,
  fastGame: 15,
  // A sweep is a broad, slow scan: it outranks the background game review but
  // must never push live analysis aside (KaTrain deprioritizes it the same way).
  sweep: 12,
  quickGame: 10,
} as const;
// KaTrain-style report cadence (seconds -> ms).
const REPORT_DURING_SEARCH_EVERY_MS = 1000;
const CONTINUOUS_REPORT_DURING_SEARCH_MS = 250;
// Throttle UI updates during progress reports to reduce main-thread churn.
const PROGRESS_APPLY_MIN_MS = 500;

const isAnalysisCanceled = (err: unknown): boolean =>
  isKataGoCanceledError(err) || isAnalysisQueueCanceledError(err) || isAnalysisQueueStaleError(err);

/**
 * Runs one analysis per node, all at once on an engine that parallelizes across
 * positions and one at a time on the engine that does not.
 *
 * The local worker keeps a single search tree and treats the newest background
 * request in a group as the only one that matters, so handing it a whole batch
 * would cancel every node but the last — exactly the hole the sequential loop
 * exists to avoid. A remote analysis engine is the opposite: its
 * `numAnalysisThreads` only help if several positions are in flight, so there the
 * batch goes out together.
 *
 * `ownsRun` returning false means the run was superseded; the batch then stops
 * touching state. `runOne` must resolve when its node is finished and may throw a
 * cancellation, which is retried because a background node superseded by the
 * user's own live analysis should not be left unanalyzed. Failures are reported
 * through `onFailure`.
 */
async function runNodeAnalysisBatch(opts: {
  nodes: GameNode[];
  concurrent: boolean;
  ownsRun: () => boolean;
  runOne: (node: GameNode) => Promise<void>;
  onFailure: (err: unknown) => void;
  maxRetries?: number;
}): Promise<void> {
  const { nodes, concurrent, ownsRun, runOne, onFailure } = opts;
  const maxRetries = opts.maxRetries ?? 3;

  const runWithRetries = async (node: GameNode) => {
    for (let tries = 0; ; tries++) {
      if (!ownsRun()) return;
      try {
        await runOne(node);
        return;
      } catch (err) {
        if (!isAnalysisCanceled(err)) {
          onFailure(err);
          return;
        }
        if (tries >= maxRetries) {
          if (ownsRun()) onFailure(new Error('Interrupted repeatedly by other analysis.'));
          return;
        }
        await sleep(25);
      }
    }
  };

  if (concurrent) {
    await Promise.all(nodes.map((node) => runWithRetries(node)));
    return;
  }

  for (const node of nodes) {
    if (!ownsRun()) return;
    await runWithRetries(node);
    await sleep(0);
  }
}

/** GTP point label, matching the engine's own coordinates. */
const gtpOf = (x: number, y: number, boardSize: number): string =>
  x < 0 || y < 0 ? 'pass' : `${String.fromCharCode(65 + (x >= 8 ? x + 1 : x))}${boardSize - y}`;

/**
 * Fold the analysis of the position after `candidate` back onto the parent
 * node's entry for it (KaTrain's `refine_move`).
 *
 * `analysis` evaluates the *child* position, so its root values are that move's
 * value — the same quantity the parent's own move list reports for it — and
 * replace the entry's numbers instead of being combined with them. The PV is
 * prefixed with the move itself, as the parent's PVs are.
 */
function mergedWithRefinedCandidate(
  result: AnalysisResult | null | undefined,
  candidate: { x: number; y: number },
  analysis: KataGoAnalysisPayload,
  boardSize: number,
): AnalysisResult | null {
  if (!result) return null;
  const index = result.moves.findIndex((m) => m.x === candidate.x && m.y === candidate.y);
  if (index < 0) return null;
  const existing = result.moves[index]!;
  const best = result.moves[0];
  const pointsLost = best ? Math.max(0, best.scoreLead - analysis.rootScoreLead) : 0;
  const winRateLost = best ? Math.max(0, best.winRate - analysis.rootWinRate) : 0;
  const moves = result.moves.slice();
  moves[index] = {
    ...existing,
    winRate: analysis.rootWinRate,
    scoreLead: analysis.rootScoreLead,
    scoreSelfplay: analysis.rootScoreSelfplay,
    scoreStdev: analysis.rootScoreStdev,
    visits: Math.max(existing.visits, analysis.rootVisits ?? 0),
    pv: [gtpOf(candidate.x, candidate.y, boardSize), ...(analysis.moves[0]?.pv ?? [])],
    pointsLost,
    relativePointsLost: pointsLost,
    winRateLost,
  };
  return { ...result, moves };
}

/**
 * The sound of stepping onto a recorded move: the stone it places, the captures
 * it makes, or the pass sound when the recorded move was a pass.
 *
 * `from` is the node the step starts at; its capture counters say whether that
 * move took anything off the board (they are cumulative along the line).
 */
const playStepSound = (args: { enabled: boolean; from: GameNode; to: GameNode }): void => {
  if (!args.enabled) return;
  const move = args.to.move;
  if (!move) return;
  if (move.x < 0 || move.y < 0) {
    playPassSound();
    return;
  }
  const before = args.from.gameState;
  const after = args.to.gameState;
  const capturedCount = Math.max(
    0,
    move.player === 'white'
      ? after.capturedBlack - before.capturedBlack
      : after.capturedWhite - before.capturedWhite,
  );
  playStoneSound();
  if (capturedCount > 0) {
    setTimeout(() => playCaptureSound(capturedCount), 100);
  }
};

let blindfoldToken = 0;
/** What the AI settings were before the blindfold mode took them over. */
let blindfoldRestoreAi: { isAiPlaying: boolean; aiColor: Player | null } | null = null;
/** How long one listen may last before it counts as "heard nothing". */
const BLINDFOLD_LISTEN_TIMEOUT_MS = 9000;
/** How long to wait for the engine's move before saying it stalled. */
const BLINDFOLD_AI_MOVE_TIMEOUT_MS = 60_000;

const blindfoldSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const waitForBlindfold = async (predicate: () => boolean, timeoutMs: number, intervalMs = 100): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await blindfoldSleep(intervalMs);
  }
  return predicate();
};

/** Leave the mode: drop the session and put the AI settings back. */
const blindfoldResetPatch = (): Partial<GameStore> => {
  const restore = blindfoldRestoreAi;
  blindfoldRestoreAi = null;
  return restore
    ? { blindfold: null, isAiPlaying: restore.isAiPlaying, aiColor: restore.aiColor }
    : { blindfold: null };
};

/** What a failed microphone check means for the session. */
const blindfoldMicForFailure = (failure: MicrophoneFailure): Partial<BlindfoldMic> =>
  // A prompt that is still open is not an error, it is a question the player has
  // to answer, and the banner says so rather than crying failure.
  failure === 'waiting' ? { status: 'permission', failure: null } : { status: 'blocked', failure };

/**
 * The name the shape coach (棋形讲解) gives this move, in Chinese: the board is
 * covered in this mode, so "虎口" versus "长" is the one thing the announcement
 * cannot show by itself. The coach speaks the app's language, so the label goes
 * through the Chinese catalogue — a label that is already Chinese comes back
 * unchanged.
 */
const blindfoldShapeName = (move: Move, boardSize: number, parentBoard: BoardState | null): string | null => {
  if (move.x < 0 || move.y < 0) return null;
  const insight = getMoveInsight(move, boardSize, parentBoard);
  if (!insight) return null;
  return translate('zh', insight.label).trim() || null;
};

/**
 * Mirror the browser's microphone state into the session while the mode runs.
 * The preflight is the answer from the browser itself, but the recogniser's own
 * start event is the ground truth, and it overwrites this as soon as it fires.
 */
const watchBlindfoldMic = (get: () => GameStore, token: number, preflight: Promise<MicrophonePreflight>): void => {
  const alive = () => token === blindfoldToken && !!get().blindfold;
  const patch = (partial: Partial<BlindfoldMic>) => {
    if (alive()) get().updateBlindfold({ mic: partial });
  };
  // Only the first answer counts: a permission probe can come back after the
  // device has already opened, and reporting "prompt" then would be a lie.
  const patchWhileUnsure = (partial: Partial<BlindfoldMic>) => {
    if (alive() && get().blindfold?.mic.status === 'checking') patch(partial);
  };

  void queryMicrophonePermission().then((permission) => {
    if (permission === 'prompt') patchWhileUnsure({ status: 'permission' });
    else if (permission === 'denied') patchWhileUnsure({ status: 'blocked', failure: 'denied' });
  });
  void preflight.then((check) => {
    if (!alive()) return;
    if (check.ok) patch({ status: 'starting', failure: null });
    else patch(blindfoldMicForFailure(check.failure));
  });
};

/**
 * The blindfold conversation, one turn at a time: announce the engine's move,
 * listen for the player's answer, play it, repeat. Every write goes through a
 * store action, so the board and the status banner just render `blindfold`.
 *
 * The loop stops when `stopBlindfold` bumps the token, and pauses -- waiting for
 * `resumeBlindfold` -- rather than talking over a player who has gone quiet.
 */
const runBlindfoldSession = async (
  get: () => GameStore,
  token: number,
  preflight: Promise<MicrophonePreflight>
): Promise<void> => {
  let announcedNodeId: string | null = null;
  let micChecked = false;

  const alive = () => token === blindfoldToken && !!get().blindfold;
  const patch = (partial: BlindfoldPatch) => {
    if (alive()) get().updateBlindfold(partial);
  };
  const waitForResume = async (): Promise<void> => {
    const resumeToken = get().blindfold?.resumeToken ?? -1;
    await waitForBlindfold(
      () => !alive() || (get().blindfold?.resumeToken ?? -1) !== resumeToken,
      6 * 60 * 60 * 1000,
      300
    );
  };

  while (alive()) {
    const state = get();
    const session = state.blindfold!;
    const boardSize = getBoardSizeFromBoard(state.board);
    const node = state.currentNode;
    const nodeMove = node.move;
    const aiToMove = state.currentPlayer === session.aiColor;

    // Announce the engine's move once, as soon as it is the newest thing on the
    // board: the player answers right after hearing it.
    if (!aiToMove && nodeMove && nodeMove.player === session.aiColor && announcedNodeId !== node.id) {
      announcedNodeId = node.id;
      const announced =
        nodeMove.x < 0 || nodeMove.y < 0
          ? BLINDFOLD_SPEECH.aiPass
          : formatBlindfoldCoordinate(nodeMove.x, nodeMove.y, boardSize, session.announce);
      const shape = blindfoldShapeName(nodeMove, boardSize, node.parent?.gameState.board ?? null);
      // The board is covered, so the move the engine just announced is also put
      // on screen: it is the one thing the player has to work from.
      patch({
        phase: 'confirming',
        transcript: null,
        lastPoint: { text: announced, shape, from: 'engine' },
        message: null,
      });
      await speak(shape ? `${announced}，${shape}` : announced);
      if (!alive()) return;
    }

    // The engine may still be thinking; wait for the turn to come back, or say
    // that it never did.
    if (aiToMove) {
      patch({ phase: 'ai-thinking', transcript: null, message: BLINDFOLD_SPEECH.aiThinking });
      const moved = await waitForBlindfold(
        () => !alive() || get().currentPlayer !== session.aiColor,
        BLINDFOLD_AI_MOVE_TIMEOUT_MS
      );
      if (!moved && alive()) {
        patch({ phase: 'error', transcript: null, message: BLINDFOLD_SPEECH.noAiMove });
        await waitForResume();
      }
      continue;
    }

    // Two passes in a row end the game: there is no move left to listen for.
    const lastMoves = state.moveHistory.slice(-2);
    if (lastMoves.length === 2 && lastMoves.every((move) => move.x < 0 || move.y < 0)) {
      patch({ phase: 'paused', transcript: null, message: BLINDFOLD_SPEECH.finished });
      await waitForResume();
      continue;
    }

    const example = blindfoldExample(boardSize, session.announce);
    // Whatever the player says while the recogniser is still opening is lost, so
    // the turn does not begin with "speak now": the banner reports the
    // microphone instead, and the prompt follows the recogniser's own start.
    const micBefore = get().blindfold?.mic;
    const retrying = !micBefore || micBefore.status === 'ready' || micBefore.status === 'starting';
    patch({
      phase: 'listening',
      transcript: null,
      message: null,
      ...(retrying ? { mic: { status: 'starting' as const, failure: null } } : {}),
    });

    // Opening the device is what raises the permission prompt, so its answer is
    // waited for once -- after this the recogniser reports for itself.
    if (!micChecked) {
      micChecked = true;
      let check: MicrophonePreflight;
      try {
        check = await preflight;
      } catch {
        check = { ok: false, failure: 'error' };
      }
      if (!alive()) return;
      patch({
        mic: check.ok
          ? { status: 'starting', failure: null }
          : blindfoldMicForFailure(check.failure),
      });
    }

    const askForPoint = `${BLINDFOLD_SPEECH.listening}（例如 ${example}）`;
    const heard = await listenOnce({
      timeoutMs: BLINDFOLD_LISTEN_TIMEOUT_MS,
      onReady: () => patch({ mic: { status: 'ready', failure: null }, message: askForPoint }),
    });
    if (!alive()) return;

    if (!heard.ok) {
      // A microphone that will not open is not a miss: say so and wait for the
      // player instead of asking again and again.
      if (heard.reason === 'unsupported' || heard.reason === 'not-allowed' || heard.reason === 'audio-capture') {
        patch({
          phase: 'error',
          transcript: null,
          message: `${BLINDFOLD_SPEECH.noMic}（${heard.reason}）。`,
          mic: { status: 'blocked', failure: microphoneFailureFromListen(heard.reason) },
        });
        await waitForResume();
      }
      // Silence or a timeout is not a misunderstanding, so it gets no "听不清楚"
      // either; there is no attempt limit, the mode simply listens again.
      continue;
    }

    const interpreted = interpretBlindfoldTranscript(heard.transcript, boardSize, session.announce);
    if (interpreted.kind === 'unparsed') {
      patch({ phase: 'listening', transcript: heard.transcript, message: null });
      await speak(BLINDFOLD_SPEECH.unparsed);
      continue;
    }

    const current = get();
    // The player may have clicked a point or navigated while the microphone was
    // open, which hands the turn back to the engine: what we heard is stale.
    if (current.currentPlayer === session.aiColor) continue;
    if (interpreted.kind === 'pass') {
      patch({
        phase: 'confirming',
        transcript: heard.transcript,
        lastPoint: { text: BLINDFOLD_SPEECH.playerPass, shape: null, from: 'player' },
        message: null,
      });
      current.passTurn();
      continue;
    }

    const legal = isValidMove(
      current.board,
      interpreted.x,
      interpreted.y,
      current.currentPlayer,
      current.currentNode.parent?.gameState.board,
      { multiStoneSuicideLegal: isSuicideLegal(current.settings.gameRules) }
    );
    if (!legal) {
      patch({ phase: 'listening', transcript: heard.transcript, message: null });
      await speak(BLINDFOLD_SPEECH.illegal);
      continue;
    }

    // The point is shown on screen rather than spoken back: hearing it again
    // while the engine starts thinking is just noise. The store schedules the
    // engine's reply, and the loop goes on to wait for it.
    patch({
      phase: 'confirming',
      transcript: heard.transcript,
      lastPoint: {
        text: formatBlindfoldCoordinate(interpreted.x, interpreted.y, boardSize, session.announce),
        // The player's own shape is named on screen too — same rule as the
        // engine's move, so the board area always answers "what is this point?"
        shape: blindfoldShapeName(
          { x: interpreted.x, y: interpreted.y, player: current.currentPlayer },
          boardSize,
          current.currentNode.gameState.board
        ),
        from: 'player',
      },
      message: null,
    });
    current.playMove(interpreted.x, interpreted.y);
  }
};

const gameAnalysisTypeLabel = (type: NonNullable<GameStore['gameAnalysisType']>): string => {
  if (type === 'quick') return 'Quick game analysis';
  if (type === 'fast') return 'Fast game review';
  return 'Full game analysis';
};

const errorMessage = (err: unknown): string => {
  const message = err instanceof Error ? err.message : String(err);
  return message.trim() || 'Unknown analysis error';
};

const gameAnalysisFailureUpdate = (
  type: NonNullable<GameStore['gameAnalysisType']>,
  failed: number,
  total: number,
  lastError: string | null
): Partial<Pick<GameStore, 'engineStatus' | 'engineError' | 'notification'>> => {
  if (failed <= 0) return {};
  const label = gameAnalysisTypeLabel(type);
  const totalLabel = `${total} position${total === 1 ? '' : 's'}`;
  const summary =
    failed >= total
      ? `${label} failed for all ${totalLabel}`
      : `${label} skipped ${failed} of ${totalLabel}`;
  const detail = lastError ?? 'Unknown analysis error';
  const message = `${summary}: ${detail}`;
  return {
    engineStatus: 'error',
    engineError: detail,
    notification: {
      message,
      type: 'error',
      copyText: message,
    },
  };
};

const analysisCacheKey = (...parts: unknown[]): string => JSON.stringify(parts);

let runningInteractiveAnalysis: {
  id: string;
  contextKey: string;
  cacheKey: string;
  requestKey: string;
  promise: Promise<void>;
} | null = null;

export const useGameStore = create<GameStore>((commit, get) => {
  const set = (update: Partial<GameStore> | ((state: GameStore) => Partial<GameStore>)): void => {
    const state = get();
    const patch = typeof update === 'function' ? update(state) : update;
    const node = patch.currentNode ?? state.currentNode;
    const soundEnabled = (patch.settings ?? state.settings).soundEnabled;
    if (!soundEnabled || (patch.rootNode && patch.rootNode !== state.rootNode)) {
      skipNavigationSoundForNodeId = null;
      stopNavigationSounds();
    } else if (node.id !== state.currentNode.id) {
      const skip = skipNavigationSoundForNodeId === node.id;
      skipNavigationSoundForNodeId = null;
      if (!skip && node.move && node.gameState.moveHistory.length > state.moveHistory.length) {
        // Keep e85ded9's latency guarantee: schedule cached audio BEFORE the
        // store write can trigger subscriptions, analysis or React rendering.
        playNavigationSound(node.move.x < 0 || node.move.y < 0 ? 'pass' : 'stone');
      } else {
        stopNavigationSounds();
      }
    }
    commit(patch);
  };
  return {
  // Flat properties (mirrored from currentNode.gameState for easy access)
  board: initialGameState.board,
  currentPlayer: initialGameState.currentPlayer,
  moveHistory: initialGameState.moveHistory,
  capturedBlack: initialGameState.capturedBlack,
  capturedWhite: initialGameState.capturedWhite,
  komi: initialGameState.komi,

  // Tree State
  rootNode: initialRoot,
  currentNode: initialRoot,
  treeVersion: 0,
  activeBranchChildIds: {},
  pinnedVariations: [],

  boardRotation: 0,
  regionOfInterest: null,
  isSelectingRegionOfInterest: false,
  isInsertMode: false,
  insertAfterNodeId: null,
  insertAnchorNodeId: null,
  isEditMode: false,
  editTool: 'setup-black',
  copiedBranch: null,
  editUndoCount: 0,
  editRedoCount: 0,
  isSelfplayToEnd: false,
  setupPositionProgress: null,
  isGameAnalysisRunning: false,
  gameAnalysisType: null,
  gameAnalysisDone: 0,
  gameAnalysisTotal: 0,
  isAiPlaying: false,
  aiColor: null,
  isAnalysisMode: false,
  isContinuousAnalysis: false,
  isTeachMode: false,
  notification: null,
  sgfLoadWarning: null,
  analysisData: null,
  tenukiAnalysis: null,
  trickMoves: null,
  isTrickScanRunning: false,
  trickScanDone: 0,
  trickScanTotal: 0,
  mistakeDrill: null,
  blindfold: null,
  punishQuizArmedNodeId: null,
  setPunishQuizArmedNodeId: (nodeId) => {
    if (useGameStore.getState().punishQuizArmedNodeId !== nodeId) useGameStore.setState({ punishQuizArmedNodeId: nodeId });
  },
  analysisCacheSize: getAnalysisCacheSize(initialRoot),
  settings: initialSettings,
  engineStatus: 'idle',
  engineError: null,
  engineBackend: null,
  engineBackendNote: null,
  engineModelName: null,
  isAiThinking: false,

  timerPaused: true,
  timerMainTimeUsedSeconds: 0,
  timerPeriodsUsed: { black: 0, white: 0 },

  toggleAi: (color) => {
    const s = get();
    const nextOn = !(s.isAiPlaying && s.aiColor === color);
    cancelAiMoveWork();
    set({ isAiPlaying: nextOn, isAiThinking: false, aiColor: nextOn ? color : null });
    const after = get();
    if (after.isAiPlaying && after.aiColor === after.currentPlayer) {
      after.scheduleAiMove();
    }
  },

  toggleAnalysisMode: () => set((state) => {
      const newMode = !state.isAnalysisMode;
      if (newMode) {
          scheduleAnalysis(() => void get().runAnalysis({ ifIdle: true }), 0);
      } else {
          analysisQueue.cancelGroup('interactive');
      }
      return {
        isAnalysisMode: newMode,
        isContinuousAnalysis: newMode ? state.isContinuousAnalysis : false,
        analysisData: state.currentNode.analysis || null,
        engineStatus: newMode ? state.engineStatus : 'idle',
        engineError: newMode ? state.engineError : null,
        settings: newMode && !state.settings.analysisShowHints
          ? { ...state.settings, analysisShowHints: true }
          : state.settings,
      };
  }),

  toggleContinuousAnalysis: (quiet = false) => {
      const next = !get().isContinuousAnalysis;
      set((state) => ({ isContinuousAnalysis: next, isAnalysisMode: next ? true : state.isAnalysisMode }));
      if (next) {
          // Live analysis should never run with a blank board, but an overlay
          // setup the user already chose is theirs to keep — only fill in top
          // move hints when nothing at all would be drawn.
          const s = get().settings;
          const anyOverlayVisible =
            s.analysisShowChildren ||
            s.analysisShowEval ||
            s.analysisShowHints ||
            s.analysisShowPolicy ||
            s.analysisShowOwnership;
          if (!anyOverlayVisible) get().updateSettings({ analysisShowHints: true });
      }
      if (!quiet) {
          const notification = { message: next ? 'Continuous analysis on' : 'Continuous analysis off', type: 'info' as const };
          set({ notification });
      }
      if (!next) {
          continuousToken++;
          return;
      }

      const token = ++continuousToken;
      let errorBackoffMs = 1000;
      // The local worker keeps its search tree between requests, so asking again
      // deepens the same search and the ladder below can climb to the requested
      // depth in steps of Max Time. A remote analysis engine throws its tree
      // away for every query, so asking again starts from zero: once the time
      // limit cut a search short, the ladder would restart it at the same depth
      // forever. Ask such an engine once for the whole depth and let Max Time be
      // the answer; `askedInFullKey` is what keeps the loop from re-asking.
      const canExtendSearch = engineCanExtendSearch(get().settings);
      let askedInFullKey: string | null = null;
      void (async () => {
          while (true) {
              const state = get();
              if (token !== continuousToken) return;
              if (!state.isContinuousAnalysis) return;
              if (!state.isAnalysisMode) return;

              // Clamped, or the loop below never settles. `runAnalysis` caps
              // what it will actually request at ENGINE_MAX_VISITS, so a target
              // above that leaves `normalizedVisits < target` true forever and
              // re-runs a full search every 50ms for as long as the tab is open.
              const target = clampAnalysisVisits(state.settings.katagoVisits);
              const rawFast = state.settings.katagoFastVisits;
              const fast = Number.isFinite(rawFast) ? rawFast : 25;
              const initialVisits = Math.max(16, Math.min(target, Math.floor(fast)));
              const node = state.currentNode;

              let nextVisits: number;
              if (canExtendSearch) {
                  const normalizedVisits = nodeAnalysisVisitCount(node);
                  if (normalizedVisits < 1) {
                      nextVisits = initialVisits;
                  } else if (normalizedVisits < target) {
                      const bumped = Math.max(normalizedVisits + 1, normalizedVisits * 2);
                      nextVisits = Math.min(target, Math.max(initialVisits, bumped));
                  } else {
                      await sleep(500);
                      continue;
                  }
              } else {
                  // A position that has already been asked for in full is done,
                  // whether the search reached the target or Max Time decided the
                  // answer: a remote engine starts every query from zero, so
                  // asking again would just run the same search again. Both the
                  // achieved visits and the requested depth are remembered on
                  // the node, so this holds when the user navigates back to it.
                  const askedFor = Math.max(nodeAnalysisVisitCount(node), node.analysisVisitsRequested ?? 0);
                  if (askedFor >= target) {
                      await sleep(500);
                      continue;
                  }
                  // The node id is in the key because a new game can start from
                  // the same position, and the position key because a setup edit
                  // changes the stones in place. The time budget is not in it: it
                  // only decides how far a single request gets, and a request that
                  // Max Time cut short was already asked for this depth, so asking
                  // again would just repeat the search.
                  const fullKey = `${node.id}|${nodeAnalysisPositionKey(node, state.settings.gameRules)}|${target}`;
                  if (askedInFullKey === fullKey) {
                      await sleep(500);
                      continue;
                  }
                  askedInFullKey = fullKey;
                  nextVisits = target;
              }

              await get().runAnalysis({
                force: true,
                ifIdle: true,
                visits: nextVisits,
                reuseTree: true,
                ownershipRefreshIntervalMs: state.settings.katagoOwnershipMode === 'tree' ? 500 : undefined,
              });
              if (get().engineStatus === 'error') {
                  // A dead engine rejects at once; retrying every 50ms raised
                  // an identical error toast as fast as one could be dismissed.
                  errorBackoffMs = Math.min(30_000, errorBackoffMs * 2);
                  // Let the retry go out after the backoff rather than counting
                  // the failed request as the full-depth attempt.
                  askedInFullKey = null;
                  await sleep(errorBackoffMs);
                  continue;
              }
              errorBackoffMs = 1000;
              await sleep(50);
          }
      })();
  },

  stopAnalysis: () => {
      // Stop is for analysis -- pondering, a review, play-to-end -- and it is
      // what Escape does, so it runs whenever a dialog is closed that way. It
      // still stops a one-off "AI move" the player asked for. It used to
      // cancel the AI opponent's reply as well, with nothing to start it
      // again: Escape on the AI's turn left the game waiting for a move that
      // never came. The opponent is stopped by turning it off.
      if (aiMoveWorkIsOnDemand) {
        cancelAiMoveWork();
        set({ isAiThinking: false });
      }
      continuousToken++;
      cancelScheduledAnalysis();
      analysisQueue.cancelGroup('interactive');
      analysisQueue.cancelGroup('tenuki');
      // A sweep/equalize batch is a background scan the user may want to call
      // off on its own; its results are already folded in one at a time.
      analysisQueue.cancelGroup('refine');
      // The trick-move scan is the same kind of batch, and it also writes no
      // results to the tree, so stopping drops nothing the reader can see.
      trickToken++;
      analysisQueue.cancelGroup('trick');
      // Cancelling an *active* queue job only aborts its signal; the rejection
      // arrives when the engine call finally settles. Waiting for that would
      // leave the play-elsewhere readout saying "Checking..." after the user
      // pressed stop, so the readout is dropped here and the late rejection is
      // ignored by its token.
      tenukiToken++;
      set({
        isContinuousAnalysis: false,
        engineStatus: 'idle',
        engineError: null,
        tenukiAnalysis: null,
        isTrickScanRunning: false,
      });
  },

  clearTenukiAnalysis: () => set({ tenukiAnalysis: null }),

  /**
   * Ask what the move here is worth, by evaluating the same position after the
   * side to move passes. The engine then reports what the opponent does with
   * the point, and the gap between the two leads prices it.
   *
   * Deliberately not routed through `runAnalysis`: that writes onto the current
   * node, and this describes a position that was never played. It would end up
   * in exported SGF as though it had been, and it would overwrite the live
   * analysis the board is drawing.
   */
  analyzeTenuki: () => {
    const state = get();
    const node = state.currentNode;
    const current = node.analysis;

    if (!current || !Number.isFinite(current.rootScoreLead)) {
      set({ notification: { message: 'Analyze the position first, then ask what playing elsewhere costs.', type: 'error' } });
      return;
    }

    const sideToMove = state.currentPlayer;
    const opponent: Player = sideToMove === 'black' ? 'white' : 'black';
    const passMove: Move = { x: -1, y: -1, player: sideToMove };
    const rules = state.settings.gameRules;
    const boardSize = getBoardSizeFromBoard(state.board);
    const komi = komiWithHandicapBonus(state.rootNode.gameState.board, rules, state.komi);
    const modelUrl = resolveModelUrlForFetch(state.settings.katagoModelUrl);
    const visits = clampAnalysisVisits(state.settings.katagoVisits);
    const maxTimeMs = Math.max(25, Math.min(state.settings.katagoMaxTimeMs, ENGINE_MAX_TIME_MS));

    // A pass leaves the stones alone, so the post-pass position sees the same
    // board with the turn handed over and one more entry in the history.
    const moveHistory = [...state.moveHistory, passMove];
    const beforePassHistory = repetitionHistoryForNode(node, rules);
    const repetitionHistory = beforePassHistory
      ? [...new Set([...beforePassHistory, situationalKey(state.board, opponent)])].sort()
      : undefined;
    const positionKey = makeAnalysisPositionKey({
      board: state.board,
      currentPlayer: opponent,
      moveHistory,
      repetitionHistory,
      komi,
      rules,
    });

    // A second press supersedes the first through `staleKey`, and the loser
    // rejects *after* the winner may already have resolved. Both handlers below
    // check this token so a late rejection cannot clobber a newer answer.
    const requestToken = ++tenukiToken;
    const ownsResult = (s: GameStore) =>
      requestToken === tenukiToken && s.tenukiAnalysis?.nodeId === node.id;

    set({
      tenukiAnalysis: {
        nodeId: node.id,
        status: 'running',
        sideToMove,
        value: null,
        followUp: null,
        afterPass: null,
      },
    });

    void analysisQueue
      .enqueue<KataGoAnalysisPayload>({
        id: `tenuki:${node.id}`,
        label: 'Play elsewhere',
        group: 'tenuki',
        priority: ANALYSIS_QUEUE_PRIORITY.tenuki,
        staleKey: 'tenuki-analysis',
        cacheKey: analysisCacheKey('tenuki', positionKey, modelUrl, state.settings.katagoBackend, visits),
        run: (ctx) =>
          getEngineClient(get().settings).analyze({
            // A distinct position id, and `reuseTree` off: the worker keeps a
            // search tree per position, and letting it re-root the live tree
            // onto a position the player never entered would slow or skew the
            // next interactive pass.
            positionId: `${node.id}:pass`,
            positionKey,
            modelUrl,
            backend: state.settings.katagoBackend,
            board: state.board,
            previousBoard: state.board,
            previousPreviousBoard: koReferenceBoard(node),
            currentPlayer: opponent,
            moveHistory,
            repetitionHistory,
            komi,
            rules,
            topK: Math.max(1, Math.min(state.settings.katagoTopK, 50)),
            analysisPvLen: state.settings.katagoAnalysisPvLen,
            visits,
            maxTimeMs,
            batchSize: Math.max(1, Math.min(state.settings.katagoBatchSize, 64)),
            maxChildren: Math.max(4, Math.min(state.settings.katagoMaxChildren, boardSize * boardSize)),
            reuseTree: false,
            ownershipMode: 'none',
            // Background, not interactive: this must not supersede the live
            // analysis the board is drawing.
            analysisGroup: 'background',
            conservativePass: state.settings.katagoConservativePass,
            rootPolicyTemperature: state.settings.katagoRootPolicyTemperature,
            fillDameBeforePass: state.settings.katagoFillDameBeforePass,
            priority: ctx.priority,
            signal: ctx.signal,
          }),
      })
      .then((payload) => {
        // The player may have moved on while this ran; the readout belongs to
        // the node it was asked about, not to wherever they are now.
        const afterPass: AnalysisResult = {
          rootWinRate: payload.rootWinRate,
          rootScoreLead: payload.rootScoreLead,
          rootVisits: payload.rootVisits,
          moves: payload.moves,
          territory: createEmptyTerritory(boardSize),
        };
        const value = computeTenukiValue({
          sideToMove,
          scoreLeadNow: current.rootScoreLead,
          scoreLeadAfterPass: payload.rootScoreLead,
        });
        set((s) =>
          ownsResult(s)
            ? {
                tenukiAnalysis: {
                  nodeId: node.id,
                  status: 'ready',
                  sideToMove,
                  value,
                  followUp: opponentFollowUp(afterPass),
                  afterPass,
                },
              }
            : {}
        );
      })
      .catch((err: unknown) => {
        // `isAnalysisCanceled` covers all three: the engine cancelling, the
        // queue cancelling, and the queue superseding this job with a newer
        // press. Only the KataGo case was handled at first, so a second press
        // rejected the first as a *failure* and could overwrite the answer the
        // second had already produced.
        if (isAnalysisCanceled(err)) {
          set((s) => (ownsResult(s) ? { tenukiAnalysis: null } : {}));
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        set((s) =>
          ownsResult(s)
            ? {
                tenukiAnalysis: {
                  nodeId: node.id,
                  status: 'error',
                  sideToMove,
                  value: null,
                  followUp: null,
                  afterPass: null,
                  error: message,
                },
              }
            : {}
        );
      });
  },

  /**
   * Scan this position's candidates for "trick moves": moves that leave the
   * opponent exactly one reply which does not throw points away.
   *
   * Quick, equal-depth reads at the fast-review depth, the way the Equalize
   * action reads: one query per candidate analyses the position after it, and
   * one query per reply equalizes the replies so the second-best reply's value
   * is not just the one or two visits a normal search would give it. Nothing is
   * written to the tree -- the after-move positions were never played, and the
   * board still draws whatever analysis the reader already has. The marks carry
   * this node's id instead, like the play-elsewhere read.
   *
   * The framed region (`g`) decides which of the reader's own candidates are
   * tested. The opponent's replies are judged without it: the question is
   * whether they have another good move, not whether they have one inside the
   * box.
   */
  findTrickMoves: () => {
    const state = get();
    if (state.isTrickScanRunning) {
      get().stopTrickScan();
      return;
    }

    const node = state.currentNode;
    const rules = state.settings.gameRules;
    const boardSize = getBoardSizeFromBoard(node.gameState.board);
    const modelUrl = resolveModelUrlForFetch(state.settings.katagoModelUrl);
    const fastVisits = clampAnalysisVisits(state.settings.katagoFastVisits);
    const maxTimeMs = Math.max(250, Math.min(state.settings.katagoMaxTimeMs, ENGINE_MAX_TIME_MS));
    const batchSize = Math.max(1, Math.min(state.settings.katagoBatchSize, 64));
    const maxChildren = Math.max(4, Math.min(state.settings.katagoMaxChildren, boardSize * boardSize));
    const topK = Math.max(1, Math.min(state.settings.katagoTopK, 50));
    const roi = state.regionOfInterest;
    const mover = node.gameState.currentPlayer;
    const opponent: Player = mover === 'black' ? 'white' : 'black';
    const komi = komiWithHandicapBonus(state.rootNode.gameState.board, rules, node.gameState.komi);
    const parentBoard = node.parent?.gameState.board;
    const grandparentBoard = node.parent?.parent?.gameState.board;
    const token = ++trickToken;
    const ownsRun = () => token === trickToken && get().currentNode.id === node.id;
    const stopIfLeft = () => {
      if (ownsRun()) return false;
      // Navigation retires the scan: what it would report belongs to a position
      // the reader has left.
      if (token === trickToken) get().stopTrickScan();
      return true;
    };

    // Every legal point is a candidate: the scan is a full-board search, not
    // just the moves the live read happens to rank. A framed region narrows it
    // to the points the reader asked about.
    const candidates = getLegalMoves(node.gameState.board, mover, parentBoard, {
      multiStoneSuicideLegal: isSuicideLegal(rules),
    }).filter(
      (move) => !roi || (move.x >= roi.xMin && move.x <= roi.xMax && move.y >= roi.yMin && move.y <= roi.yMax)
    );

    // One read per position: the candidate's follow-up, or (once) the current
    // position when the board has no analysis to take its winrate from. All are
    // pushed to the queue together, so the remote engine can batch them across
    // its threads instead of being handed one position at a time.
    const queryPosition = (args: {
      suffix: string;
      label: string;
      currentPlayer: Player;
      nextMove?: Move;
      regionOfInterest?: RegionOfInterest | null;
    }) =>
      analysisQueue.enqueue<KataGoAnalysisPayload>({
        id: `trick:${token}:${args.suffix}`,
        label: args.label,
        group: 'trick',
        priority: ANALYSIS_QUEUE_PRIORITY.trick,
        bypassCache: true,
        run: (ctx) =>
          getEngineClient(get().settings).analyze({
            positionId: `${node.id}:trick:${args.suffix}`,
            modelUrl,
            backend: get().settings.katagoBackend,
            board: node.gameState.board,
            previousBoard: parentBoard,
            previousPreviousBoard: grandparentBoard,
            currentPlayer: args.currentPlayer,
            moveHistory: node.gameState.moveHistory,
            nextMove: args.nextMove,
            komi,
            rules,
            regionOfInterest: args.regionOfInterest ?? null,
            // Only the root value and the reply list are needed: these reads
            // exist to compare the opponent's answers, not to draw a line.
            topK,
            analysisPvLen: 1,
            includeMovesOwnership: false,
            visits: fastVisits,
            maxTimeMs,
            batchSize,
            maxChildren,
            reuseTree: false,
            ownershipMode: 'none',
            conservativePass: get().settings.katagoConservativePass,
            rootPolicyTemperature: get().settings.katagoRootPolicyTemperature,
            wideRootNoise: get().settings.katagoWideRootNoise,
            fillDameBeforePass: get().settings.katagoFillDameBeforePass,
            nnRandomize: get().settings.katagoNnRandomize,
            // Background, not interactive: the live read must stay authoritative.
            analysisGroup: 'background',
            priority: ctx.priority,
            signal: ctx.signal,
          }),
      });

    if (candidates.length === 0) {
      set({
        isTrickScanRunning: false,
        trickScanDone: 0,
        trickScanTotal: 0,
        trickMoves: { nodeId: node.id, marks: [] },
        notification: { message: 'No legal points to test here.', type: 'info' },
      });
      return;
    }

    // The winrate the opponent stands at *before* the candidate (the board's own
    // winrate). Prefer the analysis the reader is looking at; without one, the
    // scan reads the position once itself.
    const analysisWinRate = node.analysis?.rootWinRate;
    let baselineWinRate: number | null =
      typeof analysisWinRate === 'number' && Number.isFinite(analysisWinRate) ? analysisWinRate : null;

    set({
      isTrickScanRunning: true,
      trickScanDone: 0,
      trickScanTotal: candidates.length,
      trickMoves: { nodeId: node.id, marks: [] },
    });

    void (async () => {
      const marks: TrickMoveMark[] = [];
      let done = 0;
      let firstError: unknown = null;

      try {
        if (baselineWinRate === null) {
          const base = await queryPosition({
            suffix: 'position',
            label: 'Trick: position',
            currentPlayer: mover,
            regionOfInterest: roi,
          });
          if (stopIfLeft()) return;
          baselineWinRate = base.rootWinRate;
        }
        const baseline = baselineWinRate;
        if (typeof baseline !== 'number' || !Number.isFinite(baseline)) {
          set({
            isTrickScanRunning: false,
            notification: { message: 'Trick scan: the engine returned no winrate for this position.', type: 'error' },
          });
          return;
        }

        await Promise.all(
          candidates.map(async (candidate) => {
            if (stopIfLeft()) return;
            try {
              const replies = await queryPosition({
                suffix: `${candidate.x},${candidate.y}`,
                label: `Trick: ${gtpOf(candidate.x, candidate.y, boardSize)}`,
                currentPlayer: opponent,
                nextMove: { x: candidate.x, y: candidate.y, player: mover },
              });
              if (stopIfLeft()) return;
              // The opponent's candidates as the app would list them; a remote
              // engine reports every move it looked at, not the Top Moves cap.
              const evaluation = evaluateTrickReplies({
                replies: replies.moves.slice(0, topK).map((move) => ({
                  scoreLead: move.scoreLead,
                  winRate: move.winRate,
                })),
                rootScoreLead: replies.rootScoreLead,
                baselineWinRate: baseline,
                mover: opponent,
              });
              if (evaluation.isTrick) {
                marks.push({ x: candidate.x, y: candidate.y, secondLoss: evaluation.secondLoss ?? 0 });
                set({ trickMoves: { nodeId: node.id, marks: [...marks] } });
              }
            } catch (err) {
              if (!isAnalysisCanceled(err) && firstError === null) firstError = err;
            } finally {
              done++;
              // A stopped or superseded scan must not keep writing progress
              // into a newer run's counters.
              if (token === trickToken && (done === candidates.length || done % 4 === 0)) {
                set({ trickScanDone: done, trickScanTotal: candidates.length });
              }
            }
          })
        );
      } catch (err) {
        if (token !== trickToken) return;
        const message = errorMessage(err);
        set({
          isTrickScanRunning: false,
          engineStatus: 'error',
          engineError: message,
          notification: { message: `Trick scan failed: ${message}`, type: 'error' },
        });
        return;
      }

      if (stopIfLeft()) return;
      if (firstError !== null) {
        const message = errorMessage(firstError);
        set({
          isTrickScanRunning: false,
          engineStatus: 'error',
          engineError: message,
          notification: { message: `Trick scan failed: ${message}`, type: 'error' },
        });
        return;
      }
      set({
        isTrickScanRunning: false,
        trickScanDone: done,
        trickScanTotal: candidates.length,
        trickMoves: { nodeId: node.id, marks },
        notification: {
          message: marks.length === 0 ? 'No trick moves here.' : `Trick moves: ${marks.length}.`,
          type: 'info',
        },
      });
    })();
  },

  stopTrickScan: () => {
    trickToken++;
    analysisQueue.cancelGroup('trick', 'Trick-move scan stopped');
    set({ isTrickScanRunning: false });
  },

  clearAnalysisCache: () => {
      cancelAiMoveWork();
      analysisRevision++;
      cancelScheduledAnalysis();
      const removed = getAnalysisCacheSize(get().rootNode);
      const notification = {
        message: removed > 0 ? `Cleared ${removed} cached ${removed === 1 ? 'analysis' : 'analyses'}.` : 'No cached analysis to clear.',
        type: 'info' as const,
      };
      continuousToken++;
      selfplayToken++;
      gameAnalysisToken++;
      analysisQueue.cancelWhere(() => true, 'Cleared analysis cache');
      analysisQueue.clearCache();
      set((state) => {
        clearAnalysisInSubtree(state.rootNode);
        return {
          analysisData: null,
          analysisCacheSize: 0,
          isAiThinking: false,
          isContinuousAnalysis: false,
          isSelfplayToEnd: false,
          setupPositionProgress: null,
          isGameAnalysisRunning: false,
          gameAnalysisType: null,
          engineStatus: 'idle',
          engineError: null,
          treeVersion: state.treeVersion + 1,
          notification,
        };
      });
      // Clearing cancels the AI's search along with everything else; on its
      // turn it has to start again, or it never moves.
      get().scheduleAiMove(100);
  },

  toggleTeachMode: () => set((state) => {
      const newMode = !state.isTeachMode;
      if (newMode) {
           // Teach mode implies analysis
           scheduleAnalysis(() => void get().runAnalysis({ ifIdle: true }), 0);
      }
      return {
          isTeachMode: newMode,
          // If turning on Teach Mode, ensure Analysis Mode is also on (usually)
          isAnalysisMode: newMode ? true : state.isAnalysisMode
      };
  }),

  clearNotification: () => set({ notification: null }),

  toggleTimerPaused: () => set((state) => ({ timerPaused: !state.timerPaused })),

  startSelectRegionOfInterest: () =>
    set(() => ({
      isSelectingRegionOfInterest: true,
    })),

  cancelSelectRegionOfInterest: () =>
    set(() => ({
      isSelectingRegionOfInterest: false,
    })),

  setRegionOfInterest: (roi) => {
    const normalized = normalizeRegionOfInterest(roi, getBoardSizeFromBoard(get().board));
    set((state) => ({
      regionOfInterest: normalized,
      isSelectingRegionOfInterest: false,
      treeVersion: state.treeVersion + 1,
    }));
    if (get().isAnalysisMode) scheduleAnalysis(() => void get().runAnalysis({ force: true }), 0);
  },

  resetCurrentAnalysis: () => {
    const s = get();
    s.currentNode.analysis = null;
    s.currentNode.analysisVisitsRequested = 0;
    set((state) => ({ analysisData: null, treeVersion: state.treeVersion + 1 }));
    if (get().isAnalysisMode) scheduleAnalysis(() => void get().runAnalysis({ force: true }), 0);
  },

  analyzeExtra: (mode) => {
    const s = get();
    if (mode === 'stop') {
      s.stopAnalysis();
      s.stopSelfplayToEnd();
      s.stopSetupPositionGeneration();
      s.stopGameAnalysis();
      return;
    }

    if (!s.isAnalysisMode) set({ isAnalysisMode: true });

    const longTimeMs = ENGINE_MAX_TIME_MS;

    const toast = (message: string) => {
      const notification = { message, type: 'info' as const };
      set({ notification });
    };

    /**
     * Deepen each candidate move in a query of its own — KaTrain's `refine_move`.
     *
     * The engine answers with the value of the position *after* the move, which
     * becomes that candidate's entry on this node. One query per candidate is
     * what lets a remote engine spread them across its analysis threads; the
     * local worker instead widens the root of a single search, so it keeps the
     * single-query paths below.
     */
    const refineCandidates = (
      node: GameNode,
      candidates: Array<{ x: number; y: number }>,
      visits: number,
      label: string,
      priority: number,
    ) => {
      const rules = s.settings.gameRules;
      const boardSize = getBoardSizeFromBoard(s.board);
      const opponent: Player = s.currentPlayer === 'black' ? 'white' : 'black';
      const modelUrl = resolveModelUrlForFetch(s.settings.katagoModelUrl);
      const komi = komiWithHandicapBonus(s.rootNode.gameState.board, rules, s.komi);
      const positionKey = nodeAnalysisPositionKey(node, rules);
      const nodeId = node.id;
      const token = ++refineToken;

      void Promise.allSettled(
        candidates.map((candidate) =>
          analysisQueue
            .enqueue<KataGoAnalysisPayload>({
              id: `refine:${nodeId}:${candidate.x},${candidate.y}`,
              label: `${label} ${gtpOf(candidate.x, candidate.y, boardSize)}`,
              group: 'refine',
              priority,
              cacheKey: analysisCacheKey(
                'refine',
                nodeId,
                positionKey,
                candidate.x,
                candidate.y,
                visits,
                modelUrl,
                s.settings.katagoBackend,
                rules,
              ),
              run: (ctx) =>
                getEngineClient(get().settings).analyze({
                  // A distinct position id per candidate: the local worker keys
                  // its kept search tree on it (unused on the remote path).
                  positionId: `${nodeId}:refine:${candidate.x},${candidate.y}`,
                  positionKey,
                  modelUrl,
                  backend: s.settings.katagoBackend,
                  // The board *before* the move; `nextMove` appends it.
                  board: s.board,
                  previousBoard: s.board,
                  previousPreviousBoard: node.parent?.gameState.board,
                  currentPlayer: opponent,
                  moveHistory: s.moveHistory,
                  nextMove: { x: candidate.x, y: candidate.y, player: s.currentPlayer },
                  komi,
                  rules,
                  topK: 10,
                  analysisPvLen: Math.max(0, Math.min(s.settings.katagoAnalysisPvLen, 30)),
                  includeMovesOwnership: false,
                  ownershipMode: 'none',
                  reuseTree: false,
                  visits,
                  maxTimeMs: longTimeMs,
                  analysisGroup: 'background',
                  priority: ctx.priority,
                  signal: ctx.signal,
                }),
            })
            .then((analysis) => {
              if (token !== refineToken) return;
              const current = get();
              const target = current.currentNode.id === nodeId ? current.currentNode : node;
              const merged = mergedWithRefinedCandidate(target.analysis, candidate, analysis, boardSize);
              if (!merged) return;
              target.analysis = merged;
              set((state) => ({
                analysisData: state.currentNode.id === nodeId ? merged : state.analysisData,
                analysisCacheSize: getAnalysisCacheSize(state.rootNode),
                treeVersion: state.treeVersion + 1,
              }));
            }),
        ),
      ).then((results) => {
        if (token !== refineToken) return;
        const failures = results.filter(
          (entry): entry is PromiseRejectedResult => entry.status === 'rejected' && !isAnalysisCanceled(entry.reason),
        );
        if (failures.length === 0) {
          toast(`${label}: ${candidates.length} candidates done.`);
          return;
        }
        const message = errorMessage(failures[0]!.reason);
        set({
          engineStatus: 'error',
          engineError: message,
          notification: {
            message: `${label}: ${failures.length} of ${candidates.length} candidates failed: ${message}`,
            type: 'error' as const,
          },
        });
      });
    };

    if (mode === 'extra') {
      const base = clampAnalysisVisits(s.settings.katagoVisits);
      const prev = Math.max(0, Math.min(s.currentNode.analysisVisitsRequested ?? base, ENGINE_MAX_VISITS));
      const visits = clampAnalysisVisits(prev + base);
      toast(`Extra analysis: ${visits} visits.`);
      void s.runAnalysis({ force: true, visits, maxTimeMs: longTimeMs });
      return;
    }

    if (mode === 'equalize') {
      const analysis = s.currentNode.analysis;
      if (!analysis || analysis.moves.length === 0) {
        toast('Equalize: wait for analysis first.');
        return;
      }
      const maxMoveVisits = analysis.moves.reduce((acc, cur) => Math.max(acc, cur.visits), 1);
      const target = Math.max(maxMoveVisits * analysis.moves.length, s.currentNode.analysisVisitsRequested ?? s.settings.katagoVisits);
      const visits = clampAnalysisVisits(target);
      if (isRemoteEngine(s.settings)) {
        toast(`Equalize: ${analysis.moves.length} candidates at ${visits} visits.`);
        refineCandidates(
          s.currentNode,
          analysis.moves.map((m) => ({ x: m.x, y: m.y })),
          visits,
          'Equalize',
          ANALYSIS_QUEUE_PRIORITY.equalize,
        );
        return;
      }
      toast(`Equalize: ${visits} visits.`);
      void s.runAnalysis({ force: true, visits, maxTimeMs: longTimeMs, allowShallower: true });
      return;
    }

    if (mode === 'sweep') {
      const visits = clampAnalysisVisits(s.settings.katagoFastVisits);
      if (isRemoteEngine(s.settings)) {
        const node = s.currentNode;
        toast(`Sweep: ${visits} visits per candidate.`);
        void (async () => {
          // Refined entries live on the node's move list, so a first pass has to
          // have filled it (KaTrain assumes the same).
          if (!node.analysis?.moves.length) {
            await get().runAnalysis({ force: true, visits, maxTimeMs: longTimeMs, allowShallower: true });
          }
          if (get().currentNode.id !== node.id) return;
          const moves = node.analysis?.moves ?? [];
          if (moves.length === 0) return;
          refineCandidates(
            node,
            moves.map((m) => ({ x: m.x, y: m.y })),
            visits,
            'Sweep',
            ANALYSIS_QUEUE_PRIORITY.sweep,
          );
        })();
        return;
      }
      const boardSize = getBoardSizeFromBoard(s.board);
      const maxChildren = boardSize * boardSize;
      toast(`Sweep: ${visits} visits, maxChildren ${maxChildren}.`);
      void s.runAnalysis({
        force: true,
        visits,
        maxChildren,
        topK: Math.max(s.settings.katagoTopK, 20),
        reuseTree: false,
        maxTimeMs: longTimeMs,
        allowShallower: true,
      });
      return;
    }

    if (mode === 'without-top') {
      const candidates = s.currentNode.analysis?.moves ?? [];
      const top = candidates.find((m) => m.order === 0) ?? candidates[0] ?? null;
      if (!top || top.x < 0 || top.y < 0) {
        set({ notification: { message: 'Analyze the position first, then ask what else there is.', type: 'error' } });
        return;
      }
      const label = formatGtpMove(top.x, top.y, s.board.length);
      const visits = clampAnalysisVisits(s.settings.katagoVisits);
      toast(`Analyzing without ${label}: ${visits} visits.`);
      void s.runAnalysis({
        force: true,
        visits,
        reuseTree: false,
        maxTimeMs: longTimeMs,
        avoidMoves: [{ x: top.x, y: top.y }],
        allowShallower: true,
      });
      return;
    }

    if (mode === 'alternative') {
      const visits = clampAnalysisVisits(s.settings.katagoFastVisits);
      const wideRootNoise = Math.max(s.settings.katagoWideRootNoise, 0.12);
      toast(`Alternative: ${visits} visits, noise ${wideRootNoise.toFixed(2)}.`);
      void s.runAnalysis({
        force: true,
        visits,
        wideRootNoise,
        reuseTree: false,
        maxTimeMs: longTimeMs,
        allowShallower: true,
      });
    }
  },

  toggleInsertMode: () => {
    const s = get();
    if (!s.isInsertMode) {
      if (s.currentNode.children.length === 0) {
        const notification = { message: 'Insert mode: no continuation to insert into.', type: 'error' as const };
        set({ notification });
        return;
      }
      const insertAfter = getActiveChild(s.currentNode, s.activeBranchChildIds);
      if (!insertAfter) {
        const notification = { message: 'Insert mode: no continuation to insert into.', type: 'error' as const };
        set({ notification });
        return;
      }
      set((state) => ({
        isInsertMode: true,
        insertAfterNodeId: insertAfter.id,
        insertAnchorNodeId: state.currentNode.id,
        treeVersion: state.treeVersion + 1,
      }));
      return;
    }

    const insertAfterId = s.insertAfterNodeId;
    const anchorId = s.insertAnchorNodeId;
    if (!insertAfterId || !anchorId) {
      set({ isInsertMode: false, insertAfterNodeId: null, insertAnchorNodeId: null });
      return;
    }

    const insertAfter = findNodeById(s.rootNode, insertAfterId);
    const anchor = findNodeById(s.rootNode, anchorId);
    if (!insertAfter || !anchor || insertAfter.parent?.id !== anchor.id) {
      set({ isInsertMode: false, insertAfterNodeId: null, insertAnchorNodeId: null, treeVersion: s.treeVersion + 1 });
      return;
    }

    if (s.currentNode.id === anchor.id) {
      set((state) => ({
        isInsertMode: false,
        insertAfterNodeId: null,
        insertAnchorNodeId: null,
        treeVersion: state.treeVersion + 1,
      }));
      return;
    }

    // Copy continuation from insertAfter down its mainline onto the inserted branch.
    const insertedMoves = new Set<string>();
    let numInserted = 0;
    {
      const above = new Set<string>();
      let n: GameNode | null = insertAfter;
      while (n) {
        above.add(n.id);
        n = n.parent;
      }
      let cur: GameNode | null = s.currentNode;
      while (cur && !above.has(cur.id)) {
        if (cur.move) {
          insertedMoves.add(moveKey(cur.move));
          numInserted += 1;
        }
        cur = cur.parent;
      }
    }

    // How much continuation there is to carry over, so a copy that stops short
    // can be reported rather than left as a branch that simply ends.
    let numToCopy = 0;
    {
      let from: GameNode | null = insertAfter;
      while (from?.move) {
        if (!insertedMoves.has(moveKey(from.move))) numToCopy += 1;
        from = getActiveChild(from, s.activeBranchChildIds);
      }
    }

    let numCopied = 0;
    let from: GameNode | null = insertAfter;
    let to: GameNode = s.currentNode;


    while (from) {
      const move = from.move;
      if (!move) break;
      if (!insertedMoves.has(moveKey(move))) {
        const child = createChildForMove(to, move, isSuicideLegal(s.settings.gameRules), rulesOf(s.settings.gameRules).ko);
        if (!child) break;
        // The copy carries the move's comment, markup and drawings, as
        // KaTrain's insert mode copies each node's properties; bare copies
        // lost them, for good once the original line was deleted. Analysis
        // stays behind: the inserted moves changed the position it was for.
        child.properties = cloneNodeProperties(from.properties);
        delete child.properties.KT;
        delete child.properties.KA;
        if (from.note) child.note = from.note;
        const drawings = cloneDrawings(from.drawings);
        if (drawings) child.drawings = drawings;
        applySetupPropsToNode(child, child.properties);
        to = child;
        numCopied++;
      }
      from = getActiveChild(from, s.activeBranchChildIds);
    }

    /**
     * Say so when the continuation did not come with it.
     *
     * Each copied move keeps its own colour, so an *odd* number of inserted
     * moves puts the whole rest of the game on the wrong side: the first copy
     * is refused, the loop breaks, and the inserted branch stops dead at the
     * move just played. Measured before this: inserting one move copied 0 of 5
     * continuation moves -- and reported nothing at all, because the message
     * was written only for the success case, so the previous toast was left
     * standing and the operation looked like it had worked. The moves are all
     * still on the original branch, so nothing is lost; what was missing was
     * any way to find out it had not worked.
     */
    const numMissing = numToCopy - numCopied;
    const notification = numMissing > 0
      ? {
        message: numInserted % 2 === 1
          ? `Insert mode ended: ${numInserted} inserted move${numInserted === 1 ? ' puts' : 's put'} the rest of the game on the other color, so ${numMissing} of ${numToCopy} continuation move${numToCopy === 1 ? '' : 's'} could not follow. Insert in pairs to carry the continuation with you.`
          : `Insert mode ended: ${numMissing} of ${numToCopy} continuation move${numToCopy === 1 ? '' : 's'} could not be replayed after the insert.`,
        type: 'error' as const,
      }
      : numCopied > 0 ? { message: `Insert mode ended: copied ${numCopied} moves.`, type: 'info' as const } : null;
    set((state) => ({
      ...clearEditHistory(),
      isInsertMode: false,
      insertAfterNodeId: null,
      insertAnchorNodeId: null,
      treeVersion: state.treeVersion + 1,
      notification: notification ?? state.notification,
    }));
  },

  toggleEditMode: () =>
    set((state) => ({
      isEditMode: !state.isEditMode,
      isSelectingRegionOfInterest: false,
      notification: !state.isEditMode
        ? { message: 'Edit mode: setup stones, labels, and markers are active.', type: 'info' }
        : null,
    })),

  setEditTool: (tool) =>
    set(() => ({
      editTool: tool,
      isEditMode: true,
      isSelectingRegionOfInterest: false,
    })),

  clearCurrentNodeAnnotations: () =>
    set((state) => {
      const props = ensureNodeProperties(state.currentNode);
      const clearKeys = [...MARKER_PROPERTIES, ...SEGMENT_PROPERTIES, 'LB'];
      const changed = clearKeys.some((key) => !!props[key]?.length);
      if (!changed) return {};
      const history = pushEditHistory(state);
      for (const key of clearKeys) delete props[key];
      return {
        ...history,
        treeVersion: state.treeVersion + 1,
        notification: { message: 'Cleared markers, labels, arrows and lines on this node.', type: 'info', undoable: true },
      };
    }),

  addSegmentMarkup: (prop, sx, sy, ex, ey) =>
    set((state) => {
      const boardSize = state.board.length;
      const inRange = (x: number, y: number) => x >= 0 && y >= 0 && x < boardSize && y < boardSize;
      if (!inRange(sx, sy) || !inRange(ex, ey) || (sx === ex && sy === ey)) return {};
      const props = ensureNodeProperties(state.currentNode);
      const value = `${coordinateToSgf(sx, sy)}:${coordinateToSgf(ex, ey)}`;
      if (props[prop]?.includes(value)) return {};
      const history = pushEditHistory(state);
      addUniqueValue(props, prop, value);
      return {
        ...history,
        treeVersion: state.treeVersion + 1,
      };
    }),

  addNodeDrawing: (drawing) =>
    set((state) => {
      if (drawing.points.length < 2) return {};
      const node = state.currentNode;
      const history = pushEditHistory(state);
      node.drawings = [...(node.drawings ?? []), ...cloneDrawings([drawing])!];
      return { ...history, treeVersion: state.treeVersion + 1 };
    }),

  clearNodeDrawings: () =>
    set((state) => {
      const node = state.currentNode;
      if (!node.drawings?.length) return {};
      const history = pushEditHistory(state);
      node.drawings = [];
      return {
        ...history,
        treeVersion: state.treeVersion + 1,
        notification: { message: 'Cleared drawings on this node.', type: 'info', undoable: true },
      };
    }),

  applyEditTool: (x, y, options = {}) => {
    const boardBefore = get().board;
    set((state) => {
      const boardSize = state.board.length;
      if (x < 0 || y < 0 || x >= boardSize || y >= boardSize) return {};

      const node = state.currentNode;
      const props = ensureNodeProperties(node);
      const coord = coordinateToSgf(x, y);
      const tool = state.editTool;
      const markerProp = editToolToMarkerProperty(tool);

      if (markerProp) {
        const hasSameMarker = props[markerProp]?.includes(coord) ?? false;
        if (hasSameMarker) {
          if (options.paintOnly) return {};
          const history = pushEditHistory(state);
          removeValue(props, markerProp, (value) => value === coord);
          return {
            ...history,
            treeVersion: state.treeVersion + 1,
            notification: { message: `Removed ${markerProp} marker.`, type: 'info', undoable: true },
          };
        }

        const history = pushEditHistory(state);
        removeMarkupCoord(props, coord);
        addUniqueValue(props, markerProp, coord);
        return {
          ...history,
          treeVersion: state.treeVersion + 1,
          notification: { message: `Added ${markerProp} marker.`, type: 'info', undoable: true },
        };
      }

      if (tool === 'label-alpha' || tool === 'label-number') {
        // A drag that sweeps back over a label keeps it, as it keeps markers;
        // relabelling renamed A and B to E and D on the way past.
        if (options.paintOnly && (props.LB ?? []).some((value) => value.split(':', 1)[0] === coord)) return {};
        const history = pushEditHistory(state);
        removeMarkupCoord(props, coord);
        const label = tool === 'label-alpha' ? nextAlphaLabel(props) : nextNumberLabel(props);
        addUniqueValue(props, 'LB', `${coord}:${label}`);
        return {
          ...history,
          treeVersion: state.treeVersion + 1,
          notification: { message: `Added label ${label}.`, type: 'info', undoable: true },
        };
      }

      if (tool === 'marker-erase') {
        if (!hasMarkupCoord(props, coord)) return {};
        const history = pushEditHistory(state);
        removeMarkupCoord(props, coord);
        return {
          ...history,
          treeVersion: state.treeVersion + 1,
          notification: { message: 'Removed marker or label.', type: 'info', undoable: true },
        };
      }

      if (tool !== 'setup-black' && tool !== 'setup-white' && tool !== 'setup-alternate' && tool !== 'setup-erase') return {};

      const nextBoard = cloneBoard(node.gameState.board);
      const currentStone = nextBoard[y]?.[x] ?? null;
      const nextStone: Player | null =
        tool === 'setup-black'
          ? 'black'
          : tool === 'setup-white'
            ? 'white'
            : tool === 'setup-alternate'
              ? nextAlternateSetupStone(props, currentStone)
              : null;
      if (currentStone === nextStone) return {};
      const history = pushEditHistory(state);
      nextBoard[y]![x] = nextStone;

      removeSetupCoord(props, coord);
      if (nextStone === 'black') addUniqueValue(props, 'AB', coord);
      else if (nextStone === 'white') addUniqueValue(props, 'AW', coord);
      else addUniqueValue(props, 'AE', coord);

      node.gameState = { ...node.gameState, board: nextBoard };
      node.analysis = null;
      node.analysisVisitsRequested = 0;
      clearAnalysisInSubtree(node);
      const pruned = rebuildDescendants(node, isSuicideLegal(get().settings.gameRules));

      const setupWord =
        nextStone === 'black' ? 'black setup stone' : nextStone === 'white' ? 'white setup stone' : 'setup stone';
      const summary = pruned > 0 ? ` ${pruned} descendant ${pruned === 1 ? 'node was' : 'nodes were'} pruned.` : '';
      return {
        ...history,
        currentNode: node,
        board: node.gameState.board,
        currentPlayer: node.gameState.currentPlayer,
        moveHistory: node.gameState.moveHistory,
        capturedBlack: node.gameState.capturedBlack,
        capturedWhite: node.gameState.capturedWhite,
        analysisData: null,
        treeVersion: state.treeVersion + 1,
        notification: { message: `Edited ${setupWord}.${summary}`, type: pruned > 0 ? 'success' : 'info', undoable: true },
      };
    });
    if (get().board !== boardBefore) afterBoardEdit(get);
  },

  toggleBoardPointMarkup: (x, y) =>
    set((state) => {
      const boardSize = state.board.length;
      if (x < 0 || y < 0 || x >= boardSize || y >= boardSize) return {};

      const node = state.currentNode;
      const props = ensureNodeProperties(node);
      const coord = coordinateToSgf(x, y);

      if (state.isEditMode) {
        if (hasMarkupCoord(props, coord)) {
          const history = pushEditHistory(state);
          removeMarkupCoord(props, coord);
          return {
            ...history,
            treeVersion: state.treeVersion + 1,
            notification: { message: 'Removed marker or label.', type: 'info', undoable: true },
          };
        }

        const nextBoard = cloneBoard(node.gameState.board);
        const currentStone = nextBoard[y]?.[x] ?? null;
        if (!currentStone && !hasSetupCoord(props, coord)) return {};
        const history = pushEditHistory(state);
        nextBoard[y]![x] = null;
        removeSetupCoord(props, coord);
        addUniqueValue(props, 'AE', coord);

        node.gameState = { ...node.gameState, board: nextBoard };
        node.analysis = null;
        node.analysisVisitsRequested = 0;
        clearAnalysisInSubtree(node);
        const pruned = rebuildDescendants(node, isSuicideLegal(get().settings.gameRules));
        const summary = pruned > 0 ? ` ${pruned} descendant ${pruned === 1 ? 'node was' : 'nodes were'} pruned.` : '';
        return {
          ...history,
          currentNode: node,
          board: node.gameState.board,
          currentPlayer: node.gameState.currentPlayer,
          moveHistory: node.gameState.moveHistory,
          capturedBlack: node.gameState.capturedBlack,
          capturedWhite: node.gameState.capturedWhite,
          analysisData: null,
          treeVersion: state.treeVersion + 1,
          notification: { message: `Removed setup stone.${summary}`, type: pruned > 0 ? 'success' : 'info', undoable: true },
        };
      }

      const hasCross = props.MA?.includes(coord) ?? false;
      if (hasCross) {
        const history = pushEditHistory(state);
        removeValue(props, 'MA', (value) => value === coord);
        return {
          ...history,
          treeVersion: state.treeVersion + 1,
          notification: { message: 'Removed cross marker.', type: 'info', undoable: true },
        };
      }

      const history = pushEditHistory(state);
      removeMarkupCoord(props, coord);
      addUniqueValue(props, 'MA', coord);
      return {
        ...history,
        treeVersion: state.treeVersion + 1,
        notification: { message: 'Added cross marker.', type: 'info', undoable: true },
      };
    }),

  clearCurrentNodeSetupStones: () => {
    const boardBefore = get().board;
    set((state) => {
      const node = state.currentNode;
      const props = ensureNodeProperties(node);
      const setupCount = SETUP_PROPERTIES.reduce((total, key) => total + (props[key]?.length ?? 0), 0);
      if (setupCount === 0) return {};
      const history = pushEditHistory(state);
      const removed = removeSetupProperties(props);

      if (node.parent) {
        const rebuilt = replayChildMove(node.parent, node, isSuicideLegal(get().settings.gameRules));
        if (rebuilt) node.gameState = rebuilt;
      } else {
        const boardSize = getBoardSizeFromBoard(node.gameState.board);
        const board = createEmptyBoard(boardSize);
        const handicap = Number.parseInt(props.HA?.[0] ?? '0', 10);
        const safeHandicap = Number.isFinite(handicap) ? Math.max(0, Math.min(handicap, getMaxHandicap(boardSize))) : 0;
        if (safeHandicap > 0) applyHandicapStones(board, boardSize, safeHandicap);
        node.gameState = {
          ...node.gameState,
          board,
        };
      }

      node.analysis = null;
      node.analysisVisitsRequested = 0;
      clearAnalysisInSubtree(node);
      const pruned = rebuildDescendants(node, isSuicideLegal(get().settings.gameRules));
      const summary = pruned > 0 ? ` ${pruned} descendant ${pruned === 1 ? 'node was' : 'nodes were'} pruned.` : '';
      return {
        ...history,
        currentNode: node,
        board: node.gameState.board,
        currentPlayer: node.gameState.currentPlayer,
        moveHistory: node.gameState.moveHistory,
        capturedBlack: node.gameState.capturedBlack,
        capturedWhite: node.gameState.capturedWhite,
        analysisData: null,
        treeVersion: state.treeVersion + 1,
        notification: { message: `Cleared ${removed} setup stone${removed === 1 ? '' : 's'}.${summary}`, type: pruned > 0 ? 'success' : 'info', undoable: true },
      };
    });
    if (get().board !== boardBefore) afterBoardEdit(get);
  },

  applySetupStones: (stones) => {
    let changed = 0;
    set((state) => {
      const boardSize = state.board.length;
      const node = state.currentNode;
      const props = ensureNodeProperties(node);
      const nextBoard = cloneBoard(node.gameState.board);
      const hasChange = stones.some(
        (stone) =>
          stone.x >= 0 &&
          stone.y >= 0 &&
          stone.x < boardSize &&
          stone.y < boardSize &&
          (nextBoard[stone.y]?.[stone.x] ?? null) !== stone.player
      );
      if (!hasChange) return {};
      const history = pushEditHistory(state);

      for (const stone of stones) {
        if (stone.x < 0 || stone.y < 0 || stone.x >= boardSize || stone.y >= boardSize) continue;
        if ((nextBoard[stone.y]?.[stone.x] ?? null) === stone.player) continue;
        const coord = coordinateToSgf(stone.x, stone.y);
        nextBoard[stone.y]![stone.x] = stone.player;
        removeSetupCoord(props, coord);
        if (stone.player === 'black') addUniqueValue(props, 'AB', coord);
        else if (stone.player === 'white') addUniqueValue(props, 'AW', coord);
        else addUniqueValue(props, 'AE', coord);
        changed++;
      }

      if (changed === 0) return {};

      node.gameState = { ...node.gameState, board: nextBoard };
      node.analysis = null;
      node.analysisVisitsRequested = 0;
      clearAnalysisInSubtree(node);
      rebuildDescendants(node, isSuicideLegal(get().settings.gameRules));

      return {
        ...history,
        currentNode: node,
        board: node.gameState.board,
        currentPlayer: node.gameState.currentPlayer,
        moveHistory: node.gameState.moveHistory,
        capturedBlack: node.gameState.capturedBlack,
        capturedWhite: node.gameState.capturedWhite,
        analysisData: null,
        treeVersion: state.treeVersion + 1,
      };
    });
    if (changed > 0) afterBoardEdit(get);
    return changed;
  },

  /**
   * KaTrain's F10: wall the current problem off and fill the rest of the board,
   * so the engine reads the life and death instead of shrugging at a nearly
   * empty board. Added as a child node, leaving the bare problem in the tree.
   */
  frameAsTsumego: ({ margin, koAllowed }) => {
    const state = get();
    const board = state.board;
    if (!canFrameAsTsumego(board)) {
      set({ notification: { message: 'Place a life-and-death problem on the board first.', type: 'info' } });
      return;
    }

    const frame = buildTsumegoFrame(board, {
      komi: state.komi,
      blackToPlay: state.currentPlayer === 'black',
      koAllowed,
      // Clamped here as well as in the dialog. The bounds module says it is
      // shared by the UI and the store and it was not: the dialog was the only
      // caller and the only place that held to them, so a margin arriving any
      // other way went straight into `iMin - margin` arithmetic that has no
      // range of its own.
      margin: clampTsumegoFrameMargin(margin),
    });
    if (frame.black.length === 0 && frame.white.length === 0) {
      set({ notification: { message: 'This position leaves no room for a frame.', type: 'info' } });
      return;
    }

    const boardSize = getBoardSizeFromBoard(board);
    set((current) => {
      const parent = current.currentNode;
      const history = pushEditHistory(current);
      const node = createNode(parent, null, cloneGameState(parent.gameState));
      const props: Record<string, string[]> = {};
      if (frame.black.length > 0) props.AB = frame.black.map((p) => coordinateToSgf(p.x, p.y));
      if (frame.white.length > 0) props.AW = frame.white.map((p) => coordinateToSgf(p.x, p.y));
      node.properties = props;
      applySetupPropsToNode(node, props, boardSize);
      parent.children.push(node);

      const total = frame.black.length + frame.white.length;
      return {
        ...history,
        currentNode: node,
        board: node.gameState.board,
        currentPlayer: node.gameState.currentPlayer,
        moveHistory: node.gameState.moveHistory,
        capturedBlack: node.gameState.capturedBlack,
        capturedWhite: node.gameState.capturedWhite,
        analysisData: null,
        activeBranchChildIds: rememberActiveBranchPath(current.activeBranchChildIds, node),
        regionOfInterest: normalizeRegionOfInterest(frame.region, boardSize),
        isAnalysisMode: true,
        treeVersion: current.treeVersion + 1,
        notification: {
          message: `Framed as a tsumego with ${total} stones. The rest of the board is settled, so only this problem decides the game.`,
          type: 'info' as const,
        },
      };
    });
  },

  selfplayToEnd: () => {
    const token = ++selfplayToken;
    analysisQueue.cancelGroup('selfplay');
    // KaTrain folds the playout away when it finishes and puts you back where
    // you started, so a 200-move "what if" never buries the real game.
    selfplayStartNodeId = get().currentNode.id;
    selfplayHeadNodeId = null;
    set({ isSelfplayToEnd: true });
    // Notes the first node a step of the playout created, rather than walked into.
    const noteCreated = (from: GameNode, existing: ReadonlySet<string>) => {
      if (selfplayHeadNodeId) return;
      const now = get().currentNode;
      if (now.parent === from && !existing.has(now.id)) selfplayHeadNodeId = now.id;
    };

    void (async () => {
      let safety = 0;
      while (true) {
        const s = get();
        if (token !== selfplayToken) return;
        if (!s.isSelfplayToEnd) return;

        const mh = s.moveHistory;
        const last = mh[mh.length - 1];
        const prev = mh[mh.length - 2];
        if (isPassMove(last) && isPassMove(prev)) {
          set((cur) => ({ isSelfplayToEnd: false, ...collapseFinishedSelfplay(cur) }));
          return;
        }
        if (safety++ > 2000) {
          const notification = { message: 'Selfplay stopped (move limit).', type: 'error' as const };
          set((cur) => ({ ...collapseFinishedSelfplay(cur), isSelfplayToEnd: false, notification }));
          return;
        }

        try {
          const analysis = await analyzeForPlayout(s, {
            group: 'selfplay',
            label: 'Selfplay move',
            id: `selfplay:${token}:${s.currentNode.id}:${safety}`,
          });
          // The read was for the position we started from; if the user has
          // moved elsewhere meanwhile, do not play its answer there.
          if (get().currentNode.id !== s.currentNode.id) {
            await sleep(50);
            continue;
          }

          const best = analysis.moves[0] ?? null;
          const existing = new Set(s.currentNode.children.map((child) => child.id));
          asEngineMove(() => {
            if (!best || best.x < 0 || best.y < 0) s.passTurn();
            else s.playMove(best.x, best.y);
          });
          noteCreated(s.currentNode, existing);
        } catch (err) {
          if (isAnalysisCanceled(err)) {
            await sleep(25);
            continue;
          }
          // Fall back to heuristics if engine fails.
          const from = get().currentNode;
          const existing = new Set(from.children.map((child) => child.id));
          makeHeuristicMove(get());
          noteCreated(from, existing);
        }

        await sleep(50);
      }
    })();
  },

  /**
   * KaTrain's "Set up Position": let the engine play both sides toward a chosen
   * score at a chosen move number, so you can practise from a realistic
   * middlegame instead of an empty board.
   *
   * Each move is sampled from the candidates whose score lands near a target
   * that ramps linearly from today's score to the requested advantage, skipping
   * anything that throws away more than a few points. When the position drifts
   * far from the ramp it plays the move that closes the gap fastest.
   */
  generateSetupPosition: ({ untilMove, targetAdvantage }) => {
    const token = ++setupPositionToken;
    analysisQueue.cancelGroup('setup-position');
    const startDepth = get().currentNode.gameState.moveHistory.length;
    const target = Math.max(startDepth + 1, Math.floor(untilMove));
    let startScore: number | null = null;

    set({ setupPositionProgress: { move: startDepth, untilMove: target } });

    const finish = (message: string, type: 'info' | 'error' = 'info') => {
      if (token !== setupPositionToken) return;
      analysisQueue.cancelGroup('setup-position');
      set((state) => ({
        setupPositionProgress: null,
        treeVersion: state.treeVersion + 1,
        notification: { message, type },
      }));
      // The opponent waited while the position was built; its turn now.
      get().scheduleAiMove(500);
    };

    void (async () => {
      const MAX_POINTS_LOST = 5;
      while (true) {
        const s = get();
        if (token !== setupPositionToken) return;
        if (!s.setupPositionProgress) return;

        const depth = s.currentNode.gameState.moveHistory.length;
        if (depth >= target) {
          const score = s.currentNode.analysis?.rootScoreLead;
          const lead = typeof score === 'number' ? formatScoreLead(score) : `about ${formatScoreLead(targetAdvantage)}`;
          finish(`Set up a position at move ${depth} (${lead}).`);
          return;
        }

        try {
          const analysis = await analyzeForPlayout(s, {
            group: 'setup-position',
            label: 'Set up position',
            id: `setup-position:${token}:${s.currentNode.id}:${depth}`,
            // A little root noise keeps generated games from repeating.
            wideRootNoise: 0.03,
          });
          // The read was for the position we started from; if the user has
          // moved elsewhere meanwhile, do not play its answer there.
          if (get().currentNode.id !== s.currentNode.id) {
            await sleep(50);
            continue;
          }
          if (token !== setupPositionToken) return;

          const candidates = analysis.moves.filter((move) => move.x >= 0 && move.y >= 0);
          if (candidates.length === 0) {
            finish(`Set up a position at move ${depth} (the engine wanted to pass).`);
            return;
          }
          if (startScore === null) startScore = analysis.rootScoreLead;

          // Straight line from the score we started at to the score asked for.
          const remaining = Math.max(1, target - startDepth);
          const targetScore = startScore + ((depth - startDepth + 1) * (targetAdvantage - startScore)) / remaining;
          const stddev = Math.min(3, 0.5 + (target - depth) * 0.15);

          let chosen: CandidateMove;
          if (Math.abs(analysis.rootScoreLead - targetScore) < 3 * stddev) {
            const weighted = candidates
              .filter((move, index) => move.pointsLost < MAX_POINTS_LOST || index === 0)
              .map((move) => ({
                move,
                weight: Math.exp(-0.5 * ((move.scoreLead - targetScore) / stddev) ** 2),
              }));
            chosen = weightedPick(weighted) ?? candidates[0]!;
          } else {
            // Too far off the ramp to be picky: close the gap.
            chosen = candidates.reduce((best, move) =>
              Math.abs(move.scoreLead - targetScore) < Math.abs(best.scoreLead - targetScore) ? move : best
            );
          }

          asEngineMove(() => s.playMove(chosen.x, chosen.y));
          const played = get().currentNode.gameState.moveHistory.length;
          set({ setupPositionProgress: { move: played, untilMove: target } });
          if (played === depth) {
            finish('Could not continue generating this position.', 'error');
            return;
          }
        } catch (err) {
          if (isAnalysisCanceled(err)) {
            if (token !== setupPositionToken) return;
            await sleep(25);
            continue;
          }
          finish('The engine stopped while generating the position.', 'error');
          return;
        }

        await sleep(20);
      }
    })();
  },

  stopSetupPositionGeneration: () => {
    setupPositionToken++;
    analysisQueue.cancelGroup('setup-position');
    const depth = get().currentNode.gameState.moveHistory.length;
    const wasGenerating = !!get().setupPositionProgress;
    set((state) =>
      state.setupPositionProgress
        ? {
            setupPositionProgress: null,
            notification: { message: `Stopped generating at move ${depth}.`, type: 'info' as const },
          }
        : {}
    );
    // Only a generation that was running held the opponent back; Stop with
    // nothing generating must not start an AI move it was meant to cancel.
    if (wasGenerating) get().scheduleAiMove(500);
  },

  stopSelfplayToEnd: () => {
    selfplayToken++;
    analysisQueue.cancelGroup('selfplay');
    set((cur) => ({ isSelfplayToEnd: false, ...collapseFinishedSelfplay(cur) }));
  },

  pendingGameReview: null,
  requestQuickGameAnalysis: () => set({ pendingGameReview: { kind: 'quick', rootId: get().rootNode.id } }),
  requestFastGameAnalysis: (options) => set({ pendingGameReview: { kind: 'fast', options, rootId: get().rootNode.id } }),
  requestFullGameAnalysis: (options) => set({ pendingGameReview: { kind: 'full', options, rootId: get().rootNode.id } }),
  chooseGameReviewMode: (reanalyzeExisting) => {
    const request = get().pendingGameReview;
    set({ pendingGameReview: null });
    if (!request || reanalyzeExisting === null || request.rootId !== get().rootNode.id) return;
    if (request.kind === 'quick') get().startQuickGameAnalysis({ reanalyzeExisting });
    else if (request.kind === 'fast') get().startFastGameAnalysis({ ...request.options, reanalyzeExisting });
    else get().startFullGameAnalysis({ ...request.options, reanalyzeExisting });
  },

  startQuickGameAnalysis: (opts) => {
    const token = ++gameAnalysisToken;
    analysisQueue.cancelGroup('game-analysis');
    // A review is the refresh, and nothing tells the client the model
    // changed (a remote engine's weights are the server's, and a local URL
    // can keep serving new bytes). Drop the cached results so the reads that
    // follow do not keep answering with the previous model's numbers.
    analysisQueue.clearCache();
    const state = get();

    const nodes = getCurrentLineNodes(state.rootNode, state.activeBranchChildIds);

    const total = nodes.length;
    if (total <= 1) {
      set({ isGameAnalysisRunning: false, gameAnalysisType: null, gameAnalysisDone: 0, gameAnalysisTotal: total });
      return;
    }

    set({ isGameAnalysisRunning: true, gameAnalysisType: 'quick', gameAnalysisDone: 0, gameAnalysisTotal: total });

    void (async () => {
      let done = 0;
      let failed = 0;
      let lastFailure: string | null = null;
      let lastUiUpdate = getAnimationNow();
      let metaSynced = false;
      const stillOwnsRun = () =>
        token === gameAnalysisToken && get().isGameAnalysisRunning && get().gameAnalysisType === 'quick';

      const evalBatchSize = Math.max(1, Math.min(get().settings.katagoBatchSize, 8));

      let chunkRetries = 0;
      for (let start = 0; start < nodes.length; start += evalBatchSize) {
        if (token !== gameAnalysisToken) return;
        if (!get().isGameAnalysisRunning) return;
        if (get().gameAnalysisType !== 'quick') return;

        const chunk = nodes.slice(start, start + evalBatchSize);
        // Every position, not only the ones with no analysis: after a model
        // update an existing value is exactly what needs replacing.
        const toEval = opts?.reanalyzeExisting === false ? chunk.filter(node => !node.analysis) : chunk;
        const previousAnalyses = new Map(toEval.map(node => [node.id, node.analysis]));
        if (toEval.length > 0) {
          try {
            const s = get();
            const modelUrl = resolveModelUrlForFetch(s.settings.katagoModelUrl);
            const rules = s.settings.gameRules;
            const conservativePass = s.settings.katagoConservativePass;
            const positionKeys = toEval.map((n) => nodeAnalysisPositionKey(n, rules));
            const evals = await analysisQueue.enqueue({
              id: `quick-game:${token}:${start}`,
              label: 'Quick game analysis',
              group: 'game-analysis',
              priority: ANALYSIS_QUEUE_PRIORITY.quickGame,
              cacheKey: analysisCacheKey(
                'quick-game',
                modelUrl,
                s.settings.katagoBackend,
                rules,
                conservativePass,
                positionKeys
              ),
              bypassCache: true,
              run: (ctx) => getEngineClient(get().settings).evaluateBatch({
              modelUrl,
              backend: s.settings.katagoBackend,
              positions: toEval.map((n) => ({
                board: n.gameState.board,
                ...engineHistoryBoards(n),
                currentPlayer: n.gameState.currentPlayer,
                moveHistory: n.gameState.moveHistory,
                repetitionHistory: repetitionHistoryForNode(n, rules),
                komi: komiWithHandicapBonus(s.rootNode.gameState.board, rules, n.gameState.komi),
              })),
              rules,
              conservativePass,
              priority: ctx.priority,
              signal: ctx.signal,
              }),
            });
            if (token !== gameAnalysisToken) return;
            if (!get().isGameAnalysisRunning) return;
            if (get().gameAnalysisType !== 'quick') return;
            if (!metaSynced) {
              const engineInfo = getEngineClient(get().settings).getEngineInfo();
              set({ engineBackend: engineInfo.backend, engineModelName: engineInfo.modelName, engineBackendNote: engineInfo.backendNote });
              metaSynced = true;
            }

            // The job waited in the queue, so the node may have moved on: a
            // live search can have landed a deeper result (a raw eval replaced
            // it), or a setup edit changed the position (the old one's eval
            // was stored as the new one's). Keep the first; redo the second.
            let positionChanged = false;
            for (let i = 0; i < toEval.length; i++) {
              const node = toEval[i]!;
              const evaled = evals[i]!;
              if (node.analysis && node.analysis !== previousAnalyses.get(node.id)) continue;
              if (nodeAnalysisPositionKey(node, rules) !== positionKeys[i]) {
                positionChanged = true;
                continue;
              }
              const boardSize = getBoardSizeFromBoard(node.gameState.board);
              node.analysis = {
                rootWinRate: evaled.rootWinRate,
                rootScoreLead: evaled.rootScoreLead,
                rootScoreSelfplay: evaled.rootScoreSelfplay,
                rootScoreStdev: evaled.rootScoreStdev,
                moves: [],
                territory: createEmptyTerritory(boardSize),
                policy: undefined,
                ownershipStdev: undefined,
                ownershipMode: 'none',
              };
              node.analysisVisitsRequested = Math.max(node.analysisVisitsRequested ?? 0, 1);
            }
            if (positionChanged && chunkRetries < 3) {
              chunkRetries += 1;
              start -= evalBatchSize;
              continue;
            }
            chunkRetries = 0;
          } catch (err) {
            if (isAnalysisCanceled(err)) {
              // Queue-level preemption (e.g. live analysis while the user
              // navigates) aborts the active job without bumping the token.
              // Come back to this chunk rather than leaving a hole in the graph.
              if (!stillOwnsRun()) return;
              if (chunkRetries < 3) {
                chunkRetries += 1;
                await sleep(25);
                start -= evalBatchSize;
                continue;
              }
              // Retries count per chunk (reset on success); once spent, the
              // chunk is reported as a failure rather than skipped silently,
              // which ended the run short ("5 of 6") with a hole in the graph.
              chunkRetries = 0;
              failed += toEval.length;
              lastFailure = 'Interrupted repeatedly by other analysis.';
            } else {
              chunkRetries = 0;
              failed += toEval.length;
              lastFailure = errorMessage(err);
            }
          }
        }
        if (token !== gameAnalysisToken) return;
        if (!get().isGameAnalysisRunning) return;
        if (get().gameAnalysisType !== 'quick') return;

        done += chunk.length;

        const now = getAnimationNow();
        if (now - lastUiUpdate > 120 || done === total) {
          set((s) => ({
            gameAnalysisDone: done,
            gameAnalysisTotal: total,
            analysisCacheSize: getAnalysisCacheSize(s.rootNode),
            treeVersion: s.treeVersion + 1,
          }));
          lastUiUpdate = now;
        }

        await sleep(0);
      }

      if (token !== gameAnalysisToken) return;
      set((s) => ({
        isGameAnalysisRunning: false,
        gameAnalysisType: null,
        gameAnalysisDone: done,
        gameAnalysisTotal: total,
        analysisCacheSize: getAnalysisCacheSize(s.rootNode),
        treeVersion: s.treeVersion + 1,
        ...gameAnalysisFailureUpdate('quick', failed, total, lastFailure),
      }));
    })();
  },

  startFastGameAnalysis: (opts) => {
    const token = ++gameAnalysisToken;
    analysisQueue.cancelGroup('game-analysis');
    // A review is the refresh, and nothing tells the client the model
    // changed (a remote engine's weights are the server's, and a local URL
    // can keep serving new bytes). Drop the cached results so the reads that
    // follow do not keep answering with the previous model's numbers.
    analysisQueue.clearCache();
    const state = get();
    const moveRangeRaw = opts?.moveRange ?? null;
    const moveRange: [number, number] | null = moveRangeRaw
      ? [Math.min(moveRangeRaw[0]!, moveRangeRaw[1]!), Math.max(moveRangeRaw[0]!, moveRangeRaw[1]!)]
      : null;

    const nodes = getCurrentLineNodes(state.rootNode, state.activeBranchChildIds).filter((node) => {
      if (!moveRange) return true;
      return nodeIsInMoveRange(node, moveRange) || nodeIsParentOfMoveInRange(node, moveRange);
    });

    const total = nodes.length;
    if (total <= 1) {
      set({ isGameAnalysisRunning: false, gameAnalysisType: null, gameAnalysisDone: 0, gameAnalysisTotal: total });
      return;
    }

    set({ isGameAnalysisRunning: true, gameAnalysisType: 'fast', gameAnalysisDone: 0, gameAnalysisTotal: total });

    void (async () => {
      const boardSize = getBoardSizeFromBoard(state.board);
      const fastVisits = clampAnalysisVisits(get().settings.katagoFastVisits);
      // Same budget rule as the other fast reads (`analyzeForPlayout`): the depth
      // setting decides when the search stops and Max Time is the user's own
      // ceiling on it. The old `min(600, Max Time * 0.15)` was a hidden clock —
      // a review set to 50000 visits stopped after the ~500 that fit in 600 ms.
      const maxTimeMs = Math.max(250, Math.min(get().settings.katagoMaxTimeMs, ENGINE_MAX_TIME_MS));
      const batchSize = Math.max(1, Math.min(get().settings.katagoBatchSize, 64));
      const maxChildren = Math.max(4, Math.min(get().settings.katagoMaxChildren, boardSize * boardSize));
      // Report as many candidates as the reader asked for, the same as the live
      // read and the full review do: this writes the node's analysis, and the
      // board draws its hints from it, so a private cap of ten here would put
      // the list and the board out of step again.
      const topK = Math.max(1, Math.min(get().settings.katagoTopK, 50));
      const analysisPvLen = Math.max(0, Math.min(get().settings.katagoAnalysisPvLen, 15));

      let done = 0;
      let failed = 0;
      let lastFailure: string | null = null;
      let lastUiUpdate = getAnimationNow();
      let metaSynced = false;
      const concurrent = isRemoteEngine(get().settings);
      const stillOwnsRun = () =>
        token === gameAnalysisToken && get().isGameAnalysisRunning && get().gameAnalysisType === 'fast';

      const markDone = () => {
        if (!stillOwnsRun()) return;
        done++;
        const now = getAnimationNow();
        if (now - lastUiUpdate > 120 || done === total) {
          set((s) => ({
            gameAnalysisDone: done,
            gameAnalysisTotal: total,
            analysisCacheSize: getAnalysisCacheSize(s.rootNode),
            treeVersion: s.treeVersion + 1,
          }));
          lastUiUpdate = now;
        }
      };

      const runOne = async (node: GameNode) => {
        // No "already deep enough" skip: a review re-runs every position
        // it covers and overwrites whatever analysis is on the node, the way
        // KaTrain's game re-analysis does. Skipping meant a second review of
        // the same game did nothing at all.
        if (opts?.reanalyzeExisting === false && node.analysis && nodeAnalysisVisitCount(node) >= fastVisits) {
          markDone();
          return;
        }
        const previousAnalysis = node.analysis;
        const s = get();
        const { previousBoard: parentBoard, previousPreviousBoard: grandparentBoard } = engineHistoryBoards(node);
        const modelUrl = resolveModelUrlForFetch(s.settings.katagoModelUrl);
        const rules = s.settings.gameRules;
        const positionKey = nodeAnalysisPositionKey(node, rules);
        const analysis = await analysisQueue.enqueue<KataGoAnalysisPayload>({
          id: `fast-game:${token}:${node.id}`,
          label: 'Fast game analysis',
          group: 'game-analysis',
          priority: ANALYSIS_QUEUE_PRIORITY.fastGame,
          cacheKey: analysisCacheKey(
            'fast-game',
            node.id,
            nodeAnalysisPositionKey(node, rules),
            modelUrl,
            s.settings.katagoBackend,
            rules,
            fastVisits,
            maxTimeMs,
            batchSize,
            maxChildren,
            topK,
            analysisPvLen,
            s.settings.katagoWideRootNoise,
            s.settings.katagoRootPolicyTemperature,
            s.settings.katagoNnRandomize,
            s.settings.katagoConservativePass
          ),
          // A review is a refresh, and the model can change with no signal the
          // client can see: a remote engine's weights are the server's, and even
          // a local URL can keep serving the same path with new bytes. So the
          // model URL is not a freshness key, and a review never trusts the
          // cached result of an earlier one.
          bypassCache: true,
          run: (ctx) => getEngineClient(get().settings).analyze({
          positionId: node.id,
          parentPositionId: node.parent?.id,
          positionKey: nodeAnalysisPositionKey(node, rules),
          parentPositionKey: parentAnalysisPositionKey(node, rules),
          modelUrl,
          backend: s.settings.katagoBackend,
          board: node.gameState.board,
          previousBoard: parentBoard,
          previousPreviousBoard: grandparentBoard,
          currentPlayer: node.gameState.currentPlayer,
          moveHistory: node.gameState.moveHistory,
          repetitionHistory: repetitionHistoryForNode(node, rules),
          komi: komiWithHandicapBonus(s.rootNode.gameState.board, rules, node.gameState.komi),
          rules,
          topK,
          analysisPvLen,
          includeMovesOwnership: false,
          wideRootNoise: s.settings.katagoWideRootNoise,
          rootPolicyTemperature: s.settings.katagoRootPolicyTemperature,
          fillDameBeforePass: s.settings.katagoFillDameBeforePass,
          nnRandomize: s.settings.katagoNnRandomize,
          conservativePass: s.settings.katagoConservativePass,
          visits: fastVisits,
          maxTimeMs,
          batchSize,
          maxChildren,
          reuseTree: false,
          ownershipMode: 'none',
          analysisGroup: 'background',
          priority: ctx.priority,
          signal: ctx.signal,
          }),
        });
        if (!stillOwnsRun()) return;
        if (nodeAnalysisPositionKey(node, rules) !== positionKey) throw new AnalysisQueueStaleError('Position changed during review');
        if (!metaSynced) {
          const engineInfo = getEngineClient(get().settings).getEngineInfo();
          set({ engineBackend: engineInfo.backend, engineModelName: engineInfo.modelName, engineBackendNote: engineInfo.backendNote });
          metaSynced = true;
        }

        if (!(node.analysis && node.analysis !== previousAnalysis && analysisDepth(node.analysis) > (analysis.rootVisits ?? fastVisits))) node.analysis = {
          rootWinRate: analysis.rootWinRate,
          rootScoreLead: analysis.rootScoreLead,
          rootScoreSelfplay: analysis.rootScoreSelfplay,
          rootScoreStdev: analysis.rootScoreStdev,
          // The other three writers record this; without it the node's depth
          // looks like zero and a shallow live read would overwrite the result.
          rootVisits: analysis.rootVisits,
          rawWinRate: analysis.rawWinRate,
          rawScoreLead: analysis.rawScoreLead,
          rawScoreSelfplay: analysis.rawScoreSelfplay,
          rawScoreSelfplayStdev: analysis.rawScoreSelfplayStdev,
          rawNoResultProb: analysis.rawNoResultProb,
          rawStWrError: analysis.rawStWrError,
          rawStScoreError: analysis.rawStScoreError,
          rawVarTimeLeft: analysis.rawVarTimeLeft,
          moves: analysis.moves,
          territory: createEmptyTerritory(getBoardSizeFromBoard(node.gameState.board)),
          policy: undefined,
          ownershipStdev: undefined,
          ownershipMode: 'none',
        };
        node.analysisVisitsRequested = fastVisits;
        markDone();
      };

      await runNodeAnalysisBatch({
        nodes,
        concurrent,
        ownsRun: stillOwnsRun,
        runOne,
        onFailure: (err) => {
          failed++;
          lastFailure = errorMessage(err);
          markDone();
        },
      });

      if (!stillOwnsRun()) return;
      set((s) => ({
        isGameAnalysisRunning: false,
        gameAnalysisType: null,
        gameAnalysisDone: done,
        gameAnalysisTotal: total,
        analysisCacheSize: getAnalysisCacheSize(s.rootNode),
        treeVersion: s.treeVersion + 1,
        ...gameAnalysisFailureUpdate('fast', failed, total, lastFailure),
      }));
    })();
  },

  startFullGameAnalysis: (opts) => {
    const token = ++gameAnalysisToken;
    analysisQueue.cancelGroup('game-analysis');
    // A review is the refresh, and nothing tells the client the model
    // changed (a remote engine's weights are the server's, and a local URL
    // can keep serving new bytes). Drop the cached results so the reads that
    // follow do not keep answering with the previous model's numbers.
    analysisQueue.clearCache();
    const state = get();

    const visits = clampAnalysisVisits(opts.visits || 0);
    const moveRangeRaw = opts.moveRange ?? null;
    const moveRange: [number, number] | null = moveRangeRaw
      ? [Math.min(moveRangeRaw[0]!, moveRangeRaw[1]!), Math.max(moveRangeRaw[0]!, moveRangeRaw[1]!)]
      : null;
    const mistakesOnly = opts.mistakesOnly === true;

    const thresholds = state.settings.trainerEvalThresholds?.length ? state.settings.trainerEvalThresholds : DEFAULT_EVAL_THRESHOLDS;
    const mistakesThreshold =
      thresholds.length >= 4 ? thresholds[thresholds.length - 4]! : 3;
    const nodes = selectFullGameAnalysisNodes({
      rootNode: state.rootNode,
      moveRange,
      mistakesOnly,
      mistakesThreshold,
    });
    const total = nodes.length;
    if (total <= 1) {
      set({ isGameAnalysisRunning: false, gameAnalysisType: null, gameAnalysisDone: 0, gameAnalysisTotal: total });
      return;
    }

    set({ isGameAnalysisRunning: true, gameAnalysisType: 'full', gameAnalysisDone: 0, gameAnalysisTotal: total });

    void (async () => {
      let done = 0;
      let failed = 0;
      let lastFailure: string | null = null;
      let lastUiUpdate = getAnimationNow();
      let metaSynced = false;
      const concurrent = isRemoteEngine(get().settings);
      const stillOwnsRun = () =>
        token === gameAnalysisToken && get().isGameAnalysisRunning && get().gameAnalysisType === 'full';

      const markDone = () => {
        if (!stillOwnsRun()) return;
        done++;
        const now = getAnimationNow();
        if (now - lastUiUpdate > 120 || done === total) {
          set((s) => ({
            gameAnalysisDone: done,
            gameAnalysisTotal: total,
            analysisCacheSize: getAnalysisCacheSize(s.rootNode),
            treeVersion: s.treeVersion + 1,
          }));
          lastUiUpdate = now;
        }
      };

      const runOne = async (node: GameNode) => {
        // No "already deep enough" skip: a review re-runs every position
        // it covers and overwrites whatever analysis is on the node, the way
        // KaTrain's game re-analysis does. Skipping meant a second review of
        // the same game did nothing at all.
        if (opts?.reanalyzeExisting === false && node.analysis && nodeAnalysisVisitCount(node) >= visits) {
          markDone();
          return;
        }
        const previousAnalysis = node.analysis;
        const s = get();
        const { previousBoard: parentBoard, previousPreviousBoard: grandparentBoard } = engineHistoryBoards(node);
        const maxTimeMs = ENGINE_MAX_TIME_MS;
        const batchSize = Math.max(1, Math.min(s.settings.katagoBatchSize, 64));
        const boardSize = getBoardSizeFromBoard(node.gameState.board);
        const maxChildren = Math.max(4, Math.min(s.settings.katagoMaxChildren, boardSize * boardSize));
        const topK = Math.max(5, Math.min(s.settings.katagoTopK, 50));
        const analysisPvLen = Math.max(0, Math.min(s.settings.katagoAnalysisPvLen, 60));
        const modelUrl = resolveModelUrlForFetch(s.settings.katagoModelUrl);
        const rules = s.settings.gameRules;
        const positionKey = nodeAnalysisPositionKey(node, rules);

        const analysis = await analysisQueue.enqueue<KataGoAnalysisPayload>({
          id: `full-game:${token}:${node.id}`,
          label: 'Full game analysis',
          group: 'game-analysis',
          priority: ANALYSIS_QUEUE_PRIORITY.fullGame,
          cacheKey: analysisCacheKey(
            'full-game',
            node.id,
            nodeAnalysisPositionKey(node, rules),
            modelUrl,
            s.settings.katagoBackend,
            rules,
            visits,
            maxTimeMs,
            batchSize,
            maxChildren,
            topK,
            analysisPvLen,
            s.settings.katagoOwnershipMode,
            s.settings.katagoWideRootNoise,
            s.settings.katagoNnRandomize,
            s.settings.katagoConservativePass,
            s.settings.humanSlEnabled ? s.settings.humanSlProfile : '',
            s.settings.humanSlEnabled ? s.settings.humanSlModelUrl : ''
          ),
          // A review is a refresh, and the model can change with no signal the
          // client can see: a remote engine's weights are the server's, and even
          // a local URL can keep serving the same path with new bytes. So the
          // model URL is not a freshness key, and a review never trusts the
          // cached result of an earlier one.
          bypassCache: true,
          run: (ctx) => getEngineClient(get().settings).analyze({
          positionId: node.id,
          parentPositionId: node.parent?.id,
          positionKey: nodeAnalysisPositionKey(node, rules),
          parentPositionKey: parentAnalysisPositionKey(node, rules),
          modelUrl,
          backend: s.settings.katagoBackend,
          board: node.gameState.board,
          previousBoard: parentBoard,
          previousPreviousBoard: grandparentBoard,
          currentPlayer: node.gameState.currentPlayer,
          moveHistory: node.gameState.moveHistory,
          repetitionHistory: repetitionHistoryForNode(node, rules),
          komi: komiWithHandicapBonus(s.rootNode.gameState.board, rules, node.gameState.komi),
          rules,
          topK,
          analysisPvLen,
          includeMovesOwnership: s.settings.katagoOwnershipMode === 'tree',
          wideRootNoise: s.settings.katagoWideRootNoise,
          rootPolicyTemperature: s.settings.katagoRootPolicyTemperature,
          fillDameBeforePass: s.settings.katagoFillDameBeforePass,
          nnRandomize: s.settings.katagoNnRandomize,
          conservativePass: s.settings.katagoConservativePass,
          humanModelUrl: s.settings.humanSlEnabled ? s.settings.humanSlModelUrl : undefined,
          humanSlProfile: s.settings.humanSlEnabled ? s.settings.humanSlProfile : undefined,
          visits,
          maxTimeMs,
          batchSize,
          maxChildren,
          reuseTree: false,
          ownershipMode: s.settings.katagoOwnershipMode,
          analysisGroup: 'background',
          priority: ctx.priority,
          signal: ctx.signal,
          }),
        });
        if (!stillOwnsRun()) return;
        if (nodeAnalysisPositionKey(node, rules) !== positionKey) throw new AnalysisQueueStaleError('Position changed during review');

        if (!metaSynced) {
          const engineInfo = getEngineClient(get().settings).getEngineInfo();
          set({ engineBackend: engineInfo.backend, engineModelName: engineInfo.modelName, engineBackendNote: engineInfo.backendNote });
          metaSynced = true;
        }

        if (!(node.analysis && node.analysis !== previousAnalysis && analysisDepth(node.analysis) > (analysis.rootVisits ?? visits))) node.analysis = {
          rootWinRate: analysis.rootWinRate,
          rootScoreLead: analysis.rootScoreLead,
          rootScoreSelfplay: analysis.rootScoreSelfplay,
          rootScoreStdev: analysis.rootScoreStdev,
          rootVisits: analysis.rootVisits,
          rawWinRate: analysis.rawWinRate,
          rawScoreLead: analysis.rawScoreLead,
          rawScoreSelfplay: analysis.rawScoreSelfplay,
          rawScoreSelfplayStdev: analysis.rawScoreSelfplayStdev,
          rawNoResultProb: analysis.rawNoResultProb,
          rawStWrError: analysis.rawStWrError,
          rawStScoreError: analysis.rawStScoreError,
          rawVarTimeLeft: analysis.rawVarTimeLeft,
          moves: analysis.moves,
          territory: ownershipToTerritoryGrid(analysis.ownership, boardSize),
          policy: analysis.policy,
          ownershipStdev: analysis.ownershipStdev,
          ownershipMode: s.settings.katagoOwnershipMode,
        };
        node.analysisVisitsRequested = Math.max(node.analysisVisitsRequested ?? 0, visits);
        markDone();
      };

      await runNodeAnalysisBatch({
        nodes,
        concurrent,
        ownsRun: stillOwnsRun,
        runOne,
        onFailure: (err) => {
          failed++;
          lastFailure = errorMessage(err);
          markDone();
        },
      });

      if (!stillOwnsRun()) return;
      set((s) => ({
        isGameAnalysisRunning: false,
        gameAnalysisType: null,
        gameAnalysisDone: done,
        gameAnalysisTotal: total,
        analysisCacheSize: getAnalysisCacheSize(s.rootNode),
        treeVersion: s.treeVersion + 1,
        ...gameAnalysisFailureUpdate('full', failed, total, lastFailure),
      }));
    })();
  },

  stopGameAnalysis: () => {
    gameAnalysisToken++;
    analysisQueue.cancelGroup('game-analysis');
    set({ isGameAnalysisRunning: false, gameAnalysisType: null });
  },

  runAnalysis: async (opts) => {
      const state = get();
      if (opts?.ownershipOnly ? !state.settings.analysisShowOwnership : !state.isAnalysisMode) return;
      const boardSize = getBoardSizeFromBoard(state.board);
      const hasTerritory = (analysis: AnalysisResult | null | undefined): boolean =>
        !!analysis && (analysis.ownershipMode ?? 'root') !== 'none' &&
        analysis.territory.length === boardSize &&
        analysis.territory.every((row) => row.length === boardSize && row.every(Number.isFinite));
      const ownershipMode = opts?.ownershipOnly
        ? 'root'
        : state.settings.katagoOwnershipMode;
      const requestedVisits = opts?.visits ?? (opts?.ownershipOnly
        ? Math.min(64, state.settings.katagoFastVisits)
        : state.settings.katagoVisits);

      // Check if current node already has analysis
      const desiredVisits = clampAnalysisVisits(requestedVisits);
      const avoidMoves = opts?.avoidMoves && opts.avoidMoves.length > 0 ? opts.avoidMoves : undefined;
      if (!opts?.force && !avoidMoves && state.currentNode.analysis) {
        const existing = state.currentNode.analysis;
        const existingOwnershipMode = existing.ownershipMode ?? 'root';
        const requiredOwnershipMode = ownershipMode;
        const ownershipOk = hasTerritory(existing) &&
          (requiredOwnershipMode !== 'tree' || existingOwnershipMode === 'tree');
        const needsPolicy = state.settings.analysisShowPolicy;
        const policyOk = !needsPolicy || !!existing.policy;
        // An engine that cannot extend a search it already ran (a remote one)
        // has nothing more to give for this position: once it has been asked for
        // this depth, asking again only repeats the same search, so a node whose
        // search Max Time cut short must still count as done. That is what
        // `analysisVisitsRequested` records, and it lives on the node, so it
        // survives navigating away and back.
        const requestCovered =
          nodeAnalysisVisitCount(state.currentNode) >= desiredVisits ||
          (!engineCanExtendSearch(state.settings) &&
            (state.currentNode.analysisVisitsRequested ?? 0) >= desiredVisits);
        if (ownershipOk && (opts?.ownershipOnly || (requestCovered && policyOk))) {
          set({ analysisData: existing });
          return;
        }
      }

		      const node = state.currentNode;
		      const { previousBoard: parentBoard, previousPreviousBoard: grandparentBoard } = engineHistoryBoards(node);
          const keepDeeper = opts?.allowShallower !== true;
		      const modelUrl = resolveModelUrlForFetch(state.settings.katagoModelUrl);
          const rules = state.settings.gameRules;
          const analysisPvLen = opts?.analysisPvLen ?? state.settings.katagoAnalysisPvLen;
          const wideRootNoise = opts?.wideRootNoise ?? state.settings.katagoWideRootNoise;
          const rootPolicyTemperature = state.settings.katagoRootPolicyTemperature;
          const fillDameBeforePass = state.settings.katagoFillDameBeforePass;
          const nnRandomize = opts?.nnRandomize ?? state.settings.katagoNnRandomize;
          const conservativePass = opts?.conservativePass ?? state.settings.katagoConservativePass;
          const visits = desiredVisits;
          // Reading the position is not on the AI's clock: `Max Time (ms)` is the
          // budget for choosing a move (makeAiMove, analyzeForPlayout), while a
          // board read runs to the depth it was asked for and only stops at the
          // engine time ceiling. The exception is a read taken while the bot owns
          // the side to move: it describes a position the bot is about to play out
          // of, and it stands in front of the move search on the same engine, so
          // it gets the Max Time budget instead of parking a long search there.
          // Callers that want their own budget (the extra analysis actions) pass
          // `maxTimeMs`.
          const aiToMove = state.isAiPlaying && state.aiColor === state.currentPlayer;
          const maxTimeMs = Math.max(
            25,
            Math.min(
              opts?.maxTimeMs ?? (aiToMove ? state.settings.katagoMaxTimeMs : ENGINE_MAX_TIME_MS),
              ENGINE_MAX_TIME_MS
            )
          );
          const batchSize = Math.max(1, Math.min(opts?.batchSize ?? state.settings.katagoBatchSize, 64));
          const maxChildren = Math.max(4, Math.min(opts?.maxChildren ?? state.settings.katagoMaxChildren, boardSize * boardSize));
          const topK = Math.max(1, Math.min(opts?.topK ?? state.settings.katagoTopK, 50));
          const reuseTree = opts?.reuseTree ?? state.settings.katagoReuseTree;
          const ownershipRefreshIntervalMs = opts?.ownershipRefreshIntervalMs;
          const reportEveryMsRaw = opts?.ownershipOnly ? 0 : opts?.reportEveryMs;
          const reportEveryMs =
            typeof reportEveryMsRaw === 'number' && Number.isFinite(reportEveryMsRaw)
              ? Math.max(0, reportEveryMsRaw)
              : (state.isContinuousAnalysis ? CONTINUOUS_REPORT_DURING_SEARCH_MS : REPORT_DURING_SEARCH_EVERY_MS);
          const reportDuringSearchEveryMs = reportEveryMs > 0 ? reportEveryMs : undefined;
          const progressApplyMinMs = reportEveryMs > 0 ? Math.max(reportEveryMs, PROGRESS_APPLY_MIN_MS) : 0;
          let lastProgressVisits = -1;
          let lastProgressApplyAt = 0;
          let lastTreeUpdateAt = 0;
          let lastTerritoryUpdateAt = 0;
          const treeUpdateEveryMs = reportEveryMs > 0 ? reportEveryMs : 0;

          const buildAnalysisResult = (
            analysis: KataGoAnalysisPayload,
            opts: { includeTerritory: boolean; fallbackTerritory: number[][] }
          ): AnalysisResult => {
            let analysisWithTerritory: AnalysisResult = {
              rootWinRate: analysis.rootWinRate,
              rootScoreLead: analysis.rootScoreLead,
              rootScoreSelfplay: analysis.rootScoreSelfplay,
              rootScoreStdev: analysis.rootScoreStdev,
              rootVisits: analysis.rootVisits,
              rawWinRate: analysis.rawWinRate,
              rawScoreLead: analysis.rawScoreLead,
              rawScoreSelfplay: analysis.rawScoreSelfplay,
              rawScoreSelfplayStdev: analysis.rawScoreSelfplayStdev,
              rawNoResultProb: analysis.rawNoResultProb,
              rawStWrError: analysis.rawStWrError,
              rawStScoreError: analysis.rawStScoreError,
              rawVarTimeLeft: analysis.rawVarTimeLeft,
              moves: analysis.moves,
              territory: opts.includeTerritory ? ownershipToTerritoryGrid(analysis.ownership, boardSize) : opts.fallbackTerritory,
              policy: analysis.policy,
              humanPolicy: analysis.humanPolicy,
              ownershipStdev: analysis.ownershipStdev,
              ownershipMode: opts.includeTerritory
                ? ownershipMode
                : hasTerritory(node.analysis) ? (node.analysis?.ownershipMode ?? 'root') : 'none',
            };

            const roi = get().regionOfInterest;
            if (roi) {
              analysisWithTerritory = {
                ...analysisWithTerritory,
                moves: analysisWithTerritory.moves.filter((m) => isMoveInRegion(m, roi)),
                policy: analysisWithTerritory.policy
                  ? (() => {
                      const p = analysisWithTerritory.policy.slice();
                      for (let y = 0; y < boardSize; y++) {
                        for (let x = 0; x < boardSize; x++) {
                          if (x >= roi.xMin && x <= roi.xMax && y >= roi.yMin && y <= roi.yMax) continue;
                          p[y * boardSize + x] = -1;
                        }
                      }
                      return p;
                    })()
                  : analysisWithTerritory.policy,
              };
            }

            return analysisWithTerritory;
          };

          const applyAnalysis = (analysis: KataGoAnalysisPayload, isFinal: boolean, now = getAnimationNow()) => {
            if (nodeAnalysisPositionKey(node, rules) !== requestPositionKey) return;

            // A shallower search does not replace a deeper one. The live ladder
            // asks for whatever depth it is on, so a quick read — or one that
            // simply finished later, with several requests in flight — used to
            // overwrite a deeper review already on this node.
            const incomingVisits = typeof analysis.rootVisits === 'number' ? Math.max(0, Math.floor(analysis.rootVisits)) : 0;
            if (node.analysis && (opts?.ownershipOnly || (keepDeeper && incomingVisits <= analysisDepth(node.analysis)))) {
              // A quick territory read supplements an existing deep review.
              // Its win rate, score, candidates and requested depth stay intact.
              if (!hasTerritory(node.analysis)) {
                node.analysis = {
                  ...node.analysis,
                  territory: ownershipToTerritoryGrid(analysis.ownership, boardSize),
                  ownershipStdev: analysis.ownershipStdev,
                  ownershipMode: 'root',
                };
                set((s) => ({
                  ...(s.currentNode.id === node.id ? { analysisData: node.analysis } : {}),
                  treeVersion: s.treeVersion + 1,
                }));
              }
              if (isFinal) {
                const engineInfo = getEngineClient(get().settings).getEngineInfo();
                set({
                  engineStatus: 'ready',
                  engineError: null,
                  engineBackend: engineInfo.backend,
                  engineModelName: engineInfo.modelName,
                  engineBackendNote: engineInfo.backendNote,
                });
              }
              return;
            }

            const showOwnership = get().settings.analysisShowOwnership;
            const shouldUpdateTerritory =
              isFinal || (showOwnership && progressApplyMinMs > 0 && now - lastTerritoryUpdateAt >= progressApplyMinMs);
            if (shouldUpdateTerritory) lastTerritoryUpdateAt = now;
            const fallbackTerritory = node.analysis?.territory ?? createEmptyTerritory(boardSize);
            const analysisWithTerritory = buildAnalysisResult(analysis, {
              includeTerritory: shouldUpdateTerritory,
              fallbackTerritory,
            });
            // A search that has not yet caught up with what the node already
            // holds (a review's or a loaded file's result) leaves it alone:
            // its first progress report replaced 500 visits with 12, and
            // stepping on before it finished kept the 12.
            const keepStored = keepDeeper && !!node.analysis && analysis.rootVisits < nodeAnalysisVisitCount(node);
            if (keepStored && !isFinal) return;
            if (!keepStored) node.analysis = analysisWithTerritory;
            if (isFinal) node.analysisVisitsRequested = Math.max(node.analysisVisitsRequested ?? 0, visits);

            const latest = get();
            const isCurrent = latest.currentNode.id === node.id;
            const updateNow = getAnimationNow();
            const shouldBumpTree =
              isFinal || (isCurrent && treeUpdateEveryMs > 0 && updateNow - lastTreeUpdateAt >= treeUpdateEveryMs);
            if (shouldBumpTree) lastTreeUpdateAt = updateNow;

            if (!isCurrent && !isFinal && !shouldBumpTree) return;

            // A valid progress result proves the model is loaded. Waiting for
            // completion left “Loading model” beside live evaluations for the
            // entire first deep search, and hid the active fallback backend.
            const engineInfo = getEngineClient(get().settings).getEngineInfo();
            set((s) => {
              const next: Partial<GameStore> = {
                engineStatus: 'ready',
                engineError: null,
                engineBackend: engineInfo.backend,
                engineModelName: engineInfo.modelName,
                engineBackendNote: engineInfo.backendNote,
              };
              if (isCurrent) next.analysisData = node.analysis ?? analysisWithTerritory;
              if (shouldBumpTree) next.treeVersion = s.treeVersion + 1;
              if (isFinal) next.analysisCacheSize = getAnalysisCacheSize(s.rootNode);
              return next;
            });
          };

          const onProgress = reportDuringSearchEveryMs
            ? (analysis: KataGoAnalysisPayload) => {
                const visits = typeof analysis.rootVisits === 'number' ? analysis.rootVisits : 0;
                if (visits <= lastProgressVisits) return;
                const now = getAnimationNow();
                if (progressApplyMinMs > 0 && now - lastProgressApplyAt < progressApplyMinMs) return;
                lastProgressVisits = visits;
                lastProgressApplyAt = now;
                applyAnalysis(analysis, false, now);
              }
            : undefined;

      // What the board looked like when this was asked for. A setup edit
      // swaps the node's position in place, and a result for the old stones
      // must not be drawn on the new ones just because the node id matches.
      const requestPositionKey = nodeAnalysisPositionKey(node, rules);
      const interactiveContextKey = analysisCacheKey(
        'interactive',
        node.id,
        requestPositionKey,
        modelUrl,
        state.settings.katagoBackend,
        rules,
        JSON.stringify(state.regionOfInterest ?? null),
        topK,
        analysisPvLen,
        ownershipMode,
        wideRootNoise,
        rootPolicyTemperature,
        fillDameBeforePass,
        nnRandomize,
        conservativePass,
        batchSize,
        maxChildren,
        reuseTree,
        state.settings.humanSlEnabled ? state.settings.humanSlProfile : '',
        state.settings.humanSlEnabled ? state.settings.humanSlModelUrl : '',
        avoidMoves ? avoidMoves.map((m) => `${m.x},${m.y}`).sort().join(' ') : ''
      );
      const interactiveCacheKey = analysisCacheKey(interactiveContextKey, visits, maxTimeMs, ownershipRefreshIntervalMs);
      const requestKey = analysisCacheKey(interactiveCacheKey, reportDuringSearchEveryMs);
      const current = runningInteractiveAnalysis;
      if (current && (opts?.ifIdle
        ? current.contextKey === interactiveContextKey
        : !opts?.force && current.requestKey === requestKey)
        && analysisQueue.hasLiveJob(current.id, current.cacheKey)) {
        return current.promise;
      }
      // "Loading" is about the model, not about a request being in flight.
      // Flagging it on every live-analysis pass left the pill reading
      // "Loading model" — and the notes panel "Loading engine..." — for the
      // whole session while results were already on the board. A reported
      // backend means the net is resident, so only a cold or failed engine
      // goes back to loading.
      set((s) => (s.engineBackend && s.engineStatus !== 'error'
        ? { engineError: null }
        : { engineStatus: 'loading', engineError: null }));

      const id = `interactive:${node.id}`;
      const promise: Promise<void> = analysisQueue
	        .enqueue<KataGoAnalysisPayload>({
          id,
          label: 'Live analysis',
          group: 'interactive',
          priority: ANALYSIS_QUEUE_PRIORITY.interactive,
          staleKey: 'interactive-analysis',
          cacheKey: interactiveCacheKey,
          bypassCache: opts?.force === true,
          // A remote engine schedules by priority itself, and its other queries
          // are worth keeping: canceling the background batch would only make
          // the interactive search wait for a termination round trip. The local
          // worker has no such scheduler, so preemption stays for it.
          preempt: !isRemoteEngine(state.settings),
          run: (ctx) => getEngineClient(get().settings).analyze({
	          positionId: node.id,
	          parentPositionId: node.parent?.id,
            positionKey: nodeAnalysisPositionKey(node, rules),
            parentPositionKey: parentAnalysisPositionKey(node, rules),
	          modelUrl,
            backend: state.settings.katagoBackend,
	          board: state.board,
	          previousBoard: parentBoard,
	          previousPreviousBoard: grandparentBoard,
	          currentPlayer: state.currentPlayer,
	          moveHistory: state.moveHistory,
	          repetitionHistory: repetitionHistoryForNode(node, rules),
	          komi: komiWithHandicapBonus(state.rootNode.gameState.board, rules, state.komi),
            rules,
            regionOfInterest: state.regionOfInterest,
	          topK,
            includeMovesOwnership: state.settings.katagoOwnershipMode === 'tree',
            analysisPvLen,
            wideRootNoise,
            rootPolicyTemperature,
            fillDameBeforePass,
            nnRandomize,
            conservativePass,
            humanModelUrl: state.settings.humanSlEnabled ? state.settings.humanSlModelUrl : undefined,
            humanSlProfile: state.settings.humanSlEnabled ? state.settings.humanSlProfile : undefined,
            avoidMoves: avoidMoves?.map((m) => ({ x: m.x, y: m.y, player: state.currentPlayer })),
          visits,
          maxTimeMs,
          batchSize,
          maxChildren,
          reportDuringSearchEveryMs,
          ownershipRefreshIntervalMs,
          reuseTree,
          ownershipMode,
          analysisGroup: 'interactive',
          priority: ctx.priority,
          signal: ctx.signal,
          onProgress: onProgress
            ? (analysis) => {
                if (ctx.signal.aborted || ctx.isStale()) return;
                onProgress(analysis);
              }
            : undefined,
          }),
        })
        .then((analysis) => {
          applyAnalysis(analysis, true);

          const maybeApplyTeachUndo = () => {
            const latestState = get();
            if (!latestState.isTeachMode) return;

            // Judge the node this analysis was for, and only while it is the
            // move the player just made and is still on: a result landing
            // after they navigated elsewhere, or stepping through a loaded
            // game, used to undo whichever node was current at the time.
            const current = node;
            if (latestState.currentNode.id !== current.id) return;
            if (current.id !== lastPlayedNodeId) return;
            if (current.children.length > 0) return;
            const move = current.move;
            const parent = current.parent;
            if (!move || !parent) return;
            if (current.autoUndo !== null && current.autoUndo !== undefined) return;
            if (latestState.isAiPlaying && latestState.aiColor === move.player) return;

            const parentScore = parent.analysis?.rootScoreLead;
            const childScore = current.analysis?.rootScoreLead;
            if (typeof parentScore !== 'number' || typeof childScore !== 'number') return;

            const pointsLost = (move.player === 'black' ? 1 : -1) * (parentScore - childScore);
            const thresholds = latestState.settings.trainerEvalThresholds?.length
              ? latestState.settings.trainerEvalThresholds
              : DEFAULT_EVAL_THRESHOLDS;

            let i = 0;
            while (i < thresholds.length - 1 && pointsLost < thresholds[i]!) i++;
            const undoPrompts = latestState.settings.teachNumUndoPrompts ?? [];
            const idx = Math.max(0, Math.min(i, undoPrompts.length - 1));
            const numUndos = undoPrompts[idx] ?? 0;

            let undo = false;
            if (numUndos === 0) {
              undo = false;
            } else if (numUndos < 1) {
              const r = typeof current.undoThreshold === 'number' ? current.undoThreshold : Math.random();
              current.undoThreshold = r;
              undo = r < numUndos && parent.children.length === 1;
            } else {
              undo = parent.children.length <= numUndos;
            }

            current.autoUndo = undo;
            set((s) => ({ treeVersion: s.treeVersion + 1 }));

            if (!undo) return;

            const moveLabel = formatBoardMoveLabel(move, boardSize);

            const notification = {
              message: `Teaching undo: ${moveLabel} (${pointsLost.toFixed(1)} points lost).`,
              type: 'info' as const,
            };
            set({ notification });
            latestState.navigateBack();
          };

          maybeApplyTeachUndo();
        })
        .catch((err: unknown) => {
          if (isAnalysisCanceled(err)) return;
          const msg = err instanceof Error ? err.message : String(err);
          const notification = { message: `Analysis error: ${msg}`, type: 'error' as const };
          set({
            engineStatus: 'error',
            engineError: msg,
            notification,
          });
        }).finally(() => {
          // A canceled request can settle after its replacement has started.
          if (runningInteractiveAnalysis === request) runningInteractiveAnalysis = null;
        });
      const request = { id, contextKey: interactiveContextKey, cacheKey: interactiveCacheKey, requestKey, promise };
      runningInteractiveAnalysis = request;
      return promise;
  },

  updateSettings: (newSettings) =>
    set((state) => {
      const nextSettings: GameSettings = { ...state.settings, ...newSettings };
      saveStoredSettings(nextSettings);
      const engineKeys: Array<keyof GameSettings> = [
        'engineMode',
        'remoteEngineUrl',
        'katagoModelUrl',
        'katagoBackend',
        'katagoVisits',
        'katagoMaxTimeMs',
        'katagoBatchSize',
        'katagoMaxChildren',
        'katagoTopK',
        'katagoOwnershipMode',
        'katagoWideRootNoise',
        'katagoRootPolicyTemperature',
        'katagoFillDameBeforePass',
        'katagoAnalysisPvLen',
        'katagoNnRandomize',
        'katagoConservativePass',
        'gameRules',
        'humanSlEnabled',
        'humanSlModelUrl',
        'humanSlProfile',
        'humanSlBotStyle',
      ];

      const engineChanged = engineKeys.some((k) => newSettings[k] !== undefined && newSettings[k] !== state.settings[k]);
      if (!engineChanged) {
        const existing = state.currentNode.analysis;
        // Older remote clients saved all-zero ownership instead of the server's
        // map. An explicit Show Territory retries that blank result as well.
        if (newSettings.analysisShowOwnership === true && !state.settings.analysisShowOwnership &&
            existing && existing.territory.length > 0 && existing.territory.every((row) => row.every((value) => value === 0))) {
          state.currentNode.analysis = { ...existing, ownershipMode: 'none' };
          return { settings: nextSettings, analysisData: state.currentNode.analysis, treeVersion: state.treeVersion + 1 };
        }
        return { settings: nextSettings };
      }

      // Switching between the local worker and a remote server changes how many
      // analyses may be in flight; see the queue's setConcurrency.
      analysisQueue.setConcurrency(engineAnalysisWindow(nextSettings));
      analysisRevision++;

      continuousToken++;
      selfplayToken++;
      gameAnalysisToken++;
      analysisQueue.cancelWhere(() => true, 'Analysis settings changed');
      analysisQueue.clearCache();

      clearAnalysisInSubtree(state.rootNode);

      const rulesChanged = newSettings.gameRules !== undefined && newSettings.gameRules !== state.settings.gameRules;
      const history = rulesChanged ? pushEditHistory(state) : {};
      if (rulesChanged) {
        state.rootNode.properties = state.rootNode.properties ?? {};
        state.rootNode.properties['RU'] = [rulesToSgfRu(nextSettings.gameRules)];
      }

      return {
        settings: nextSettings,
        analysisData: null,
        engineStatus: 'idle',
        engineError: null,
        engineBackend: null,
        engineModelName: null,
        analysisCacheSize: 0,
        isContinuousAnalysis: false,
        isSelfplayToEnd: false,
        setupPositionProgress: null,
        isGameAnalysisRunning: false,
        gameAnalysisType: null,
        ...history,
        // Every node's analysis was just nulled in place; the graph, the tree
        // markers and the report key their reads on treeVersion and kept
        // showing the wiped data until something else bumped it.
        treeVersion: state.treeVersion + 1,
      };
    }),

  setKomi: (komi) => {
    if (!Number.isFinite(komi)) return;
    const nextKomi = Number(komi.toFixed(2));
    const nextKomiText = formatKomiProperty(nextKomi);
    const current = get();
    const currentKomiText = current.rootNode.properties?.KM?.[0] ?? '';
    const sameKomi = Math.abs(current.komi - nextKomi) < 0.0001;
    if (sameKomi) {
      if (currentKomiText === nextKomiText) return;
      set((state) => {
        const history = pushEditHistory(state);
        state.rootNode.properties = state.rootNode.properties ?? {};
        state.rootNode.properties.KM = [nextKomiText];
        return { ...history, treeVersion: state.treeVersion + 1 };
      });
      return;
    }

    continuousToken++;
    selfplayToken++;
    gameAnalysisToken++;
    analysisQueue.cancelWhere(() => true, 'Komi changed');
    analysisQueue.clearCache();

    set((state) => {
      const history = pushEditHistory(state);
      state.rootNode.properties = state.rootNode.properties ?? {};
      state.rootNode.properties.KM = [nextKomiText];
      applyKomiToSubtree(state.rootNode, nextKomi);
      clearAnalysisInSubtree(state.rootNode);

      return {
        komi: nextKomi,
        board: state.currentNode.gameState.board,
        currentPlayer: state.currentNode.gameState.currentPlayer,
        moveHistory: state.currentNode.gameState.moveHistory,
        capturedBlack: state.currentNode.gameState.capturedBlack,
        capturedWhite: state.currentNode.gameState.capturedWhite,
        analysisData: null,
        analysisCacheSize: 0,
        isContinuousAnalysis: false,
        isSelfplayToEnd: false,
        setupPositionProgress: null,
        isGameAnalysisRunning: false,
        gameAnalysisType: null,
        engineStatus: 'idle',
        engineError: null,
        ...history,
        treeVersion: state.treeVersion + 1,
      };
    });
  },

  setHandicap: (handicap) => {
    if (!Number.isFinite(handicap)) return;
    const current = get();
    const boardSize = getBoardSizeFromBoard(current.rootNode.gameState.board);
    const nextHandicap = Math.max(0, Math.min(Math.floor(handicap), getMaxHandicap(boardSize)));
    const currentHandicap = parseHandicapProperty(current.rootNode.properties, boardSize);
    const currentHandicapText = current.rootNode.properties?.HA?.[0] ?? '';
    const nextHandicapText = nextHandicap > 0 ? String(nextHandicap) : '';
    if (currentHandicap === nextHandicap) {
      const hasHandicapPlayer = current.rootNode.properties?.PL?.[0] === 'W';
      const setupMatchesBoard = rootSetupPropertiesMatchBoard(
        current.rootNode.properties,
        current.rootNode.gameState.board,
        boardSize,
        nextHandicap
      );
      if (
        currentHandicapText === nextHandicapText &&
        (nextHandicap > 0 ? hasHandicapPlayer : !hasHandicapPlayer) &&
        setupMatchesBoard
      ) {
        return;
      }
      set((state) => {
        const history = pushEditHistory(state);
        state.rootNode.properties = state.rootNode.properties ?? {};
        if (nextHandicap > 0) {
          state.rootNode.properties.HA = [nextHandicapText];
          state.rootNode.properties.PL = ['W'];
        } else {
          delete state.rootNode.properties.HA;
          if (state.rootNode.properties.PL?.[0] === 'W') delete state.rootNode.properties.PL;
        }
        const rootBoardSize = getBoardSizeFromBoard(state.rootNode.gameState.board);
        syncRootSetupPropertiesFromBoard(
          state.rootNode.properties,
          state.rootNode.gameState.board,
          rootBoardSize,
          nextHandicap
        );
        return { ...history, rootNode: state.rootNode, treeVersion: state.treeVersion + 1 };
      });
      return;
    }

    continuousToken++;
    selfplayToken++;
    gameAnalysisToken++;
    analysisQueue.cancelWhere(() => true, 'Handicap changed');
    analysisQueue.clearCache();

    set((state) => {
      const history = pushEditHistory(state);
      const root = state.rootNode;
      const rootBoardSize = getBoardSizeFromBoard(root.gameState.board);
      const oldHandicap = parseHandicapProperty(root.properties, rootBoardSize);
      const nextBoard = applyRootHandicap(root.gameState.board, rootBoardSize, oldHandicap, nextHandicap);
      const nextPlayer: Player = nextHandicap > 0 ? 'white' : 'black';
      root.properties = root.properties ?? {};
      if (nextHandicap > 0) {
        root.properties.HA = [String(nextHandicap)];
        root.properties.PL = ['W'];
      } else {
        delete root.properties.HA;
        if (root.properties.PL?.[0] === 'W') delete root.properties.PL;
      }
      root.gameState = {
        ...root.gameState,
        board: nextBoard,
        currentPlayer: nextPlayer,
        moveHistory: [],
        capturedBlack: 0,
        capturedWhite: 0,
      };
      syncRootSetupPropertiesFromBoard(root.properties, nextBoard, rootBoardSize, nextHandicap);
      clearAnalysisInSubtree(root);
      // Moves on a new handicap point cannot be replayed and go, with their
      // lines. That happened silently, the cursor dropping to the root, where
      // every other edit that prunes says so and offers Undo.
      const pruned = rebuildDescendants(root, isSuicideLegal(get().settings.gameRules));
      const currentNode = findNodeById(root, state.currentNode.id) ?? root;
      const handicapLabel = nextHandicap > 0 ? `Handicap set to ${nextHandicap}.` : 'Handicap removed.';

      return {
        currentNode,
        board: currentNode.gameState.board,
        currentPlayer: currentNode.gameState.currentPlayer,
        moveHistory: currentNode.gameState.moveHistory,
        capturedBlack: currentNode.gameState.capturedBlack,
        capturedWhite: currentNode.gameState.capturedWhite,
        analysisData: null,
        analysisCacheSize: 0,
        isContinuousAnalysis: false,
        isSelfplayToEnd: false,
        setupPositionProgress: null,
        isGameAnalysisRunning: false,
        gameAnalysisType: null,
        engineStatus: 'idle',
        engineError: null,
        ...history,
        treeVersion: state.treeVersion + 1,
        ...(pruned > 0
          ? {
            notification: {
              message: `${handicapLabel} ${pruned} ${pruned === 1 ? 'node' : 'nodes'} no longer fit the stones and ${pruned === 1 ? 'was' : 'were'} removed.`,
              type: 'info' as const,
              undoable: true,
            },
          }
          : {}),
      };
    });
  },

  setRootProperty: (key, value) => {
    const normalizedKey = key.toUpperCase();
    if (normalizedKey === 'KM') {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) get().setKomi(parsed);
      return;
    }
    if (normalizedKey === 'RU') {
      const parsed = parseSgfRu(value.trim());
      if (parsed) {
        const current = get();
        const canonical = rulesToSgfRu(parsed);
        if (parsed === current.settings.gameRules) {
          set((state) => {
            const currentRulesText = state.rootNode.properties?.RU?.[0] ?? '';
            if (currentRulesText === canonical) return {};
            const history = pushEditHistory(state);
            state.rootNode.properties = state.rootNode.properties ?? {};
            state.rootNode.properties.RU = [canonical];
            return { ...history, rootNode: state.rootNode, treeVersion: state.treeVersion + 1 };
          });
        } else {
          current.updateSettings({ gameRules: parsed });
        }
        return;
      }
    }
    if (normalizedKey === 'HA') {
      const trimmed = value.trim();
      if (!trimmed) {
        get().setHandicap(0);
        return;
      }
      const parsed = Number.parseInt(trimmed, 10);
      if (Number.isFinite(parsed)) get().setHandicap(parsed);
      return;
    }

    set((state) => {
      const trimmed = value.trim();
      const currentValue = state.rootNode.properties?.[key]?.[0] ?? '';
      if (currentValue === trimmed) return {};
      const history = pushEditHistory(state);
      state.rootNode.properties = state.rootNode.properties ?? {};
      if (!trimmed) {
        delete state.rootNode.properties[key];
      } else {
        state.rootNode.properties[key] = [trimmed];
      }
      return { ...history, rootNode: state.rootNode, treeVersion: state.treeVersion + 1 };
    });
  },

  // Note edits are undoable edits. Unrecorded, "Undo edit" restored a tree
  // snapshot from before them and took the note with it.
  setCurrentNodeNote: (note) =>
    set((state) => {
      if ((state.currentNode.note ?? '') === note) return {};
      const history = pushEditHistory(state);
      state.currentNode.note = note;
      return { ...history, treeVersion: state.treeVersion + 1 };
    }),

  setNodeNote: (nodeId, note) =>
    set((state) => {
      const node = findNodeById(state.rootNode, nodeId);
      // The node can be gone -- a branch deleted while its note was open.
      if (!node || (node.note ?? '') === note) return {};
      const history = pushEditHistory(state);
      node.note = note;
      return { ...history, treeVersion: state.treeVersion + 1 };
    }),

  playMove: (x: number, y: number, isLoad = false) => {
    const state = get();
    if (!isLoad && isAwaitingAiReply(state)) {
      refuseWhileAwaitingAi(set, get);
      return;
    }

    // Check if we are loading or playing normally.
    // First, check if move exists in children (Navigation)
    const existingChild = state.currentNode.children.find(child =>
        child.move && child.move.x === x && child.move.y === y && child.move.player === state.currentPlayer
    );

    if (existingChild && !isLoad) {
       // Navigate to existing child. The AI and analysis still have to be
       // woken as for a new move: after an undo (or a teaching undo) the
       // same point replayed used to leave the game stalled on the human's
       // clock, because only the new-move path scheduled the reply.
       //
       // Stepping into a recorded move is still placing a stone, so it sounds
       // like one.
       playStepSound({ enabled: state.settings.soundEnabled, from: state.currentNode, to: existingChild });
       skipNavigationSoundForNodeId = existingChild.id;
       get().jumpToNode(existingChild);
       lastPlayedNodeId = existingChild.id;
       const after = get();
       if (after.isAiPlaying && after.currentPlayer === after.aiColor) {
         get().scheduleAiMove(500);
       }
       if (after.isAnalysisMode && !after.isSelfplayToEnd) {
         scheduleAnalysis(() => void get().runAnalysis({ ifIdle: true }), 500);
       }
       return;
    }

    // New Move Logic
    // Validate against the same simple-ko/no-suicide rules used by the engine presets exposed in the UI.
    if (
      !isValidMove(state.board, x, y, state.currentPlayer, koReferenceBoard(state.currentNode), {
        multiStoneSuicideLegal: isSuicideLegal(state.settings.gameRules),
      })
    )
      return;

	    const tentativeBoard = state.board.map((row) => [...row]);
	    tentativeBoard[y][x] = state.currentPlayer;

	    const captured = applyCapturesInPlace(tentativeBoard, x, y, state.currentPlayer);
	    const newBoard = tentativeBoard;

    // Suicide check. Rulesets that allow it still only allow it for a group of
    // more than one stone, matching isValidMove above, and the group it kills
    // comes off the board as the opponent's prisoners.
    let selfCaptured = 0;
    if (captured.length === 0) {
      const { liberties, group } = getLiberties(newBoard, x, y);
      if (liberties === 0) {
        if (!isSuicideLegal(state.settings.gameRules) || group.length <= 1) return;
        selfCaptured = applySelfCaptureInPlace(newBoard, x, y).length;
      }
    }

    // Simple ko: the position before the last move must not come straight back.
    const koBoard = koReferenceBoard(state.currentNode);
    if (koBoard && boardsEqual(newBoard, koBoard)) {
        return;
    }

    // Superko, where the ruleset asks for it: walk this line's history and
    // refuse anything that repeats a position we have already been in.
    const koRule = rulesOf(state.settings.gameRules).ko;
    {
      const nextPlayerToMove: Player = state.currentPlayer === 'black' ? 'white' : 'black';
      if (lineViolatesSuperko(state.currentNode, newBoard, nextPlayerToMove, koRule)) {
        set({ notification: { message: superkoRejectionMessage(koRule, get().settings.appLocale), type: 'error' } });
        return;
      }
    }

    if (!isLoad) {
      if (state.settings.soundEnabled) {
          playStoneSound();
          if (captured.length > 0) {
              setTimeout(() => playCaptureSound(captured.length), 100);
          }
      }
    }

    const newCapturedBlack =
      state.capturedBlack +
      (state.currentPlayer === 'white' ? captured.length : 0) +
      (state.currentPlayer === 'black' ? selfCaptured : 0);
    const newCapturedWhite =
      state.capturedWhite +
      (state.currentPlayer === 'black' ? captured.length : 0) +
      (state.currentPlayer === 'white' ? selfCaptured : 0);
    const nextPlayer: Player = state.currentPlayer === 'black' ? 'white' : 'black';

    const move: Move = { x, y, player: state.currentPlayer };

    const newGameState: GameState = {
        board: newBoard,
        currentPlayer: nextPlayer,
        moveHistory: [...state.moveHistory, move],
        capturedBlack: newCapturedBlack,
        capturedWhite: newCapturedWhite,
        komi: state.komi,
    };

    const newNode = createNode(state.currentNode, move, newGameState);
    lastPlayedNodeId = newNode.id;
    skipNavigationSoundForNodeId = newNode.id;
    state.currentNode.children.push(newNode);

    set({
      // "Undo edit" restores a whole-tree snapshot, so one taken before this
      // move would take the move away with the edit -- and a later edit would
      // clear the redo that could bring it back. Playing on starts afresh.
      ...clearEditHistory(),
      currentNode: newNode,
      board: newGameState.board,
      currentPlayer: newGameState.currentPlayer,
      moveHistory: newGameState.moveHistory,
      capturedBlack: newGameState.capturedBlack,
      capturedWhite: newGameState.capturedWhite,
      analysisData: null, // Clear old analysis
      activeBranchChildIds: rememberActiveBranchPath(state.activeBranchChildIds, newNode),
      treeVersion: state.treeVersion + 1,
    });

    if (!isLoad) {
      const newState = get();
      if (newState.isAiPlaying && newState.currentPlayer === newState.aiColor) {
        get().scheduleAiMove(500);
      }
	      if (newState.isAnalysisMode && !newState.isSelfplayToEnd) {
	          scheduleAnalysis(() => void get().runAnalysis({ ifIdle: true }), 500);
	      }
	    }
	  },

  scheduleAiMove: (delayMs = 0) => {
    const state = get();
    if (!state.isAiPlaying || state.currentPlayer !== state.aiColor) return;
    aiMoveWorkIsOnDemand = false;
    scheduleAiMoveTask(() => get().makeAiMove(), delayMs);
  },

	  makeAiMove: (opts) => {
	      const force = opts?.force ?? false;
	      const state = get();
	      // `force` lets the on-demand "AI move" buttons play one engine move for
	      // the side to move even outside an AI game or on the human's turn.
	      if (!force) {
	        if (!state.isAiPlaying || !state.aiColor) return;
	        if (state.currentPlayer !== state.aiColor) return;
	        // While the engine is playing both sides -- generating a set-up
	        // position, or playing to the end -- the opponent waits: it answered
	        // every move the generator made, so half the position came from a
	        // full-strength opponent instead of the score-steered generator.
	        if (state.setupPositionProgress || state.isSelfplayToEnd) return;
	      }

	      const node = state.currentNode;
	      const nodeId = node.id;
	      const playerAtStart = state.currentPlayer;
        cancelAiMoveWork();
        aiMoveWorkIsOnDemand = force && !(state.isAiPlaying && state.aiColor === playerAtStart);
        const generation = aiMoveGeneration;
        const position = node.gameState;
        const revision = analysisRevision;
        const ownsPosition = (): boolean => {
          const latest = get();
          return generation === aiMoveGeneration && latest.currentNode.id === nodeId
            && latest.currentNode.gameState === position && latest.currentPlayer === playerAtStart
            && (force || (latest.isAiPlaying && latest.aiColor === playerAtStart));
        };

	      const { previousBoard: parentBoard, previousPreviousBoard: grandparentBoard } = engineHistoryBoards(node);
	      const modelUrl = resolveModelUrlForFetch(state.settings.katagoModelUrl);
        const rules = state.settings.gameRules;
        const analysisPvLen = state.settings.katagoAnalysisPvLen;
        const wideRootNoise = 0;
        const rootPolicyTemperature = 1;
        const fillDameBeforePass = state.settings.katagoFillDameBeforePass;
        const nnRandomize = false;
        const conservativePass = state.settings.katagoConservativePass;
        const aiNeedsMovesOwnership = state.settings.aiStrategy === 'simple' || state.settings.aiStrategy === 'settle';
        const aiWantsHumanPolicy = state.settings.aiStrategy === 'human' && !!state.settings.humanSlModelUrl;
        // KataHandicap: read the position as if one side had more search, which
        // is what makes a strong bot keep pressing in a handicap game instead of
        // trading down into a quiet, already-decided endgame.
        const handicapPda =
          state.settings.aiStrategy === 'handicap'
            ? handicapPlayoutDoublingAdvantage({
                automatic: state.settings.aiHandicapAutomatic !== false,
                manualPda: state.settings.aiHandicapPda ?? 0,
                handicapStones: countRootHandicapStones(state.rootNode),
                komi: state.komi,
              })
            : 0;
        const aiOwnershipMode = aiNeedsMovesOwnership ? 'tree' : state.settings.katagoOwnershipMode;
        const topK =
          state.settings.aiStrategy === 'default'
            ? state.settings.katagoTopK
            : Math.max(state.settings.katagoTopK, 30);
        const visits = clampAnalysisVisits(state.settings.katagoVisits);
        const maxTimeMs = Math.max(25, Math.min(state.settings.katagoMaxTimeMs, ENGINE_MAX_TIME_MS));
        const batchSize = state.settings.katagoBatchSize;
        const maxChildren = state.settings.katagoMaxChildren;
        const positionKey = nodeAnalysisPositionKey(node, rules);
        const parentPositionKeyValue = parentAnalysisPositionKey(node, rules);

      // An AI move can take many seconds. Without this the engine pill kept
      // reading "KataGo ready" the whole time, so a thinking AI was
      // indistinguishable from a hung one.
      set({ isAiThinking: true });
      // The canceled branch below reschedules itself; keep the indicator lit
      // across that hand-off instead of flickering off for 100ms.
      let retryScheduled = false;

      void analysisQueue
        .enqueue<KataGoAnalysisPayload>({
          id: `ai-move:${nodeId}`,
          label: 'AI move',
          group: 'ai-move',
          priority: ANALYSIS_QUEUE_PRIORITY.aiMove,
          staleKey: `ai-move:${playerAtStart}`,
          cacheKey: analysisCacheKey(
            'ai-move',
            nodeId,
            positionKey,
            modelUrl,
            state.settings.katagoBackend,
            rules,
            topK,
            aiNeedsMovesOwnership,
            analysisPvLen,
            conservativePass,
            visits,
            maxTimeMs,
            batchSize,
            maxChildren,
            state.settings.katagoReuseTree,
            aiOwnershipMode,
            state.settings.aiStrategy,
            aiWantsHumanPolicy ? state.settings.humanSlProfile : '',
            aiWantsHumanPolicy ? state.settings.humanSlModelUrl : '',
            aiWantsHumanPolicy ? state.settings.humanSlBotStyle : '',
            handicapPda
          ),
          // See runAnalysis: a remote engine ranks queries itself and its other
          // work should survive; the local worker needs the client-side cancel.
          preempt: !isRemoteEngine(state.settings),
          run: (ctx) => getEngineClient(get().settings).analyze({
	          positionId: nodeId,
	          parentPositionId: node.parent?.id,
            positionKey,
            parentPositionKey: parentPositionKeyValue,
	          modelUrl,
            backend: state.settings.katagoBackend,
	          board: state.board,
	          previousBoard: parentBoard,
	          previousPreviousBoard: grandparentBoard,
	          currentPlayer: state.currentPlayer,
	          moveHistory: state.moveHistory,
	          repetitionHistory: repetitionHistoryForNode(node, rules),
	          komi: komiWithHandicapBonus(state.rootNode.gameState.board, rules, state.komi),
            rules,
	          topK,
            includeMovesOwnership: aiNeedsMovesOwnership,
            analysisPvLen,
            wideRootNoise,
            rootPolicyTemperature,
            fillDameBeforePass,
            playoutDoublingAdvantage: handicapPda,
            playoutDoublingAdvantagePla: 'black',
            nnRandomize,
            conservativePass,
            humanModelUrl: aiWantsHumanPolicy ? state.settings.humanSlModelUrl : undefined,
            humanSlProfile: aiWantsHumanPolicy ? state.settings.humanSlProfile : undefined,
            humanSlRootExploreProb:
              state.settings.aiStrategy === 'human'
                ? humanBotPresets[state.settings.humanSlBotStyle].rootExploreProbWeightless
                : undefined,
          visits,
          maxTimeMs,
          batchSize,
          maxChildren,
          reuseTree: state.settings.katagoReuseTree,
          ownershipMode: aiOwnershipMode,
          analysisGroup: 'background',
          priority: ctx.priority,
          signal: ctx.signal,
          }),
        })
        .then((analysis) => {
          if (!ownsPosition()) return;
          // Settings changed under the search (model, rules, visits): its
          // answer is for the old ones. Dropped, it left the AI to move with
          // nothing searching; ask again under the new ones.
          if (revision !== analysisRevision) {
            retryScheduled = true;
            scheduleAiMoveTask(() => {
              if (ownsPosition()) get().makeAiMove(force ? { force: true } : undefined);
              else set({ isAiThinking: false });
            }, 100, () => set({ isAiThinking: false }));
            return;
          }
          const engineInfo = getEngineClient(get().settings).getEngineInfo();
          set({ engineBackend: engineInfo.backend, engineModelName: engineInfo.modelName, engineBackendNote: engineInfo.backendNote });

          const latest = get();
          const settings = latest.settings;
          const boardSize = getBoardSizeFromBoard(latest.board);

          const analysisWithTerritory: AnalysisResult = {
            rootWinRate: analysis.rootWinRate,
            rootScoreLead: analysis.rootScoreLead,
            rootScoreSelfplay: analysis.rootScoreSelfplay,
            rootScoreStdev: analysis.rootScoreStdev,
            rootVisits: analysis.rootVisits,
            rawWinRate: analysis.rawWinRate,
            rawScoreLead: analysis.rawScoreLead,
            rawScoreSelfplay: analysis.rawScoreSelfplay,
            rawScoreSelfplayStdev: analysis.rawScoreSelfplayStdev,
            rawNoResultProb: analysis.rawNoResultProb,
            rawStWrError: analysis.rawStWrError,
            rawStScoreError: analysis.rawStScoreError,
            rawVarTimeLeft: analysis.rawVarTimeLeft,
            moves: analysis.moves,
            territory: ownershipToTerritoryGrid(analysis.ownership, boardSize),
            policy: analysis.policy,
            humanPolicy: analysis.humanPolicy,
            ownershipStdev: analysis.ownershipStdev,
            ownershipMode: aiOwnershipMode,
          };

          // Cache analysis on the node we analyzed -- unless the search was
          // biased for choosing a move (Handicap's playout-doubling advantage,
          // Human's root exploration), which is not the position's evaluation:
          // stored, it became the player's points lost and graph, and was
          // never re-read. Nor over a deeper result already there.
          const aiSearchIsBiased = handicapPda !== 0 || state.settings.aiStrategy === 'human';
          if (!aiSearchIsBiased && !(node.analysis && analysis.rootVisits < nodeAnalysisVisitCount(node))) {
            node.analysis = analysisWithTerritory;
          }

          type PolicyMove = { prob: number; x: number; y: number; isPass: boolean };
          const policyRanking = (policy: FloatArray): PolicyMove[] => {
            const out: PolicyMove[] = [];
            for (let y = 0; y < boardSize; y++) {
              for (let x = 0; x < boardSize; x++) {
                const p = policy[y * boardSize + x] ?? -1;
                if (p > 0) out.push({ prob: p, x, y, isPass: false });
              }
            }
            const pass = policy[boardSize * boardSize] ?? -1;
            if (pass > 0) out.push({ prob: pass, x: -1, y: -1, isPass: true });
            out.sort((a, b) => b.prob - a.prob);
            return out;
          };

          const pickOneWeighted = <T,>(items: Array<{ weight: number; value: T }>): T | null => {
            let total = 0;
            for (const it of items) {
              if (it.weight > 0 && Number.isFinite(it.weight)) total += it.weight;
            }
            if (!(total > 0)) return null;
            let r = Math.random() * total;
            for (const it of items) {
              const w = it.weight;
              if (!(w > 0) || !Number.isFinite(w)) continue;
              if (r < w) return it.value;
              r -= w;
            }
            return items.length > 0 ? items[items.length - 1]!.value : null;
          };

          const weightedSampleWithoutReplacement = <T,>(
            items: T[],
            n: number,
            weightFn: (item: T) => number
          ): T[] => {
            const scored = items.map((item) => {
              const w = Math.max(1e-18, weightFn(item));
              const u = Math.random();
              const key = Math.log(Math.max(1e-18, u)) / w;
              return { key, item };
            });
            scored.sort((a, b) => b.key - a.key);
            return scored.slice(0, Math.min(Math.max(0, n), scored.length)).map((s) => s.item);
          };

          const chooseByStrategy = (): { x: number; y: number; thoughts: string } | null => {
            const strategy = settings.aiStrategy;
            const candidates = analysisWithTerritory.moves ?? [];

            const best =
              candidates.find((m) => m.order === 0) ?? candidates[0] ?? null;
            const bestLabel = best ? formatGtpMove(best.x, best.y, boardSize) : 'pass';

            if (strategy === 'default') {
              if (!best) return null;
              return {
                x: best.x,
                y: best.y,
                thoughts: `Default strategy chose top move ${bestLabel}.`,
              };
            }

            if (strategy === 'human') {
              const humanPolicy = analysisWithTerritory.humanPolicy;
              if (humanPolicy) {
                const pick = pickHumanBotMove({
                  humanPolicy,
                  boardSize,
                  engineBest: best,
                  candidates,
                  playerToMove: playerAtStart,
                  turnNumber: latest.moveHistory.length,
                  params: humanBotPresets[settings.humanSlBotStyle],
                  isLegal: (x, y) => isValidMove(latest.board, x, y, playerAtStart, koReferenceBoard(node)),
                });
                if (pick) {
                  return {
                    x: pick.x,
                    y: pick.y,
                    thoughts: describeHumanBotPick(pick, settings.humanSlProfile, boardSize, get().settings.appLocale),
                  };
                }
              }
              // Without the human net there is nothing human to imitate, so fall back
              // to the engine's own move rather than playing something random.
              if (!best) return null;
              return {
                x: best.x,
                y: best.y,
                thoughts: `Human profile unavailable, played the engine's move ${bestLabel}.`,
              };
            }

            if (strategy === 'antimirror') {
              if (!best) return null;
              const mirroring = isOpponentMirroring({
                moveHistory: latest.moveHistory,
                boardSize,
                rootPlayer: playerAtStart,
              });
              if (!mirroring) {
                return {
                  x: best.x,
                  y: best.y,
                  thoughts: `AntiMirror: opponent is not mirroring, played top move ${bestLabel}.`,
                };
              }
              const choice = chooseAntiMirrorMove({
                candidates,
                board: latest.board,
                boardSize,
                opponent: playerAtStart === 'black' ? 'white' : 'black',
              });
              if (!choice) {
                return {
                  x: best.x,
                  y: best.y,
                  thoughts: `AntiMirror: mirror detected, but no center move was affordable — played ${bestLabel}.`,
                };
              }
              const label = formatGtpMove(choice.move.x, choice.move.y, boardSize);
              return {
                x: choice.move.x,
                y: choice.move.y,
                thoughts: `AntiMirror: mirror detected, ${choice.reason} with ${label} (pointsLost ${choice.move.pointsLost.toFixed(1)}).`,
              };
            }

            // KaTrain passes before applying these strategies when the top
            // move is a pass -- "don't play suicidal to balance score". Jigo
            // otherwise filled its own territory to close the gap at the end.
            if ((strategy === 'scoreloss' || strategy === 'jigo') && best && (best.x < 0 || best.y < 0)) {
              return { x: best.x, y: best.y, thoughts: `${strategy === 'jigo' ? 'Jigo' : 'ScoreLoss'}: top move is pass, so passing regardless of strategy.` };
            }

            if (strategy === 'scoreloss') {
              if (candidates.length === 0) return null;
              const c = Math.max(0, settings.aiScoreLossStrength);
              const weighted = candidates.map((m) => ({
                weight: Math.exp(Math.min(200, -c * Math.max(0, m.pointsLost))),
                value: m,
              }));
              const picked = pickOneWeighted(weighted);
              if (!picked) return null;
              const label = formatGtpMove(picked.x, picked.y, boardSize);
              return {
                x: picked.x,
                y: picked.y,
                thoughts: `ScoreLoss picked ${label} (pointsLost ${picked.pointsLost.toFixed(1)}, strength ${c}).`,
              };
            }

            if (strategy === 'jigo') {
              if (candidates.length === 0) return null;
              const target = settings.aiJigoTargetScore;
              const sign = playerAtStart === 'black' ? 1 : -1;

              let bestCand = candidates[0]!;
              let bestDiff = Math.abs(sign * bestCand.scoreLead - target);
              for (const m of candidates) {
                const diff = Math.abs(sign * m.scoreLead - target);
                if (diff < bestDiff) {
                  bestDiff = diff;
                  bestCand = m;
                }
              }
              const label = formatGtpMove(bestCand.x, bestCand.y, boardSize);
              return {
                x: bestCand.x,
                y: bestCand.y,
                thoughts: `Jigo picked ${label} (target ${target}, diff ${bestDiff.toFixed(1)}).`,
              };
            }

            if (strategy === 'simple' || strategy === 'settle') {
              const modeName = strategy === 'simple' ? 'ai:simple' : 'ai:settle';

              if (candidates.length === 0) return null;
              const topCand = candidates[0]!;
              if (topCand.x < 0 || topCand.y < 0) {
                return { x: topCand.x, y: topCand.y, thoughts: `${modeName}: top move is pass.` };
              }

              const nextPlayer = playerAtStart;
              const lastMovePlayer = latest.currentNode.move?.player ?? null;

              const inBounds = (x: number, y: number) => x >= 0 && x < boardSize && y >= 0 && y < boardSize;

              const isAttachment = (x: number, y: number): boolean => {
                if (x < 0 || y < 0) return false;
                // KaTrain: self.cn.player is last mover; if none, no attachment penalty.
                if (!lastMovePlayer) return false;

                const opp = lastMovePlayer;
                let attachOpp = 0;
                const dirs: Array<[number, number]> = [
                  [1, 0],
                  [-1, 0],
                  [0, 1],
                  [0, -1],
                ];
                for (const [dx, dy] of dirs) {
                  const nx = x + dx;
                  const ny = y + dy;
                  if (!inBounds(nx, ny)) continue;
                  if (latest.board[ny]?.[nx] === opp) attachOpp++;
                }

                let nearbyOwn = 0;
                // NOTE: Mirrors KaTrain upstream exactly (including its odd ranges).
                const dxs = [-2, 0, 1, 2];
                const dys = [-3, 0, 1, 2];
                for (const dx of dxs) {
                  for (const dy of dys) {
                    if (Math.abs(dx) + Math.abs(dy) > 2) continue;
                    const nx = x + dx;
                    const ny = y + dy;
                    if (!inBounds(nx, ny)) continue;
                    if (latest.board[ny]?.[nx] === nextPlayer) nearbyOwn++;
                  }
                }

                return attachOpp >= 1 && nearbyOwn === 0;
              };

              const isTenuki = (x: number, y: number): boolean => {
                if (x < 0 || y < 0) return false;
                const a = latest.currentNode;
                const b = latest.currentNode.parent;
                if (!a || !a.move || a.move.x < 0 || a.move.y < 0) return false;
                if (!b || !b.move || b.move.x < 0 || b.move.y < 0) return false;

              const cheb = (m: Move) => Math.max(Math.abs(m.x - x), Math.abs(m.y - y));
              return cheb(a.move) >= 5 && cheb(b.move) >= 5;
            };

              const settledness = (ownership: FloatArray, player: Player): number => {
                if (strategy === 'simple') {
                  const sign = player === 'black' ? 1 : -1;
                  let sum = 0;
                  for (const o of ownership) {
                    if (sign * o > 0) sum += Math.abs(o);
                  }
                  return sum;
                }

                // settle: sum |ownership| for existing stones of the player
                let sum = 0;
                for (let yy = 0; yy < boardSize; yy++) {
                  for (let xx = 0; xx < boardSize; xx++) {
                    if (latest.board[yy]?.[xx] !== player) continue;
                    const v = ownership[yy * boardSize + xx] ?? 0;
                    sum += Math.abs(v);
                  }
                }
                return sum;
              };

              const maxPointsLost = settings.aiOwnershipMaxPointsLost;
              const settledWeight = settings.aiOwnershipSettledWeight;
              const opponentFac = settings.aiOwnershipOpponentFac;
              const minVisits = settings.aiOwnershipMinVisits;
              const attachPenalty = settings.aiOwnershipAttachPenalty;
              const tenukiPenalty = settings.aiOwnershipTenukiPenalty;

              type Scored = {
                move: CandidateMove;
                ownSettled: number;
                oppSettled: number;
                attach: boolean;
                tenuki: boolean;
                score: number;
              };
              const scored: Scored[] = [];

              for (const m of candidates) {
                if (m.pointsLost >= maxPointsLost) continue;
                if (!m.ownership || m.ownership.length < boardSize * boardSize) continue;
                if (!(m.order <= 1 || m.visits >= minVisits)) continue;
                const isPass = m.x < 0 || m.y < 0;
                if (isPass && m.pointsLost > 0.75) continue;

                const ownSettled = settledness(m.ownership, nextPlayer);
                const oppSettled =
                  strategy === 'settle'
                    ? lastMovePlayer
                      ? settledness(m.ownership, lastMovePlayer)
                      : 0
                    : settledness(m.ownership, nextPlayer === 'black' ? 'white' : 'black');
                const attach = isAttachment(m.x, m.y);
                const tenuki = isTenuki(m.x, m.y);
                const score =
                  m.pointsLost +
                  attachPenalty * (attach ? 1 : 0) +
                  tenukiPenalty * (tenuki ? 1 : 0) -
                  settledWeight * (ownSettled + opponentFac * oppSettled);

                scored.push({ move: m, ownSettled, oppSettled, attach, tenuki, score });
              }

              scored.sort((a, b) => a.score - b.score);
              const best = scored[0]?.move ?? candidates[0]!;
              if (scored.length === 0) {
                return { x: best.x, y: best.y, thoughts: `${modeName}: no moves with ownership; playing top move.` };
              }

              const top5 = scored.slice(0, 5).map((s) => {
                const mv = s.move;
                const label = formatGtpMove(mv.x, mv.y, boardSize);
                return `${label} (${mv.pointsLost.toFixed(1)} pt lost, ${mv.visits} visits, ${s.ownSettled.toFixed(1)} settledness, ${s.oppSettled.toFixed(1)} opponent settledness${s.attach ? ', attachment' : ''}${s.tenuki ? ', tenuki' : ''})`;
              });

              return {
                x: scored[0]!.move.x,
                y: scored[0]!.move.y,
                thoughts: `${modeName} strategy. Top 5 Candidates ${top5.join(', ')} `,
              };
            }

            const policy = analysisWithTerritory.policy;
            const policyMoves = policy ? policyRanking(policy) : [];
            if (policyMoves.length === 0) {
              if (!best) return null;
              return {
                x: best.x,
                y: best.y,
                thoughts: `No policy available; fell back to top move ${bestLabel}.`,
              };
            }

            const top5Pass = policyMoves.slice(0, 5).some((m) => m.isPass);

            const shouldPlayTopMove = (override: number, overridetwo = 1.0): { move: PolicyMove; thoughts: string } | null => {
              const top = policyMoves[0]!;
              if (top5Pass) return { move: top, thoughts: 'Playing top policy move because pass is in top 5.' };
              if (top.prob > override) return { move: top, thoughts: `Top policy move prob > ${override}.` };
              const second = policyMoves[1];
              if (second && top.prob + second.prob > overridetwo) {
                return { move: top, thoughts: `Top 2 policy moves prob sum > ${overridetwo}.` };
              }
              return null;
            };

            const passProb = policy?.[boardSize * boardSize] ?? -1;
            const legalPolicyMoves = policyMoves.filter((m) => !m.isPass && m.prob > 0);

            type WeightedCoord = { score: number; weight: number; x: number; y: number };

            const pickFromWeightedCoords = (
              weightedCoords: WeightedCoord[],
              nMoves: number,
              strategyName: string
            ): { x: number; y: number; thoughts: string } => {
              const picked = weightedSampleWithoutReplacement(weightedCoords, nMoves, (c) => c.weight);

              if (picked.length === 0) {
                const top = policyMoves[0]!;
                return { x: top.x, y: top.y, thoughts: `${strategyName}: no moves selected; playing top policy move.` };
              }

              picked.sort((a, b) => (b.score - a.score) || (b.weight - a.weight));
              const topPicked = picked[0]!;

              if (passProb > 0 && topPicked.score < passProb) {
                const top = policyMoves[0]!;
                return {
                  x: top.x,
                  y: top.y,
                  thoughts: `${strategyName}: pass prob ${(passProb * 100).toFixed(2)}% > picked ${(topPicked.score * 100).toFixed(2)}%; playing top policy move.`,
                };
              }

              return {
                x: topPicked.x,
                y: topPicked.y,
                thoughts: `${strategyName}: picked from ${Math.min(nMoves, weightedCoords.length)} sampled moves.`,
              };
            };

            const getPickNMoves = (pickFrac: number, pickN: number, legalCount: number): number =>
              Math.max(1, Math.floor(Math.max(0, pickFrac) * legalCount + Math.max(0, pickN)));

            const fallbackWeightedPolicy = (reason: string): { x: number; y: number; thoughts: string } => {
              const weakenFac = 1.0;
              const lowerBound = 0.02;
              const override = 0.9;

              const forced = shouldPlayTopMove(override);
              if (forced) return { x: forced.move.x, y: forced.move.y, thoughts: `${reason}: ${forced.thoughts}` };

              const weighted = policyMoves
                .filter((m) => !m.isPass && m.prob > lowerBound)
                .map((m) => ({ weight: Math.pow(m.prob, 1 / weakenFac), value: m }));
              const picked = pickOneWeighted(weighted) ?? policyMoves[0]!;
              return {
                x: picked.x,
                y: picked.y,
                thoughts: `${reason}: fallback weighted policy (lower_bound ${lowerBound}, weaken_fac ${weakenFac}).`,
              };
            };

            if (strategy === 'pick') {
              const override = Math.max(0, settings.aiPickPickOverride);
              const forced = shouldPlayTopMove(override);
              if (forced) return { x: forced.move.x, y: forced.move.y, thoughts: forced.thoughts };

              const nMoves = getPickNMoves(settings.aiPickPickFrac, settings.aiPickPickN, legalPolicyMoves.length);
              const weightedCoords: WeightedCoord[] = legalPolicyMoves.map((m) => ({
                score: m.prob,
                weight: 1,
                x: m.x,
                y: m.y,
              }));
              return pickFromWeightedCoords(weightedCoords, nMoves, 'Pick');
            }

            if (strategy === 'local' || strategy === 'tenuki') {
              const lastMove = latest.currentNode.move;
              if (!lastMove || lastMove.x < 0 || lastMove.y < 0) {
                return fallbackWeightedPolicy(strategy === 'local' ? 'Local: no previous move' : 'Tenuki: no previous move');
              }

              const override = Math.max(0, strategy === 'local' ? settings.aiLocalPickOverride : settings.aiTenukiPickOverride);
              const forced = shouldPlayTopMove(override);
              if (forced) return { x: forced.move.x, y: forced.move.y, thoughts: forced.thoughts };

              const boardSquares = boardSize * boardSize;
              const depth = latest.moveHistory.length;
              const endgame = Math.max(0, strategy === 'local' ? settings.aiLocalEndgame : settings.aiTenukiEndgame);
              const pickFrac = strategy === 'local' ? settings.aiLocalPickFrac : settings.aiTenukiPickFrac;
              const pickN = strategy === 'local' ? settings.aiLocalPickN : settings.aiTenukiPickN;

              if (depth > endgame * boardSquares) {
                const baseN = getPickNMoves(pickFrac, pickN, legalPolicyMoves.length);
                const nMoves = Math.floor(Math.max(baseN, Math.floor(legalPolicyMoves.length / 2)));
                const endCoords: WeightedCoord[] = legalPolicyMoves.map((m) => ({
                  score: m.prob,
                  weight: 1,
                  x: m.x,
                  y: m.y,
                }));
                return pickFromWeightedCoords(endCoords, nMoves, strategy === 'local' ? 'Local endgame' : 'Tenuki endgame');
              }

              const stddev = Math.max(0, strategy === 'local' ? settings.aiLocalStddev : settings.aiTenukiStddev);
              const var_ = stddev * stddev;
              if (!(var_ > 0)) {
                return fallbackWeightedPolicy(strategy === 'local' ? 'Local: stddev <= 0' : 'Tenuki: stddev <= 0');
              }

              const weightedCoords: WeightedCoord[] = legalPolicyMoves.map((m) => {
                const dx = m.x - lastMove.x;
                const dy = m.y - lastMove.y;
                const gaussian = Math.exp(-0.5 * (dx * dx + dy * dy) / var_);
                const w = strategy === 'tenuki' ? 1 - gaussian : gaussian;
                return {
                  score: m.prob,
                  weight: Number.isFinite(w) ? Math.max(0, w) : 0,
                  x: m.x,
                  y: m.y,
                };
              });

              const nMoves = getPickNMoves(pickFrac, pickN, legalPolicyMoves.length);
              return pickFromWeightedCoords(weightedCoords, nMoves, strategy === 'local' ? 'Local' : 'Tenuki');
            }

            if (strategy === 'influence' || strategy === 'territory') {
              const override = Math.max(0, strategy === 'influence' ? settings.aiInfluencePickOverride : settings.aiTerritoryPickOverride);
              const forced = shouldPlayTopMove(override);
              if (forced) return { x: forced.move.x, y: forced.move.y, thoughts: forced.thoughts };

              const boardSquares = boardSize * boardSize;
              const depth = latest.moveHistory.length;
              const endgame = Math.max(0, strategy === 'influence' ? settings.aiInfluenceEndgame : settings.aiTerritoryEndgame);
              const pickFrac = strategy === 'influence' ? settings.aiInfluencePickFrac : settings.aiTerritoryPickFrac;
              const pickN = strategy === 'influence' ? settings.aiInfluencePickN : settings.aiTerritoryPickN;

              if (depth > endgame * boardSquares) {
                const baseN = getPickNMoves(pickFrac, pickN, legalPolicyMoves.length);
                const nMoves = Math.floor(Math.max(baseN, Math.floor(legalPolicyMoves.length / 2)));
                const endCoords: WeightedCoord[] = legalPolicyMoves.map((m) => ({
                  score: m.prob,
                  weight: 1,
                  x: m.x,
                  y: m.y,
                }));
                return pickFromWeightedCoords(endCoords, nMoves, strategy === 'influence' ? 'Influence endgame' : 'Territory endgame');
              }

              const threshold = Math.max(0, strategy === 'influence' ? settings.aiInfluenceThreshold : settings.aiTerritoryThreshold);
              const lineWeightRaw = strategy === 'influence' ? settings.aiInfluenceLineWeight : settings.aiTerritoryLineWeight;
              const lineWeight = Math.max(1, lineWeightRaw);
              const thrLine = threshold - 1;

              const weightedCoords: WeightedCoord[] = legalPolicyMoves.map((m) => {
                const distX = Math.min(boardSize - 1 - m.x, m.x);
                const distY = Math.min(boardSize - 1 - m.y, m.y);

                let exponent = 0;
                if (strategy === 'influence') {
                  exponent = Math.max(0, thrLine - distX) + Math.max(0, thrLine - distY);
                } else {
                  const distMin = Math.min(distX, distY);
                  exponent = Math.max(0, distMin - thrLine);
                }

                const w = Math.pow(1 / lineWeight, exponent);
                // Ranked by policy times the style's line weight, as KaTrain's
                // generate_influence_territory_weights does; by raw policy the
                // style only shaped the sample, and with few moves sampled an
                // influence bot happily played the 1-1 point.
                const weight = Number.isFinite(w) ? Math.max(0, w) : 0;
                return {
                  score: m.prob * weight,
                  weight,
                  x: m.x,
                  y: m.y,
                };
              });

              const nMoves = getPickNMoves(pickFrac, pickN, legalPolicyMoves.length);
              return pickFromWeightedCoords(weightedCoords, nMoves, strategy === 'influence' ? 'Influence' : 'Territory');
            }

            if (strategy === 'rank') {
              const kyuRank = settings.aiRankKyu;
              const boardSquares = boardSize * boardSize;
              const legalPolicyMoves = policyMoves.filter((m) => !m.isPass && m.prob > 0);
              const normLegMoves = legalPolicyMoves.length / boardSquares;

              const origCalibAveModRank =
                0.063015 + (0.7624 * boardSquares) / Math.pow(10, -0.05737 * kyuRank + 1.9482);

              const exponentTerm =
                3.002 * normLegMoves * normLegMoves - normLegMoves - 0.034889 * kyuRank - 0.5097;

              const modifiedCalibAveModRank =
                (0.3931 +
                  0.6559 * normLegMoves * Math.exp(-1 * exponentTerm * exponentTerm) -
                  0.01093 * kyuRank) *
                origCalibAveModRank;

              const denominator = 1.31165 * (modifiedCalibAveModRank + 1) - 0.082653;
              const nMoves = Math.max(1, Math.round((boardSquares * normLegMoves) / denominator));

              const ratio = (boardSquares - legalPolicyMoves.length) / boardSquares;
              const override = 0.8 * (1 - 0.5 * ratio);
              const overridetwo = 0.85 + Math.max(0, 0.02 * (kyuRank - 8));

              const forced = shouldPlayTopMove(override, overridetwo);
              if (forced) return { x: forced.move.x, y: forced.move.y, thoughts: forced.thoughts };

              const sampled = weightedSampleWithoutReplacement(legalPolicyMoves, nMoves, () => 1);
              sampled.sort((a, b) => b.prob - a.prob);
              const picked = sampled[0] ?? null;

              if (!picked) {
                const top = policyMoves[0]!;
                return { x: top.x, y: top.y, thoughts: 'Rank: no legal policy moves; playing top policy move.' };
              }

              if (passProb > picked.prob) {
                const top = policyMoves[0]!;
                return {
                  x: top.x,
                  y: top.y,
                  thoughts: `Rank: pass prob ${(passProb * 100).toFixed(1)}% > picked ${(picked.prob * 100).toFixed(1)}%; playing top policy move.`,
                };
              }

              return {
                x: picked.x,
                y: picked.y,
                thoughts: `Rank picked from ${Math.min(nMoves, legalPolicyMoves.length)} sampled moves (kyu ${kyuRank}).`,
              };
            }

            if (strategy === 'policy') {
              const openingMoves = Math.max(0, settings.aiPolicyOpeningMoves);
              const depth = latest.moveHistory.length;
              if (depth <= openingMoves) {
                const weakenFac = 1.0;
                const lowerBound = 0.02;
                const override = 0.9;
                const forced = shouldPlayTopMove(override);
                if (forced) {
                  return { x: forced.move.x, y: forced.move.y, thoughts: forced.thoughts };
                }
                const weighted = policyMoves
                  .filter((m) => !m.isPass && m.prob > lowerBound)
                  .map((m) => ({ weight: Math.pow(m.prob, 1 / weakenFac), value: m }));
                const picked = pickOneWeighted(weighted) ?? policyMoves[0]!;
                return {
                  x: picked.x,
                  y: picked.y,
                  thoughts: `Policy opening: picked weighted policy move (depth ${depth} ≤ ${openingMoves}).`,
                };
              }
              const top = policyMoves[0]!;
              return {
                x: top.x,
                y: top.y,
                thoughts: top5Pass ? 'Playing top policy move because pass is in top 5.' : 'Playing top policy move.',
              };
            }

            if (strategy === 'weighted') {
              const weakenFac = Math.max(0.01, settings.aiWeightedWeakenFac);
              const lowerBound = Math.max(0, settings.aiWeightedLowerBound);
              const override = Math.max(0, settings.aiWeightedPickOverride);

              const forced = shouldPlayTopMove(override);
              if (forced) return { x: forced.move.x, y: forced.move.y, thoughts: forced.thoughts };

              const weighted = policyMoves
                .filter((m) => !m.isPass && m.prob > lowerBound)
                .map((m) => ({ weight: Math.pow(m.prob, 1 / weakenFac), value: m }));
              const picked = pickOneWeighted(weighted);
              const move = picked ?? policyMoves[0]!;
              return {
                x: move.x,
                y: move.y,
                thoughts:
                  picked
                    ? `Weighted picked random policy move (lower_bound ${lowerBound}, weaken_fac ${weakenFac}).`
                    : 'Weighted fallback to top policy move.',
              };
            }

            if (!best) return null;
            return { x: best.x, y: best.y, thoughts: `Fallback to top move ${bestLabel}.` };
          };

          const chosen = chooseByStrategy();
          if (!chosen) {
            makeHeuristicMove(get());
            return;
          }
          asEngineMove(() => {
            if (chosen.x === -1 || chosen.y === -1) get().passTurn();
            else get().playMove(chosen.x, chosen.y);
          });

          const after = get();
          after.currentNode.aiThoughts = chosen.thoughts;
          set((s) => ({ treeVersion: s.treeVersion + 1 }));
        })
        .catch((err) => {
          if (!ownsPosition()) return;
          if (isAnalysisCanceled(err)) {
            // Preemption and model changes may need a fresh search, but only
            // while this caller still owns this position. Stop and replacement
            // requests invalidate ownership before the rejection arrives.
            retryScheduled = true;
            scheduleAiMoveTask(() => {
              if (ownsPosition()) get().makeAiMove(force ? { force: true } : undefined);
              else set({ isAiThinking: false });
            }, 100, () => set({ isAiThinking: false }));
            return;
          }
          if (revision === analysisRevision) makeHeuristicMove(get());
          else {
            retryScheduled = true;
            scheduleAiMoveTask(() => {
              if (ownsPosition()) get().makeAiMove(force ? { force: true } : undefined);
              else set({ isAiThinking: false });
            }, 100, () => set({ isAiThinking: false }));
          }
        })
        .finally(() => {
          if (generation === aiMoveGeneration && !retryScheduled) set({ isAiThinking: false });
        });
  },

  undoMove: () => get().navigateBack(),

  navigateBack: () => set((state) => {
    stopNavigationSounds();
    if (state.isInsertMode && state.currentNode.parent && state.insertAfterNodeId) {
      const insertAfter = findNodeById(state.rootNode, state.insertAfterNodeId);
      if (insertAfter) {
        const above = new Set<string>();
        let n: GameNode | null = insertAfter;
        while (n) {
          above.add(n.id);
          n = n.parent;
        }
	        if (!above.has(state.currentNode.id)) {
	          const node = state.currentNode;
	          const parent = node.parent!;
	          const idx = parent.children.findIndex((c) => c.id === node.id);
	          if (idx >= 0) parent.children.splice(idx, 1);
	          return {
	            currentNode: parent,
            board: parent.gameState.board,
            currentPlayer: parent.gameState.currentPlayer,
            moveHistory: parent.gameState.moveHistory,
            capturedBlack: parent.gameState.capturedBlack,
            capturedWhite: parent.gameState.capturedWhite,
            analysisData: parent.analysis || null,
            treeVersion: state.treeVersion + 1,
          };
        }
      }
    }
    if (!state.currentNode.parent) return {};
    const prevNode = state.currentNode.parent;
    return {
        currentNode: prevNode,
        board: prevNode.gameState.board,
        currentPlayer: prevNode.gameState.currentPlayer,
        moveHistory: prevNode.gameState.moveHistory,
        capturedBlack: prevNode.gameState.capturedBlack,
        capturedWhite: prevNode.gameState.capturedWhite,
        analysisData: prevNode.analysis || null,
        // Preserve settings
        isAiPlaying: state.isAiPlaying,
        aiColor: state.aiColor
    };
  }),

  navigateForward: () => set((state) => {
      const nextNode = getActiveChild(state.currentNode, state.activeBranchChildIds);
      if (!nextNode) { stopNavigationSounds(); return {}; }
      return {
          currentNode: nextNode,
          board: nextNode.gameState.board,
          currentPlayer: nextNode.gameState.currentPlayer,
          moveHistory: nextNode.gameState.moveHistory,
          capturedBlack: nextNode.gameState.capturedBlack,
          capturedWhite: nextNode.gameState.capturedWhite,
          analysisData: nextNode.analysis || null,
          activeBranchChildIds: rememberActiveBranchPath(state.activeBranchChildIds, nextNode),
      };
  }),

  navigateStart: () => set((state) => {
      let node = state.currentNode;
      while (node.parent) {
          node = node.parent;
      }
      return {
          currentNode: node,
          board: node.gameState.board,
          currentPlayer: node.gameState.currentPlayer,
          moveHistory: node.gameState.moveHistory,
          capturedBlack: node.gameState.capturedBlack,
          capturedWhite: node.gameState.capturedWhite,
          analysisData: node.analysis || null,
      };
  }),

  navigateEnd: () => set((state) => {
      let node = state.currentNode;
      let activeBranchChildIds = state.activeBranchChildIds;
      while (node.children.length > 0) {
          const child = getActiveChild(node, activeBranchChildIds);
          if (!child) break;
          activeBranchChildIds = rememberActiveBranchPath(activeBranchChildIds, child);
          node = child;
      }
      return {
          currentNode: node,
          board: node.gameState.board,
          currentPlayer: node.gameState.currentPlayer,
          moveHistory: node.gameState.moveHistory,
          capturedBlack: node.gameState.capturedBlack,
          capturedWhite: node.gameState.capturedWhite,
          analysisData: node.analysis || null,
          activeBranchChildIds,
      };
  }),

  switchBranch: (direction) => set((state) => {
      const next = findSiblingBranchTarget(state.currentNode, direction);
      if (!next) return {};

      return {
          currentNode: next,
          board: next.gameState.board,
          currentPlayer: next.gameState.currentPlayer,
          moveHistory: next.gameState.moveHistory,
          capturedBlack: next.gameState.capturedBlack,
          capturedWhite: next.gameState.capturedWhite,
          analysisData: next.analysis || null,
          activeBranchChildIds: rememberActiveBranchPath(state.activeBranchChildIds, next),
      };
  }),

  switchToBranchIndex: (index) => set((state) => {
      const next = findBranchTargetByIndex(state.currentNode, index);
      if (!next) return { notification: { message: 'Branch number unavailable.', type: 'info' } };

      return {
          currentNode: next,
          board: next.gameState.board,
          currentPlayer: next.gameState.currentPlayer,
          moveHistory: next.gameState.moveHistory,
          capturedBlack: next.gameState.capturedBlack,
          capturedWhite: next.gameState.capturedWhite,
          analysisData: next.analysis || null,
          activeBranchChildIds: rememberActiveBranchPath(state.activeBranchChildIds, next),
      };
  }),

  navigateToMove: (moveNumber) => set((state) => {
      const target = findCurrentLineMoveTarget(state.currentNode, moveNumber, state.activeBranchChildIds);
      if (!target || target.id === state.currentNode.id) return {};

      return {
          currentNode: target,
          board: target.gameState.board,
          currentPlayer: target.gameState.currentPlayer,
          moveHistory: target.gameState.moveHistory,
          capturedBlack: target.gameState.capturedBlack,
          capturedWhite: target.gameState.capturedWhite,
          analysisData: target.analysis || null,
          activeBranchChildIds: rememberActiveBranchPath(state.activeBranchChildIds, target),
      };
  }),

  undoToBranchPoint: () => set((state) => {
      let node = state.currentNode;
      while (node.parent) {
          node = node.parent;
          if (node.children.length > 1) break;
      }
      if (node.id === state.currentNode.id) return {};
      return {
          currentNode: node,
          board: node.gameState.board,
          currentPlayer: node.gameState.currentPlayer,
          moveHistory: node.gameState.moveHistory,
          capturedBlack: node.gameState.capturedBlack,
          capturedWhite: node.gameState.capturedWhite,
          analysisData: node.analysis || null,
      };
  }),

  undoToMainBranch: () => set((state) => {
      let node = state.currentNode;
      let lastBranchingNode = node;
      while (node.parent) {
          const prev = node;
          node = node.parent;
          if (node.children.length > 1 && node.children[0] !== prev) {
              lastBranchingNode = node;
          }
      }
      if (lastBranchingNode.id === state.currentNode.id) return {};
      return {
          currentNode: lastBranchingNode,
          board: lastBranchingNode.gameState.board,
          currentPlayer: lastBranchingNode.gameState.currentPlayer,
          moveHistory: lastBranchingNode.gameState.moveHistory,
          capturedBlack: lastBranchingNode.gameState.capturedBlack,
          capturedWhite: lastBranchingNode.gameState.capturedWhite,
          analysisData: lastBranchingNode.analysis || null,
      };
  }),

  makeCurrentNodeMainBranch: () => set((state) => {
      const selected = state.currentNode;
      let hasChange = false;
      let cursor: GameNode | null = selected;
      while (cursor && cursor.parent) {
          const parent: GameNode = cursor.parent;
          const cursorId = cursor.id;
          const idx = parent.children.findIndex((c: GameNode) => c.id === cursorId);
          if (idx > 0) {
              hasChange = true;
              break;
          }
          cursor = parent;
      }
      if (!hasChange) return { notification: { message: 'Current line is already the main branch.', type: 'info' } };
      const history = pushEditHistory(state);
      let node: GameNode | null = selected;
      while (node && node.parent) {
          const parent: GameNode = node.parent;
          const nodeId = node.id;
          const idx = parent.children.findIndex((c: GameNode) => c.id === nodeId);
          if (idx > 0) {
              parent.children.splice(idx, 1);
              parent.children.unshift(node);
          }
          node = parent;
      }
      return { ...history, ...repathPins(state.rootNode, state.pinnedVariations), treeVersion: state.treeVersion + 1 };
  }),

  // KaTrain's 'c': fold the run of moves back to the previous branch point away,
  // leaving its head as the handle. View-only, so no edit-history entry.
  toggleBranchCollapse: (nodeId?: string) => set((state) => {
    const from = nodeId ? findNodeById(state.rootNode, nodeId) : state.currentNode;
    if (!from) return {};
    const target = getMoveTreeCollapseTarget(from);
    if (!target) {
      return { notification: { message: 'No branch to collapse here.', type: 'info' as const } };
    }
    const collapsing = target.collapsed !== true;
    target.collapsed = collapsing;
    const hidden = countMoveTreeDescendants(target);
    const patch: Partial<GameStore> = {
      treeVersion: state.treeVersion + 1,
      notification: {
        message: collapsing
          ? `Collapsed ${hidden} move${hidden === 1 ? '' : 's'} into one branch.`
          : `Expanded ${hidden} move${hidden === 1 ? '' : 's'}.`,
        type: 'info' as const,
      },
    };
    // Standing inside the run we just folded away: step out to its head so the
    // tree and the board agree about where we are.
    if (collapsing && isNodeDescendantOf(state.currentNode, target)) {
      return {
        ...patch,
        currentNode: target,
        board: target.gameState.board,
        currentPlayer: target.gameState.currentPlayer,
        moveHistory: target.gameState.moveHistory,
        capturedBlack: target.gameState.capturedBlack,
        capturedWhite: target.gameState.capturedWhite,
        analysisData: target.analysis || null,
        activeBranchChildIds: rememberActiveBranchPath(state.activeBranchChildIds, target),
      };
    }
    return patch;
  }),

  // KaTrain's middle-click on a candidate: drop the variation you are previewing
  // into the tree, only as far as you have scrolled through it.
  addPvVariation: (pv: string[], upToMove?: number) => set((state) => {
    const limit = typeof upToMove === 'number' ? Math.floor(upToMove) : pv.length;
    const moves = pv.slice(0, Math.max(0, Math.min(pv.length, limit)));
    if (moves.length === 0) {
      return { notification: { message: 'Nothing to add from this variation.', type: 'info' as const } };
    }
    const boardSize = normalizeBoardSize(state.board.length, DEFAULT_BOARD_SIZE);
    // Snapshot now, record only if a node is added: recording up front wiped
    // redo for a line that was unplayable or already in the tree.
    const snapshot = captureEditHistory(state);

    let parent = state.currentNode;
    let created = 0;
    let reused = 0;
    let activeBranchChildIds = state.activeBranchChildIds;

    for (const gtp of moves) {
      const parsed = parseGtpMove(gtp, boardSize);
      if (!parsed) break;
      const player = parent.gameState.currentPlayer;
      const move: Move = parsed.kind === 'pass'
        ? { x: -1, y: -1, player }
        : { x: parsed.x, y: parsed.y, player };
      // Re-adding a variation should extend the existing line, not fork a twin.
      const existing = parent.children.find(
        (child) => child.move && child.move.x === move.x && child.move.y === move.y && child.move.player === move.player
      );
      const next = existing ?? createChildForMove(parent, move, isSuicideLegal(state.settings.gameRules), rulesOf(state.settings.gameRules).ko);
      if (!next) break;
      if (existing) reused += 1;
      else created += 1;
      activeBranchChildIds = { ...activeBranchChildIds, [parent.id]: next.id };
      parent = next;
    }

    if (created === 0 && reused === 0) {
      return { notification: { message: 'That variation is not playable from here.', type: 'error' as const } };
    }
    const total = created + reused;
    return {
      ...(created > 0 ? commitEditHistory(snapshot) : {}),
      activeBranchChildIds,
      treeVersion: state.treeVersion + 1,
      notification: {
        message: created === 0
          ? `That variation is already in the tree (${total} move${total === 1 ? '' : 's'}).`
          : `Added ${created} move${created === 1 ? '' : 's'} from this variation to the tree.`,
        type: 'info' as const,
      },
    };
  }),

  expandAllBranches: () => set((state) => {
    if (!expandAllMoveTreeBranches(state.rootNode)) {
      return { notification: { message: 'No collapsed branches.', type: 'info' as const } };
    }
    return {
      treeVersion: state.treeVersion + 1,
      notification: { message: 'Expanded all branches.', type: 'info' as const },
    };
  }),

  shiftCurrentVariation: (direction) => set((state) => {
      const node = state.currentNode;
      const parent = node.parent;
      if (!parent) return { notification: { message: 'Select a variation to reorder.', type: 'info' } };

      const idx = parent.children.findIndex((child) => child.id === node.id);
      const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
      if (idx < 0 || targetIdx < 0 || targetIdx >= parent.children.length) {
          return { notification: { message: 'Variation is already at that edge.', type: 'info' } };
      }

      const history = pushEditHistory(state);
      const swap = parent.children[targetIdx]!;
      parent.children[targetIdx] = node;
      parent.children[idx] = swap;

      return {
          ...history,
          ...repathPins(state.rootNode, state.pinnedVariations),
          treeVersion: state.treeVersion + 1,
          notification: {
              message: direction === 'left' ? 'Moved variation earlier.' : 'Moved variation later.',
              type: 'success',
          },
      };
  }),

  findMistake: (direction) => set((state) => {
      const node = findMistakeNavigationTarget({
          currentNode: state.currentNode,
          direction,
          activeBranchChildIds: state.activeBranchChildIds,
          threshold: state.settings.mistakeThreshold,
      });
      if (!node) return {};
      return {
          currentNode: node,
          board: node.gameState.board,
          currentPlayer: node.gameState.currentPlayer,
          moveHistory: node.gameState.moveHistory,
          capturedBlack: node.gameState.capturedBlack,
          capturedWhite: node.gameState.capturedWhite,
          analysisData: node.analysis || null,
          activeBranchChildIds: rememberActiveBranchPath(state.activeBranchChildIds, node),
      };
  }),

  deleteCurrentNode: () => set((state) => {
      const node = state.currentNode;
      if (!node.parent) return {};

      const history = pushEditHistory(state);
      const parent = node.parent;
      const idx = parent.children.findIndex((c) => c.id === node.id);
      if (idx >= 0) parent.children.splice(idx, 1);

      return {
          ...history,
          ...repathPins(state.rootNode, state.pinnedVariations),
          currentNode: parent,
          board: parent.gameState.board,
          currentPlayer: parent.gameState.currentPlayer,
          moveHistory: parent.gameState.moveHistory,
          capturedBlack: parent.gameState.capturedBlack,
          capturedWhite: parent.gameState.capturedWhite,
          analysisData: parent.analysis || null,
          treeVersion: state.treeVersion + 1,
      };
  }),

  pruneCurrentBranch: () => set((state) => {
      let removedNodes = 0;
      let node: GameNode | null = state.currentNode;
      while (node && node.parent) {
          const parent: GameNode = node.parent;
          const keptNode = node;
          const siblings = parent.children.filter((child) => child.id !== keptNode.id);
          removedNodes += siblings.reduce((total, child) => total + countNodes(child), 0);
          node = parent;
      }

      if (removedNodes === 0) {
          return { notification: { message: 'No other branches on the current line.', type: 'info' } };
      }

      const history = pushEditHistory(state);
      node = state.currentNode;
      while (node && node.parent) {
          const parent: GameNode = node.parent;
          const keptNode = node;
          if (parent.children.length > 1) parent.children = [keptNode];
          node = parent;
      }

      return {
          ...history,
          ...repathPins(state.rootNode, state.pinnedVariations),
          activeBranchChildIds: rememberActiveBranchPath(state.activeBranchChildIds, state.currentNode),
          notification: {
              message: `Kept current line and deleted ${removedNodes} other branch node${removedNodes === 1 ? '' : 's'}.`,
              type: 'success',
          },
          treeVersion: state.treeVersion + 1,
      };
  }),

  undoEdit: () => {
      if (editUndoStack.length === 0) {
          set({ notification: { message: 'No edit to undo.', type: 'info' } });
          return;
      }
      // The tree about to be restored is a clone with the same node ids, so
      // a running review would keep writing into the discarded one; stop it.
      continuousToken++;
      selfplayToken++;
      gameAnalysisToken++;
      analysisQueue.cancelWhere(() => true, 'Undo edit');
      set((state) => {
          const current = captureEditHistory(state);
          const previous = editUndoStack.pop();
          if (!previous) return editHistoryCounts();
          editRedoStack.push(current);
          if (editRedoStack.length > EDIT_HISTORY_LIMIT) editRedoStack.shift();
          const restored = restoreEditHistory(previous, state);
          return {
              ...restored,
              ...repathPins(restored.rootNode, state.pinnedVariations),
              ...editHistoryCounts(),
              notification: { message: 'Undid edit.', type: 'success' },
          };
      });
  },

  redoEdit: () => {
      if (editRedoStack.length === 0) {
          set({ notification: { message: 'No edit to redo.', type: 'info' } });
          return;
      }
      // The tree about to be restored is a clone with the same node ids, so
      // a running review would keep writing into the discarded one; stop it.
      continuousToken++;
      selfplayToken++;
      gameAnalysisToken++;
      analysisQueue.cancelWhere(() => true, 'Redo edit');
      set((state) => {
          const current = captureEditHistory(state);
          const next = editRedoStack.pop();
          if (!next) return editHistoryCounts();
          editUndoStack.push(current);
          if (editUndoStack.length > EDIT_HISTORY_LIMIT) editUndoStack.shift();
          const restored = restoreEditHistory(next, state);
          return {
              ...restored,
              ...repathPins(restored.rootNode, state.pinnedVariations),
              ...editHistoryCounts(),
              notification: { message: 'Redid edit.', type: 'success' },
          };
      });
  },

  copyCurrentBranch: () => set((state) => {
      if (!state.currentNode.parent || !state.currentNode.move) {
          return { notification: { message: 'Select a move branch to copy.', type: 'info' } };
      }
      const copiedBranch = copyBranchSnapshot(state.currentNode);
      const nodes = countClipboardNodes(copiedBranch);
      return {
          copiedBranch,
          notification: {
              message: `Copied branch (${nodes} node${nodes === 1 ? '' : 's'}).`,
              type: 'success',
          },
      };
  }),

  pasteCopiedBranch: () => set((state) => {
      const source = state.copiedBranch;
      if (!source) {
          return { notification: { message: 'No copied branch to paste.', type: 'info' } };
      }
      const pasted = pasteBranchSnapshot(state.currentNode, source, isSuicideLegal(state.settings.gameRules));
      if (!pasted) {
          return { notification: { message: 'Cannot paste branch at this position.', type: 'error' } };
      }
      const history = pushEditHistory(state);
      state.currentNode.children.push(pasted);
      // A branch replayed somewhere else can run into stones that were not
      // there when it was copied, and pasteBranchSnapshot drops those moves
      // along with everything under them. Count what actually landed, and say
      // so when part of the branch did not survive the move.
      const nodes = countNodes(pasted);
      const copied = countClipboardNodes(source);
      const dropped = copied - nodes;
      return {
          ...history,
          currentNode: pasted,
          board: pasted.gameState.board,
          currentPlayer: pasted.gameState.currentPlayer,
          moveHistory: pasted.gameState.moveHistory,
          capturedBlack: pasted.gameState.capturedBlack,
          capturedWhite: pasted.gameState.capturedWhite,
          analysisData: pasted.analysis || null,
          activeBranchChildIds: rememberActiveBranchPath(state.activeBranchChildIds, pasted),
          treeVersion: state.treeVersion + 1,
          notification: dropped > 0
              ? {
                  message: `Pasted ${nodes} of ${copied} nodes — ${dropped === 1 ? '1 move is' : `${dropped} moves are`} not legal here.`,
                  type: 'info' as const,
              }
              : {
                  message: `Pasted branch (${nodes} node${nodes === 1 ? '' : 's'}).`,
                  type: 'success' as const,
              },
      };
  }),

  jumpToNode: (node: GameNode) => set((state) => {
      if (node.id === state.currentNode.id) { stopNavigationSounds(); return {}; }
      // Just set current node and sync state
      return {
          currentNode: node,
          board: node.gameState.board,
          currentPlayer: node.gameState.currentPlayer,
          moveHistory: node.gameState.moveHistory,
          capturedBlack: node.gameState.capturedBlack,
          capturedWhite: node.gameState.capturedWhite,
          analysisData: node.analysis || null,
          activeBranchChildIds: rememberActiveBranchPath(state.activeBranchChildIds, node),
      };
  }),

  pinCurrentVariation: () => set((state) => {
    const node = state.currentNode;
    if (!node.parent) {
      return { notification: { message: 'Play or navigate to a move before pinning a line.', type: 'info' } };
    }
    const path = getNodePath(node);
    const moveNumber = getCurrentLineMoveNumber(node);
    const coord = node.move
      ? formatGtpMove(node.move.x, node.move.y, node.gameState.board.length)
      : 'setup';
    const side = node.move ? (node.move.player === 'black' ? 'B' : 'W') : '';
    const label = `Move ${moveNumber}${side ? ` ${side} ${coord}` : ''}`;
    const pin: PinnedVariation = {
      // The path alone is not an identity: reordering variations moves
      // another line onto a pinned one's old path, and pinning it then read
      // "already pinned".
      id: `pin_${moveNumber}_${path.join('-')}_${node.id}`,
      label,
      path,
      moveNumber,
      createdAt: state.treeVersion,
      nodeId: node.id,
    };
    const pathKey = path.join('-');
    if (state.pinnedVariations.some((p) => (p.nodeId ? p.nodeId === node.id : p.path.join('-') === pathKey))) {
      return { notification: { message: 'This line is already pinned.', type: 'info' } };
    }
    // Assigning the WKID root property makes pins recoverable after reloads;
    // bump treeVersion so auto-save picks up the new property.
    const gameId = ensurePinGameId(state.rootNode);
    const pins = [...state.pinnedVariations, pin];
    writeStoredPinnedVariations(gameId, pins);
    return {
      pinnedVariations: pins,
      treeVersion: state.treeVersion + 1,
      notification: { message: `Pinned ${label}.`, type: 'success' },
    };
  }),

  recallVariation: (id: string) => {
    const state = get();
    const pin = state.pinnedVariations.find((p) => p.id === id);
    if (!pin) return;
    const node = resolvePinnedVariation(state.rootNode, pin);
    if (!node) {
      set({ notification: { message: 'That pinned line no longer exists in this game.', type: 'error' } });
      return;
    }
    get().jumpToNode(node);
  },

  unpinVariation: (id: string) => set((state) => {
    const pins = state.pinnedVariations.filter((p) => p.id !== id);
    writeStoredPinnedVariations(getPinGameId(state.rootNode), pins);
    return { pinnedVariations: pins };
  }),

  clearPinnedVariations: () => set((state) => {
    writeStoredPinnedVariations(getPinGameId(state.rootNode), []);
    return { pinnedVariations: [] };
  }),


  startMistakeDrill: (side: DrillSide = 'both') => {
    const state = get();
    const mistakes = collectDrillMistakes({
      rootNode: state.rootNode,
      activeBranchChildIds: state.activeBranchChildIds,
      threshold: state.settings.mistakeThreshold,
      side,
    });
    if (mistakes.length === 0) {
      // Two different nothings, and the difference is the whole of what to do
      // next: review the game, or pick a game with mistakes in it.
      const analysed = collectDrillMistakes({
        rootNode: state.rootNode,
        activeBranchChildIds: state.activeBranchChildIds,
        threshold: 0,
        side,
      }).length;
      set({
        notification: {
          message: analysed === 0
            ? 'Run a fast or full review first — a drill grades answers against the engine\u2019s candidate moves, which the quick pass does not compute.'
            : `No move on this line gave up ${state.settings.mistakeThreshold} points or more.`,
          type: 'info',
        },
      });
      return;
    }
    const first = mistakes[0]!;
    set({
      mistakeDrill: {
        mistakes,
        index: 0,
        phase: 'asking',
        verdict: null,
        revealed: false,
        solvedIds: [],
        side,
      },
    });
    const target = findNodeOnLine(state.rootNode, state.activeBranchChildIds, first.parentNodeId);
    if (target) get().jumpToNode(target);
  },

  answerMistakeDrill: (x: number, y: number) => {
    const state = get();
    const drill = state.mistakeDrill;
    if (!drill || drill.phase !== 'asking') return;
    const mistake = drill.mistakes[drill.index];
    if (!mistake) return;
    const parent = findNodeOnLine(state.rootNode, state.activeBranchChildIds, mistake.parentNodeId);
    if (!parent) {
      set({ mistakeDrill: null });
      return;
    }
    const verdict = gradeDrillGuess(parent, { x, y }, mistake.pointsLost, mistake.played);
    if (!verdict) return;
    const solvedIds = isDrillSolved(verdict.kind) && !drill.solvedIds.includes(mistake.nodeId)
      ? [...drill.solvedIds, mistake.nodeId]
      : drill.solvedIds;
    set({ mistakeDrill: { ...drill, phase: 'answered', verdict, revealed: false, solvedIds } });
  },

  revealMistakeDrill: () => set((state) => {
    const drill = state.mistakeDrill;
    if (!drill || drill.phase !== 'asking') return {};
    return { mistakeDrill: { ...drill, phase: 'answered', verdict: null, revealed: true } };
  }),

  advanceMistakeDrill: () => {
    const state = get();
    const drill = state.mistakeDrill;
    if (!drill || drill.phase === 'done') return;
    const nextIndex = drill.index + 1;
    if (nextIndex >= drill.mistakes.length) {
      set({ mistakeDrill: { ...drill, phase: 'done', verdict: null, revealed: false } });
      return;
    }
    const next = drill.mistakes[nextIndex]!;
    set({ mistakeDrill: { ...drill, index: nextIndex, phase: 'asking', verdict: null, revealed: false } });
    const target = findNodeOnLine(state.rootNode, state.activeBranchChildIds, next.parentNodeId);
    if (target) get().jumpToNode(target);
  },

  resumeMistakeDrill: () => {
    const state = get();
    const drill = state.mistakeDrill;
    const mistake = drill && drill.phase !== 'done' ? drill.mistakes[drill.index] : null;
    if (!mistake) return;
    const target = findNodeOnLine(state.rootNode, state.activeBranchChildIds, mistake.parentNodeId);
    if (!target) {
      // The drilled line is not the line the reviewer is on any more, which is
      // a thing they did on purpose; say so rather than jumping them somewhere.
      set({
        notification: {
          message: 'That position is on a different branch. Switch back to the reviewed line to continue the drill.',
          type: 'info',
        },
      });
      return;
    }
    get().jumpToNode(target);
  },

  stopMistakeDrill: () => set((state) => {
    const drill = state.mistakeDrill;
    if (!drill) return {};
    // Say how it went on the way out, so a drill abandoned halfway still leaves
    // the player with the one number they were working towards.
    const attempted = drill.phase === 'done' ? drill.mistakes.length : drill.index + (drill.phase === 'answered' ? 1 : 0);
    return {
      mistakeDrill: null,
      notification: attempted > 0
        ? { message: drillSummaryText(drill.solvedIds.length, attempted), type: 'info' as const }
        : state.notification,
    };
  }),

  navigateNextMistake: () => {
      get().findMistake('redo');
  },

  navigatePrevMistake: () => {
      get().findMistake('undo');
  },

  startBlindfold: ({ aiColor, announce }) => {
    const state = get();
    // The mode drives the AI: it plays `aiColor` while the player answers out
    // loud. Remember what the AI settings were so leaving puts them back.
    blindfoldRestoreAi = { isAiPlaying: state.isAiPlaying, aiColor: state.aiColor };
    const token = ++blindfoldToken;
    // Ask for the microphone while the click that opened the mode is still the
    // current task: that is where the browser's permission prompt belongs, not
    // in the middle of the first answer, and the answer tells the banner
    // whether the player may speak yet.
    const preflight = preflightMicrophone();
    set({
      blindfold: {
        aiColor,
        announce,
        phase: 'ai-thinking',
        transcript: null,
        lastPoint: null,
        mic: { status: 'checking', failure: null },
        message: BLINDFOLD_SPEECH.aiThinking,
        resumeToken: 0,
      },
      isAiPlaying: true,
      aiColor,
    });
    watchBlindfoldMic(get, token, preflight);
    if (get().currentPlayer === aiColor) setTimeout(() => get().makeAiMove(), 0);
    void runBlindfoldSession(get, token, preflight);
  },

  stopBlindfold: () => {
    // Bumping the token stops the loop at its next check, and the speech calls
    // have to be cancelled explicitly because they are awaited inside it.
    blindfoldToken++;
    cancelListening();
    cancelSpeech();
    set(blindfoldResetPatch());
  },

  updateBlindfold: (patch) => set((state) => {
    if (!state.blindfold) return {};
    const { mic, ...rest } = patch;
    // `mic` merges: the loop knows one field at a time, and the device name it
    // learned when the microphone opened has to survive the next turn.
    return {
      blindfold: {
        ...state.blindfold,
        ...rest,
        ...(mic ? { mic: { ...state.blindfold.mic, ...mic } } : {}),
      },
    };
  }),

  resumeBlindfold: () => set((state) => (
    state.blindfold
      ? {
          blindfold: {
            ...state.blindfold,
            phase: 'listening',
            transcript: null,
            message: null,
            resumeToken: state.blindfold.resumeToken + 1,
          },
        }
      : {}
  )),

  startNewGame: ({ komi, rules, boardSize, handicap }) => {
    cancelAiMoveWork();
    const state = get();
    // A blindfold session belongs to the game it was started in, and its loop
    // holds the microphone open until it is stopped.
    if (state.blindfold) get().stopBlindfold();
    get().stopSelfplayToEnd();
    get().stopGameAnalysis();
    analysisQueue.cancelWhere(() => true, 'Started new game');
    analysisQueue.clearCache();
    if (state.settings.soundEnabled) {
      playNewGameSound();
    }
    const normalizedBoardSize = normalizeBoardSize(boardSize, state.settings.defaultBoardSize ?? DEFAULT_BOARD_SIZE);
    const maxHandicap = getMaxHandicap(normalizedBoardSize);
    const safeHandicap = Math.max(0, Math.min(Math.floor(handicap), maxHandicap));
    const nextSettings: GameSettings = {
      ...state.settings,
      gameRules: rules,
      defaultBoardSize: normalizedBoardSize,
      defaultHandicap: safeHandicap,
    };
    saveStoredSettings(nextSettings);

    const board = createEmptyBoard(normalizedBoardSize);
    if (safeHandicap > 0) {
      applyHandicapStones(board, normalizedBoardSize, safeHandicap);
    }

    const rootState: GameState = {
      board,
      currentPlayer: safeHandicap > 0 ? 'white' : 'black',
      moveHistory: [],
      capturedBlack: 0,
      capturedWhite: 0,
      komi,
    };
    const newRoot = createNode(null, null, rootState, createRootNodeId());
    newRoot.properties = { RU: [rulesToSgfRu(rules)], SZ: [String(normalizedBoardSize)], DT: [formatSgfDate()] };
    if (safeHandicap > 0) {
      newRoot.properties.HA = [String(safeHandicap)];
      newRoot.properties.PL = ['W'];
    }
    syncRootSetupPropertiesFromBoard(newRoot.properties, board, normalizedBoardSize, safeHandicap);

    set({
      settings: nextSettings,
      board: rootState.board,
      currentPlayer: rootState.currentPlayer,
      moveHistory: rootState.moveHistory,
      capturedBlack: rootState.capturedBlack,
      capturedWhite: rootState.capturedWhite,
      komi: rootState.komi,
      boardRotation: 0,
      regionOfInterest: null,
      isSelectingRegionOfInterest: false,
      isInsertMode: false,
      insertAfterNodeId: null,
      insertAnchorNodeId: null,
      isEditMode: false,
      editTool: 'setup-black',
      isSelfplayToEnd: false,
      setupPositionProgress: null,
      isAiPlaying: false,
      isAiThinking: false,
      aiColor: null,
      analysisData: null,
      analysisCacheSize: 0,
      timerPaused: true,
      timerMainTimeUsedSeconds: 0,
      timerPeriodsUsed: { black: 0, white: 0 },
      ...clearEditHistory(),

      // A drill describes positions in the tree being replaced, so it cannot
      // survive the replacement.
      mistakeDrill: null,
      rootNode: newRoot,
      currentNode: newRoot,
      activeBranchChildIds: {},
      pinnedVariations: [],
      treeVersion: state.treeVersion + 1,
    });
  },

  resetGame: () => {
    cancelAiMoveWork();
    const state = get();
    // A blindfold session belongs to the game it was started in, and its loop
    // holds the microphone open until it is stopped.
    if (state.blindfold) get().stopBlindfold();
    get().stopSelfplayToEnd();
    get().stopGameAnalysis();
    analysisQueue.cancelWhere(() => true, 'Reset game');
    analysisQueue.clearCache();
    if (state.settings.soundEnabled) {
        playNewGameSound();
    }
    const boardSize = getBoardSizeFromBoard(state.board);
    const rootState: GameState = {
      board: createEmptyBoard(boardSize),
      currentPlayer: 'black',
      moveHistory: [],
      capturedBlack: 0,
      capturedWhite: 0,
      komi: KOMI,
    };
    const newRoot = createNode(null, null, rootState, createRootNodeId());
    newRoot.properties = { RU: [rulesToSgfRu(state.settings.gameRules)], SZ: [String(boardSize)] };
    set({
      board: rootState.board,
      currentPlayer: rootState.currentPlayer,
      moveHistory: rootState.moveHistory,
      capturedBlack: rootState.capturedBlack,
      capturedWhite: rootState.capturedWhite,
      komi: rootState.komi,
      boardRotation: 0,
      regionOfInterest: null,
      isSelectingRegionOfInterest: false,
      isInsertMode: false,
      insertAfterNodeId: null,
      insertAnchorNodeId: null,
      isEditMode: false,
      editTool: 'setup-black',
      isSelfplayToEnd: false,
      setupPositionProgress: null,
      isAiPlaying: false,
      isAiThinking: false,
      aiColor: null,
      analysisData: null,
      analysisCacheSize: 0,
      timerPaused: true,
      timerMainTimeUsedSeconds: 0,
      timerPeriodsUsed: { black: 0, white: 0 },
      ...clearEditHistory(),

      // A drill describes positions in the tree being replaced, so it cannot
      // survive the replacement.
      mistakeDrill: null,

      // Reset Tree
      rootNode: newRoot,
      currentNode: newRoot,
      activeBranchChildIds: {},
      pinnedVariations: [],
      treeVersion: state.treeVersion + 1,
    });
  },

  loadGame: (sgf: ParsedSgf) => {
    // Reset first
    get().resetGame();

    const state = get();
    let currentBoard = sgf.initialBoard
      ? sgf.initialBoard
      : createEmptyBoard(state.settings.defaultBoardSize ?? DEFAULT_BOARD_SIZE);
    const boardSize = getBoardSizeFromBoard(currentBoard);

    const sgfProps = sgf.tree?.props;
    const hasExplicitRootSetup = !!(sgfProps?.['AB']?.length || sgfProps?.['AW']?.length || sgfProps?.['AE']?.length);
    const plRaw = sgfProps?.['PL']?.[0]?.toUpperCase();
    const pl: Player | null = plRaw === 'B' ? 'black' : plRaw === 'W' ? 'white' : null;
    const firstMovePlayer = sgf.moves[0]?.player;
    const ha = parseInt(sgfProps?.['HA']?.[0] ?? '0', 10);
    const safeHandicap = Number.isFinite(ha) ? Math.max(0, Math.min(ha, getMaxHandicap(boardSize))) : 0;
    // Only a declared handicap of two or more places stones, and only when the
    // file does not place them itself -- in the root or, as Tygem and other
    // servers write it, in the first node after it. HA[1] put a stone on Q16,
    // the commonest first move, so B[pd] met an occupied point and the whole
    // game was dropped; stones in the first node were placed twice over, and
    // White's first move usually landed on one of them. KaTrain applies the
    // same two conditions.
    const firstChildProps = sgf.tree?.children?.[0]?.props;
    const firstChildPlacesStones = !!(firstChildProps?.['AB']?.length || firstChildProps?.['AW']?.length);
    const placesHandicapStones = safeHandicap >= 2 && !hasExplicitRootSetup && !firstChildPlacesStones;
    if (placesHandicapStones) {
      currentBoard = cloneBoard(currentBoard);
      applyHandicapStones(currentBoard, boardSize, safeHandicap);
    }
    const rootPlayer: Player = pl ?? firstMovePlayer ?? (safeHandicap > 0 ? 'white' : 'black');
    const rules = parseSgfRu(sgfProps?.['RU']?.[0]) ?? state.settings.gameRules;

    const rootState: GameState = {
      board: currentBoard,
      currentPlayer: rootPlayer,
      moveHistory: [],
      capturedBlack: 0,
      capturedWhite: 0,
      komi: sgf.komi ?? KOMI,
    };

    const newRoot = createNode(null, null, rootState, createRootNodeId());
    newRoot.properties = { RU: [rulesToSgfRu(rules)], SZ: [String(boardSize)] };
    if (safeHandicap > 0) {
      newRoot.properties.HA = [String(safeHandicap)];
      if (safeHandicap >= 2 && !firstChildPlacesStones) newRoot.properties.PL = ['W'];
      if (placesHandicapStones) syncRootSetupPropertiesFromBoard(newRoot.properties, rootState.board, boardSize, safeHandicap);
    }

    const applyKtAnalysis = (node: GameNode, kt: string[]) => {
      // The ownership and policy buffers are sized by the board: read as
      // 19x19, a 9x9 game's came back empty and the next save wrote zeros.
      const decoded = decodeKaTrainKt({ kt, boardSize });
      if (!decoded) return;
      const analysis = kaTrainAnalysisToAnalysisResult({
        analysis: decoded,
        currentPlayer: node.gameState.currentPlayer,
        boardSize,
      });
      if (!analysis) return;
      node.analysis = analysis;
      // The depth the file's review reached, so a live reader knows how far it
      // has to get before its own result is an improvement rather than a reset.
      const visits = typeof analysis.rootVisits === 'number' && Number.isFinite(analysis.rootVisits)
        ? Math.max(0, Math.floor(analysis.rootVisits))
        : 0;
      if (visits > 0) node.analysisVisitsRequested = Math.max(node.analysisVisitsRequested ?? 0, Math.min(visits, ENGINE_MAX_VISITS));
    };

    const applyKaAnalysis = (node: GameNode, ka: string[]) => {
      const analysis = decodeKayaKa({
        ka,
        currentPlayer: node.gameState.currentPlayer,
        boardSize,
      });
      if (!analysis) return;
      node.analysis = analysis;
      const visits = typeof analysis.rootVisits === 'number' && Number.isFinite(analysis.rootVisits)
        ? Math.max(0, Math.floor(analysis.rootVisits))
        : 0;
      if (visits > 0) node.analysisVisitsRequested = Math.max(node.analysisVisitsRequested ?? 0, Math.min(visits, ENGINE_MAX_VISITS));
    };

    const cloneProps = (props: Record<string, string[]> | undefined): Record<string, string[]> => {
      const out: Record<string, string[]> = {};
      if (!props) return out;
      for (const [k, v] of Object.entries(props)) out[k] = [...v];
      return out;
    };

    const sgfCoordToXy = (coord: string): { x: number; y: number } => {
      if (!coord || coord.length < 2) return { x: -1, y: -1 };
      if (coord === 'tt') return { x: -1, y: -1 };
      const aCode = 'a'.charCodeAt(0);
      const x = coord.charCodeAt(0) - aCode;
      const y = coord.charCodeAt(1) - aCode;
      if (x < 0 || y < 0 || x >= boardSize || y >= boardSize) return { x: -1, y: -1 };
      return { x, y };
    };

    const extractMove = (props: Record<string, string[]>): Move | null => {
      const b = props['B']?.[0];
      if (typeof b === 'string') {
        const { x, y } = sgfCoordToXy(b);
        return { x, y, player: 'black' };
      }
      const w = props['W']?.[0];
      if (typeof w === 'string') {
        const { x, y } = sgfCoordToXy(w);
        return { x, y, player: 'white' };
      }
      return null;
    };

    /**
     * `applyMoveToNode` returns null for a move this ruleset will not play --
     * an occupied point, a suicide, or a repeat of the grandparent position --
     * and the builder then skips that node *and everything under it*, because
     * there is no parent to hang the rest of the line on. A file whose eighth
     * move is illegal therefore loads as a seven-move game, which used to
     * happen in complete silence: no throw, no toast, just a short game. The
     * counts here are what turns that into a sentence.
     */
    /**
     * Why a move could not be replayed. Three of these four are illegal under
     * every ruleset this app offers; only `suicide-multi` depends on which one
     * is in force, and it is the only case where naming the ruleset tells the
     * reader something they can act on.
     */
    type RejectReason = 'occupied' | 'ko' | 'suicide-single' | 'suicide-multi';
    let lastRejectReason: RejectReason = 'occupied';
    const rejected = { moves: 0, lines: 0, firstLabel: '', firstReason: 'occupied' as RejectReason };
    const countMovesIn = (node: NonNullable<ParsedSgf['tree']>): number => {
      let total = 0;
      const stack = [node];
      while (stack.length > 0) {
        const next = stack.pop()!;
        if (extractMove(next.props)) total += 1;
        for (const child of next.children) stack.push(child);
      }
      return total;
    };
    const noteRejectedMove = (parent: GameNode, move: Move, movesLost: number) => {
      rejected.moves += Math.max(1, movesLost);
      rejected.lines += 1;
      if (rejected.firstLabel) return;
      // The parent chain includes the root, so its length is the move number
      // the rejected move would have had.
      let moveNumber = 0;
      for (let node: GameNode | null = parent; node; node = node.parent) moveNumber += 1;
      const player = move.player === 'black' ? 'Black' : 'White';
      rejected.firstLabel = `Move ${moveNumber} (${player} ${formatBoardMoveLabel(move, boardSize)})`;
      rejected.firstReason = lastRejectReason;
    };

    const applyMoveToNode = (parent: GameNode, move: Move): GameNode | null => {
      const parentState = parent.gameState;
      const nextPlayer: Player = move.player === 'black' ? 'white' : 'black';

      if (move.x < 0 || move.y < 0) {
        const passMove: Move = { x: -1, y: -1, player: move.player };
        const newGameState: GameState = {
          board: parentState.board,
          currentPlayer: nextPlayer,
          moveHistory: [...parentState.moveHistory, passMove],
          capturedBlack: parentState.capturedBlack,
          capturedWhite: parentState.capturedWhite,
          komi: parentState.komi,
        };
        return createNode(parent, passMove, newGameState);
      }

      if (parentState.board[move.y]?.[move.x] !== null) {
        lastRejectReason = 'occupied';
        return null;
      }

	      const tentativeBoard = parentState.board.map((row) => [...row]);
	      tentativeBoard[move.y]![move.x] = move.player;
	      const captured = applyCapturesInPlace(tentativeBoard, move.x, move.y, move.player);
	      const newBoard = tentativeBoard;

      let selfCaptured = 0;
      if (captured.length === 0) {
        const { liberties, group } = getLiberties(newBoard, move.x, move.y);
        if (liberties === 0) {
          if (!isSuicideLegal(rules) || group.length <= 1) {
            lastRejectReason = group.length <= 1 ? 'suicide-single' : 'suicide-multi';
            return null;
          }
          selfCaptured = applySelfCaptureInPlace(newBoard, move.x, move.y).length;
        }
      }

      const koBoard = koReferenceBoard(parent);
      if (koBoard && boardsEqual(newBoard, koBoard)) {
        lastRejectReason = 'ko';
        return null;
      }

      const newCapturedBlack =
        parentState.capturedBlack + (move.player === 'white' ? captured.length : 0) + (move.player === 'black' ? selfCaptured : 0);
      const newCapturedWhite =
        parentState.capturedWhite + (move.player === 'black' ? captured.length : 0) + (move.player === 'white' ? selfCaptured : 0);

      const newMove: Move = { x: move.x, y: move.y, player: move.player };
      const newGameState: GameState = {
        board: newBoard,
        currentPlayer: nextPlayer,
        moveHistory: [...parentState.moveHistory, newMove],
        capturedBlack: newCapturedBlack,
        capturedWhite: newCapturedWhite,
        komi: parentState.komi,
      };
      return createNode(parent, newMove, newGameState);
    };

    if (sgf.tree) {
      const rootPropsCopy = cloneProps(sgf.tree.props);
      const rootMoveProps: Record<string, string[]> = {};
      if (extractMove(sgf.tree.props)) {
        for (const key of Object.keys(rootPropsCopy)) {
          if (!ROOT_MOVE_NODE_PROPERTIES.has(key)) continue;
          rootMoveProps[key] = rootPropsCopy[key]!;
          delete rootPropsCopy[key];
        }
      }
      delete rootPropsCopy.B;
      delete rootPropsCopy.W;
      const rootNote = extractKaTrainUserNoteFromSgfComment(rootPropsCopy['C']);
      if (rootNote) newRoot.note = rootNote;
      delete rootPropsCopy['C'];
      if (!rootPropsCopy['RU']?.length) rootPropsCopy['RU'] = [rulesToSgfRu(rules)];
      if (!rootPropsCopy['SZ']?.length) rootPropsCopy['SZ'] = [String(boardSize)];
      if (safeHandicap > 0) {
        rootPropsCopy['HA'] = [String(safeHandicap)];
        if (!rootPropsCopy['PL']?.length && safeHandicap >= 2 && !firstChildPlacesStones) rootPropsCopy['PL'] = ['W'];
        if (placesHandicapStones) syncRootSetupPropertiesFromBoard(rootPropsCopy, rootState.board, boardSize, safeHandicap);
      }
      newRoot.properties = rootPropsCopy;
      const rootMove = extractMove(sgf.tree.props);
      if (!rootMove && sgf.tree.props['KT'] && !newRoot.analysis) {
        applyKtAnalysis(newRoot, sgf.tree.props['KT']);
      }
      if (!rootMove && sgf.tree.props['KA'] && !newRoot.analysis) {
        applyKaAnalysis(newRoot, sgf.tree.props['KA']);
      }

      // Depth-first with an explicit stack. Recursing here spent one frame per
      // SGF node, and a game is a chain one node deep per move, so a long
      // record overflowed the stack during import — the same ceiling the SGF
      // parser's own walks had. Children are pushed in reverse so siblings are
      // still built left to right, which is the order variations are shown in.
      type SgfBuildTask = { parent: GameNode; node: NonNullable<ParsedSgf['tree']> };
      const pushChildren = (stack: SgfBuildTask[], parent: GameNode, node: NonNullable<ParsedSgf['tree']>) => {
        for (let i = node.children.length - 1; i >= 0; i--) {
          stack.push({ parent, node: node.children[i]! });
        }
      };

      const buildFromSgfNodes = (tasks: SgfBuildTask[]) => {
        const stack = [...tasks].reverse();
        while (stack.length > 0) {
          const { parent, node } = stack.pop()!;
          const move = extractMove(node.props);
          if (!move) {
            const note = extractKaTrainUserNoteFromSgfComment(node.props['C']);
            const propsNoComments = cloneProps(node.props);
            delete propsNoComments['C'];
            const hasAnalysis = !!(node.props['KT']?.length || node.props['KA']?.length);
            const hasContent = Object.keys(propsNoComments).length > 0 || !!note || hasAnalysis;
            if (!hasContent) {
              pushChildren(stack, parent, node);
              continue;
            }

            const childNode = createNode(parent, null, cloneGameState(parent.gameState));
            childNode.properties = propsNoComments;
            if (note) childNode.note = note;
            const rebuiltState = replayChildMove(parent, childNode, isSuicideLegal(rules));
            childNode.gameState = rebuiltState ?? childNode.gameState;
            if (node.props['KT'] && !childNode.analysis) {
              applyKtAnalysis(childNode, node.props['KT']);
            }
            if (node.props['KA'] && !childNode.analysis) {
              applyKaAnalysis(childNode, node.props['KA']);
            }
            parent.children.push(childNode);
            pushChildren(stack, childNode, node);
            continue;
          }

          const childNode = applyMoveToNode(parent, move);
          if (!childNode) {
            noteRejectedMove(parent, move, countMovesIn(node));
            continue;
          }
          childNode.properties = cloneProps(node.props);
          applySetupPropsToNode(childNode, childNode.properties, boardSize);
          applySgfPlayerToMoveToNode(childNode, childNode.properties);
          const nodeNote = extractKaTrainUserNoteFromSgfComment(childNode.properties['C']);
          if (nodeNote) childNode.note = nodeNote;
          delete childNode.properties['C'];
          if (node.props['KT'] && !childNode.analysis) {
            applyKtAnalysis(childNode, node.props['KT']);
          }
          if (node.props['KA'] && !childNode.analysis) {
            applyKaAnalysis(childNode, node.props['KA']);
          }
          parent.children.push(childNode);

          pushChildren(stack, childNode, node);
        }
      };

      if (rootMove) {
        const first = applyMoveToNode(newRoot, rootMove);
        if (!first) {
          noteRejectedMove(newRoot, rootMove, 1 + sgf.tree.children.reduce((n, child) => n + countMovesIn(child), 0));
        }
        if (first) {
          first.properties = rootMoveProps;
          if (sgf.tree.props['KT'] && !first.analysis) {
            applyKtAnalysis(first, sgf.tree.props['KT']);
          }
          if (sgf.tree.props['KA'] && !first.analysis) {
            applyKaAnalysis(first, sgf.tree.props['KA']);
          }
          newRoot.children.push(first);
          buildFromSgfNodes(sgf.tree.children.map((child) => ({ parent: first, node: child })));
        }
      } else {
        buildFromSgfNodes(sgf.tree.children.map((child) => ({ parent: newRoot, node: child })));
      }
    } else {
      // Legacy: just the main line (no SGF tree provided)
      let cursor: GameNode = newRoot;
      for (const [index, mv] of sgf.moves.entries()) {
        const child = applyMoveToNode(cursor, { x: mv.x, y: mv.y, player: mv.player });
        if (!child) {
          noteRejectedMove(cursor, { x: mv.x, y: mv.y, player: mv.player }, sgf.moves.length - index);
          break;
        }
        cursor.children.push(child);
        cursor = child;
      }
    }

    const rootPropsForNavigation = newRoot.properties ?? {};
    const hasMarkersAtRoot = !!(
      rootPropsForNavigation.MA?.length ||
      rootPropsForNavigation.TR?.length ||
      rootPropsForNavigation.CR?.length ||
      rootPropsForNavigation.SQ?.length ||
      rootPropsForNavigation.LB?.length
    );
    const isProblemCollection = newRoot.children.length > 3 && !newRoot.move && !hasMarkersAtRoot;
    const rewind = get().settings.loadSgfRewind;
    let current = newRoot;
    if (isProblemCollection) {
      current = newRoot.children[0]!;
    } else if (!rewind) {
      while (current.children.length > 0) current = current.children[0]!;
    }

    const describeRejected = (): string | null => {
      if (!rejected.firstLabel) return null;
      const detail =
        rejected.lines > 1
          ? `${rejected.moves} moves across ${rejected.lines} lines were not loaded.`
          : rejected.moves > 1
            ? `It and the ${rejected.moves === 2 ? 'move' : `${rejected.moves - 1} moves`} after it were not loaded.`
            : 'It was not loaded.';
      // Only multi-stone suicide depends on the ruleset. Blaming the ruleset
      // for the other three sent the reader off to change a setting that would
      // not have helped: an occupied point, a ko and a one-stone suicide are
      // illegal under every ruleset here.
      const cause =
        rejected.firstReason === 'occupied'
          ? 'plays on a point that already holds a stone'
          : rejected.firstReason === 'ko'
            ? 'repeats the position before it, which the ko rule forbids'
            : rejected.firstReason === 'suicide-single'
              ? 'is a single-stone suicide, which no ruleset allows'
              : `is a multi-stone suicide, which ${rulesLabel(rules)} rules forbid. ${suicideAllowingRulesLabel()} rules allow it`;
      return `${rejected.firstLabel} ${cause}. ${detail}`;
    };

    set((state) => ({
      // A drill describes positions in the tree being replaced, so it cannot
      // survive the replacement.
      mistakeDrill: null,
      sgfLoadWarning: describeRejected(),
      rootNode: newRoot,
      currentNode: current,
      pinnedVariations: restorePinnedVariations(newRoot),
      activeBranchChildIds: rememberActiveBranchPath({}, current),
      board: current.gameState.board,
      currentPlayer: current.gameState.currentPlayer,
      moveHistory: current.gameState.moveHistory,
      capturedBlack: current.gameState.capturedBlack,
      capturedWhite: current.gameState.capturedWhite,
      komi: rootState.komi,
      boardRotation: 0,
      isEditMode: false,
      editTool: state.editTool,
      analysisData: current.analysis || null,
      analysisCacheSize: getAnalysisCacheSize(newRoot),
	      treeVersion: state.treeVersion + 1,
	      // Rules follow the file, because a loaded game has to be scored under
	      // the rules it was played with. The *new game* defaults do not: those
	      // are the reader's own settings, and a file is not a preference.
	      // Writing them here laundered a property of someone else's game into
	      // a persisted setting -- open a 9-stone handicap game, press Quick
	      // new game, and you got nine stones you never asked for, on a control
	      // whose warning names only the board size. `startNewGame` then saved
	      // it, so every later new game had them too.
	      settings: { ...state.settings, gameRules: rules },
		    }));

		    // KaTrain-like: optionally start fast background analysis of the whole mainline so graphs populate fast.
		    if (typeof window !== 'undefined' && typeof Worker !== 'undefined' && get().settings.loadSgfFastAnalysis) {
		      setTimeout(() => get().startFastGameAnalysis(), 0);
		    }
		  },

  passTurn: () => {
      const state = get();
      if (isAwaitingAiReply(state)) {
        refuseWhileAwaitingAi(set, get);
        return;
      }
      if (state.settings.soundEnabled) {
        playPassSound();
      }
      const move: Move = { x: -1, y: -1, player: state.currentPlayer };

      // Check for existing pass child
      const existingChild = state.currentNode.children.find(child =>
        child.move && child.move.x === -1 && child.move.y === -1 && child.move.player === state.currentPlayer
      );

      if (existingChild) {
           skipNavigationSoundForNodeId = existingChild.id;
           get().jumpToNode(existingChild);
           const after = get();
           const ended = isPassMove(after.currentNode.move) && isPassMove(after.currentNode.parent?.move);
           if (ended) announceGameEnd(set);
           if (!ended && after.isAiPlaying && after.aiColor && after.currentPlayer === after.aiColor) {
             after.scheduleAiMove(500);
           }
           if (after.isAnalysisMode && !after.isSelfplayToEnd) {
             scheduleAnalysis(() => void after.runAnalysis({ ifIdle: true }), 0);
           }
           return;
      }

      const nextPlayer = state.currentPlayer === 'black' ? 'white' : 'black';
      const newGameState: GameState = {
        board: state.board, // No change
        currentPlayer: nextPlayer,
        moveHistory: [...state.moveHistory, move],
        capturedBlack: state.capturedBlack,
        capturedWhite: state.capturedWhite,
        komi: state.komi
      };

      const newNode = createNode(state.currentNode, move, newGameState);
      lastPlayedNodeId = newNode.id;
      skipNavigationSoundForNodeId = newNode.id;
      state.currentNode.children.push(newNode);

      set({
          ...clearEditHistory(), // as playMove: an older snapshot would take the pass away
          currentNode: newNode,
          currentPlayer: newGameState.currentPlayer,
          moveHistory: newGameState.moveHistory,
          // board doesn't change
          analysisData: null,
          activeBranchChildIds: rememberActiveBranchPath(state.activeBranchChildIds, newNode),
          treeVersion: state.treeVersion + 1,
      });

      const after = get();
      const ended = isPassMove(after.currentNode.move) && isPassMove(after.currentNode.parent?.move);
      if (ended) announceGameEnd(set);
      if (!ended && after.isAiPlaying && after.aiColor && after.currentPlayer === after.aiColor) {
        after.scheduleAiMove(500);
      }
      if (after.isAnalysisMode && !after.isSelfplayToEnd) scheduleAnalysis(() => void after.runAnalysis({ ifIdle: true }), 0);
  },

  resign: (player) => {
    cancelAiMoveWork();
    const state = get();
    const endState = getResignResult(player ?? state.currentPlayer);
    state.currentNode.endState = endState;

    if (!state.rootNode.properties) state.rootNode.properties = {};
    // As recordCountedResult: never overwrite the result the game carries.
    if (!readRecordedResult(state.rootNode.properties.RE?.[0])) state.rootNode.properties.RE = [endState];

    get().stopSelfplayToEnd();

    set((s) => ({
      isAiPlaying: false,
      isAiThinking: false,
      aiColor: null,
      treeVersion: s.treeVersion + 1,
    }));
  },

  /**
   * Record the result of a game that was played out and counted.
   *
   * Resigning wrote `RE`; counting did not, so the ordinary way to finish a Go
   * game -- two passes and a count -- was the one that lost its result. The
   * panel showed W+7.0, and the exported SGF carried no result at all, which
   * also left the library and any reopened copy with nothing.
   *
   * Only for a position that really is the end. Scoring can be opened mid-game
   * to estimate, and an estimate is not a result.
   */
  recordCountedResult: (result: string) => {
    const state = get();
    const node = state.currentNode;
    const bothPassed = isPassMove(node.move) && isPassMove(node.parent?.move);
    if (!bothPassed) return false;
    // Never overwrite a result the game already carries: a loaded SGF's RE is
    // what the players agreed, and a count here is only this app's arithmetic.
    if (node.endState) return false;

    node.endState = result;
    if (!state.rootNode.properties) state.rootNode.properties = {};
    if (!state.rootNode.properties.RE?.[0]) state.rootNode.properties.RE = [toSgfResult(result)];

    set((s) => ({ treeVersion: s.treeVersion + 1 }));
    return true;
  },

  rotateBoard: () =>
    set((state) => ({
      boardRotation: (((state.boardRotation ?? 0) + 1) % 4) as 0 | 1 | 2 | 3,
    })),
  };
});

/**
 * A watchdog for the AI opponent's turn.
 *
 * Every path that hands the AI the move is meant to schedule its reply, and
 * every path that cancels its search is meant to start it again. Each one
 * that forgot -- Escape's Stop, clearing the cache, a settings change landing
 * mid-search, Undo to the root, Redo onto its turn -- left a game waiting on
 * a move that never came, with nothing on screen saying why. Whatever the
 * cause, a position that settles with the AI to move at the end of the line
 * and nothing searching gets its search started.
 */
const AI_WATCHDOG_DELAY_MS = 1500;
let aiWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
const aiIsStranded = (state: GameStore): boolean =>
  isAwaitingAiReply(state)
  && !state.isAiThinking
  && scheduledAiMoveTimers.size === 0
  && !state.setupPositionProgress
  && !state.isSelfplayToEnd
  && !state.isGameAnalysisRunning
  && !state.isEditMode
  && !state.isInsertMode
  && !state.mistakeDrill;
// Re-armed on every change rather than held while pending, so a timer that
// never fires (a discarded one) cannot switch the watchdog off.
useGameStore.subscribe((state) => {
  if (aiWatchdogTimer !== null) clearTimeout(aiWatchdogTimer);
  aiWatchdogTimer = null;
  if (!aiIsStranded(state)) return;
  aiWatchdogTimer = setTimeout(() => {
    aiWatchdogTimer = null;
    const latest = useGameStore.getState();
    if (aiIsStranded(latest)) latest.scheduleAiMove(0);
  }, AI_WATCHDOG_DELAY_MS);
});

let notificationAutoDismissTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
// The store field is the single visible slot; this holds what is waiting behind
// it. Call sites keep writing `notification` directly and this subscriber acts
// as the funnel, so an error is never pushed off screen by the next "Added
// label" confirmation before it can be read or copied.
let notificationState = emptyNotificationQueue<StoreNotification>();

const showNotification = (next: StoreNotification | null) => {
  // Marks the write as ours so the subscriber does not treat it as an arrival.
  notificationState = { ...notificationState, displayed: next };
  useGameStore.setState({ notification: next });
};

// Set while the toast is hovered or focused. A message that someone is reading
// — or reaching across to copy — should not time out under the pointer.
let notificationHeld = false;

const scheduleNotificationDismiss = () => {
  if (notificationAutoDismissTimer) {
    globalThis.clearTimeout(notificationAutoDismissTimer);
    notificationAutoDismissTimer = null;
  }
  if (notificationHeld) return;
  const notification = notificationState.displayed;
  const delay = autoDismissDelay(notification);
  if (!notification || delay === null) return;
  notificationAutoDismissTimer = globalThis.setTimeout(() => {
    if (notificationState.displayed !== notification) return;
    notificationState = dismissNotification(notificationState);
    showNotification(notificationState.displayed);
    scheduleNotificationDismiss();
  }, delay);
};

useGameStore.subscribe((state, previousState) => {
  if (state.notification === previousState.notification) return;
  if (state.notification === notificationState.displayed) return; // our own write

  if (state.notification === null) {
    // Dismissed from the UI — promote whatever was waiting behind it.
    notificationState = dismissNotification(notificationState);
    if (notificationState.displayed) showNotification(notificationState.displayed);
  } else {
    notificationState = admitNotification(notificationState, state.notification);
    // An arrival behind an error must not be left showing in the slot.
    if (state.notification !== notificationState.displayed) showNotification(notificationState.displayed);
  }
  scheduleNotificationDismiss();
});

/** Hold or release the visible toast's dismissal timer (hover and focus). */
export const setNotificationHeld = (held: boolean) => {
  if (notificationHeld === held) return;
  notificationHeld = held;
  scheduleNotificationDismiss();
};

analysisQueue.subscribeCacheSize((queueCacheSize) => {
  useGameStore.setState((state) => ({
    analysisCacheSize: Math.max(countAnalyzedNodes(state.rootNode), queueCacheSize),
  }));
});

/**
 * The moves the fallback bot may choose from: legal under the game's rules,
 * superko included. Exported for tests.
 */
export const heuristicLegalMoves = (store: Pick<GameStore, 'board' | 'currentPlayer' | 'currentNode' | 'settings'>): Array<{ x: number; y: number }> => {
    const { board, currentPlayer, currentNode } = store;
    const parentBoard = koReferenceBoard(currentNode);
    const rules = store.settings.gameRules;
    const koRule = rulesOf(rules).ko;
    const nextPlayer: Player = currentPlayer === 'black' ? 'white' : 'black';
    return getLegalMoves(board, currentPlayer, parentBoard, { multiStoneSuicideLegal: isSuicideLegal(rules) }).filter((m) => {
        if (koRule === 'simple') return true;
        const tentative = board.map((row) => [...row]);
        tentative[m.y]![m.x] = currentPlayer;
        const captured = applyCapturesInPlace(tentative, m.x, m.y, currentPlayer);
        // Superko judges the position after a legal suicide comes off, as
        // playMove does; testing it with the group still on offered a move
        // playMove then refused, and the bot made none.
        if (captured.length === 0 && getLiberties(tentative, m.x, m.y).liberties === 0) {
          applySelfCaptureInPlace(tentative, m.x, m.y);
        }
        return !lineViolatesSuperko(currentNode, tentative, nextPlayer, koRule);
    });
};

const makeHeuristicMove = (store: GameStore) => {
    const { board, currentPlayer } = store;
    const boardSize = getBoardSizeFromBoard(board);
    const center = (boardSize - 1) / 2;
    const line3 = 2;
    const line4 = 3;
    const line3Far = boardSize - 3;
    const line4Far = boardSize - 4;

    // 1. Get all legal moves, under the same rules playMove will apply: the
    // fallback used to offer a move playMove then refused, and the AI passed
    // on nothing.
    const legalMoves = heuristicLegalMoves(store);

    if (legalMoves.length === 0) {
        asEngineMove(() => store.passTurn());
        return;
    }

    // Heuristics
    // Score each move
    let bestMove = legalMoves[0];
    let bestScore = -Infinity;

    // Helper: simulate move
	    const simulate = (x: number, y: number) => {
	        const tentativeBoard = board.map(row => [...row]);
	        tentativeBoard[y][x] = currentPlayer;
	        const captured = applyCapturesInPlace(tentativeBoard, x, y, currentPlayer);
	        return { captured, newBoard: tentativeBoard };
	    };

    for (const move of legalMoves) {
        let score = Math.random() * 5; // Base random score to break ties
        const { x, y } = move;

        // A. Don't fill own eyes
        if (isEye(board, x, y, currentPlayer)) {
            score -= 1000;
        }

        const { captured, newBoard } = simulate(x, y);

        // B. Capture Groups (Atari)
        if (captured.length > 0) {
            score += 100 * captured.length;
        }

        // C. Avoid Self-Atari (unless capturing)
        const { liberties } = getLiberties(newBoard, x, y);
        if (liberties === 1) {
            // Is it a snapback? Or just dumb?
            // If we captured something, maybe okay. If not, bad.
            if (captured.length === 0) {
                score -= 50;
            }
        }

        // D. Save own stones in Atari
        // Check neighbors
        const neighbors = [
            {x: x+1, y}, {x: x-1, y}, {x, y: y+1}, {x, y: y-1}
        ];
        for (const n of neighbors) {
            if (n.x >= 0 && n.x < boardSize && n.y >= 0 && n.y < boardSize) {
                if (board[n.y][n.x] === currentPlayer) {
                    const groupLiberties = getLiberties(board, n.x, n.y).liberties;
                    if (groupLiberties === 1) {
                        // Playing here saves it?
                         const newLibs = getLiberties(newBoard, x, y).liberties;
                         if (newLibs > 1) {
                             score += 80; // Saving throw
                         }
                    }
                }
            }
        }

        // E. Opening Heuristics (Corners > Edges > Center)
        if (store.moveHistory.length < 30) {
             const distToCenter = Math.abs(x - center) + Math.abs(y - center); // Used indirectly
             // Prefer lines 3 and 4
             const onLine3or4 = (
               x === line3 ||
               x === line4 ||
               x === line3Far ||
               x === line4Far ||
               y === line3 ||
               y === line4 ||
               y === line3Far ||
               y === line4Far
             );

             if (onLine3or4) score += 5;

             // Avoid 1-1, 2-2 early on
             if (x <= 1 || x >= boardSize - 2 || y <= 1 || y >= boardSize - 2) score -= 5;

             // Add small bias for center if not on line 3/4
             if (!onLine3or4 && distToCenter < 6) score += 1;
        }

        // F. Proximity to last move (Local response)
        const lastMove = store.moveHistory.length > 0 ? store.moveHistory[store.moveHistory.length - 1] : null;
        if (lastMove && lastMove.x !== -1) {
            const dist = Math.abs(lastMove.x - x) + Math.abs(lastMove.y - y);
            if (dist <= 3) score += 5;
        }

        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }
    }

    asEngineMove(() => {
      if (bestScore < -500) {
          // If best move is terrible (e.g. filling eye), pass.
          store.passTurn();
      } else {
          store.playMove(bestMove.x, bestMove.y);
      }
    });
};
