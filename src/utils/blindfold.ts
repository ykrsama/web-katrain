/**
 * Blindfold (盲棋) training session: the small state machine the mode runs on.
 *
 * The spoken prompts are Chinese only for now, which is why they live here as
 * plain strings rather than going through the i18n layer — the translations are
 * browser voices, not UI text.
 */

import {
  formatBlindfoldCoordinate,
  parseBlindfoldCoordinate,
  type BlindfoldAnnounceMode,
} from './blindfoldCoordinates';
import type { MicrophoneFailure } from './speech';
import type { Player } from '../types';

export type { BlindfoldAnnounceMode };

export type BlindfoldPhase = 'ai-thinking' | 'listening' | 'confirming' | 'paused' | 'error';

/** How the microphone is doing, as the banner reports it. */
export type BlindfoldMicStatus = 'checking' | 'permission' | 'starting' | 'ready' | 'blocked';

export interface BlindfoldMic {
  status: BlindfoldMicStatus;
  /** Why it is not open, when it is not. */
  failure: MicrophoneFailure | null;
}

/** The newest point the mode has told the player about. */
export interface BlindfoldLastPoint {
  /** The point as the mode spells it, or the note that it was a pass. */
  text: string;
  from: 'engine' | 'player';
}

export interface BlindfoldSession {
  /** The side the engine plays; the player is the other one. */
  aiColor: Player;
  announce: BlindfoldAnnounceMode;
  phase: BlindfoldPhase;
  /** What the recogniser last heard, or null when it heard nothing. */
  transcript: string | null;
  /**
   * The last point the mode said anything about — the engine's move when it is
   * announced, or the player's answer when it is read back. Spelled the way the
   * mode says it, and shown in the board area for as long as it is the newest
   * thing that happened.
   */
  lastPoint: BlindfoldLastPoint | null;
  /**
   * Whether the microphone is actually capturing. Opening it takes a moment and
   * anything said before it is open is lost, so the mode holds its "your turn"
   * prompt back until this says `ready`.
   */
  mic: BlindfoldMic;
  /** One-line status for the banner; null while everything is going to plan. */
  message: string | null;
  /** Bumped by `resumeBlindfold` to wake a loop that paused. */
  resumeToken: number;
}

/** A write to a running session; `mic` merges so callers only name the field they know. */
export type BlindfoldPatch = Partial<Pick<BlindfoldSession, 'phase' | 'transcript' | 'lastPoint' | 'message'>> & {
  mic?: Partial<BlindfoldMic>;
};

/** Everything the mode says out loud. */
export const BLINDFOLD_SPEECH = {
  unparsed: '听不清楚',
  illegal: '此处不能落子，请再说一次',
  aiPass: '对方停一手',
  playerPass: '你停一手',
  aiThinking: 'AI 正在思考',
  listening: '请说坐标',
  noMic: '麦克风不可用',
  noAiMove: 'AI 没有落子，请检查引擎',
  finished: '双方连续停一手，对局结束',
  paused: '连续几次没有听清，点“继续听”再试。',
} as const;

const PASS_PHRASES = ['停一手', '停一着', '停一招', '虚手', '过手', 'pass'] as const;

export type BlindfoldInterpretation =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'pass' }
  | { kind: 'unparsed' };

/** What a transcript means: a point to play, a pass, or a miss. */
export const interpretBlindfoldTranscript = (
  text: string,
  boardSize: number,
  mode: BlindfoldAnnounceMode
): BlindfoldInterpretation => {
  const normalized = text.trim().toLowerCase();
  if (PASS_PHRASES.some((phrase) => normalized.includes(phrase))) return { kind: 'pass' };
  const point = parseBlindfoldCoordinate(text, boardSize, mode);
  return point ? { kind: 'move', x: point.x, y: point.y } : { kind: 'unparsed' };
};

/** A short example of what the player should say, for the banner. */
export const blindfoldExample = (boardSize: number, mode: BlindfoldAnnounceMode): string =>
  formatBlindfoldCoordinate(Math.min(3, boardSize - 1), Math.min(2, boardSize - 1), boardSize, mode);
