import type { BoardSize } from '../types';
import { t } from '../i18n';

/**
 * What the control is about to do, in the words of what it will produce.
 *
 * It named the board size and stopped there, so a saved handicap default put
 * stones on the board that nothing had mentioned -- "uses your saved defaults"
 * is true and tells the reader nothing about what those are.
 */
export function getQuickNewGameWarning(boardSize: BoardSize, handicap = 0): string {
  const stones = Number.isFinite(handicap) ? Math.max(0, Math.floor(handicap)) : 0;
  const setup = stones > 0
    ? t('{size}×{size}, {stones} handicap stones', { size: boardSize, stones })
    : `${boardSize}×${boardSize}`;
  return t('Quick new game ({setup}): uses your saved defaults and replaces the current game after the unsaved-changes check.', { setup });
}
