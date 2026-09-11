import type { BoardSize } from '../types';
import { t } from '../i18n';

export function getQuickNewGameWarning(boardSize: BoardSize): string {
  return t(
    'Quick new game ({size}×{size}): uses your saved defaults and replaces the current game after the unsaved-changes check.',
    { size: boardSize }
  );
}
