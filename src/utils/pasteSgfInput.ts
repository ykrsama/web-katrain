import { extractOgsGameId } from './ogs';
import { t } from '../i18n';

export type PasteSgfSubmitResult = 'loaded' | 'cancelled' | 'failed';

export type PasteSgfInputKind = 'empty' | 'ogs' | 'sgf' | 'text' | 'url';

export type PasteSgfInputInfo = {
  kind: PasteSgfInputKind;
  gameId?: string;
  helper: string;
  submitStatus: string;
  errorStatus: string;
};

const looksLikeUrl = (text: string): boolean => {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return true;
  return /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/|\?|#|$)/i.test(text);
};

export const getDirectGameImportText = (text: string | null | undefined): string | null => {
  const trimmed = text?.trim() ?? '';
  if (!trimmed) return null;
  if (trimmed.startsWith('(') || extractOgsGameId(trimmed)) return trimmed;
  return null;
};

export const getPasteSgfInputInfo = (text: string): PasteSgfInputInfo => {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      kind: 'empty',
      helper: t('Paste raw SGF text or an Online-Go game URL. OGS links are downloaded as SGF before loading.'),
      submitStatus: t('Opening SGF...'),
      errorStatus: t('Paste raw SGF text or an Online-Go game URL.'),
    };
  }

  if (trimmed.startsWith('(')) {
    return {
      kind: 'sgf',
      helper: t('Detected SGF content. It will import directly from this text.'),
      submitStatus: t('Opening pasted SGF...'),
      errorStatus: t('Could not parse this SGF. Check that it starts with (; and contains a complete game tree.'),
    };
  }

  const gameId = extractOgsGameId(trimmed) ?? undefined;
  if (gameId) {
    return {
      kind: 'ogs',
      gameId,
      helper: t('Detected OGS game {gameId}. It will download the public SGF from Online-Go.', { gameId }),
      submitStatus: t('Downloading OGS game {gameId}...', { gameId }),
      errorStatus: t('Could not download or parse OGS game {gameId}. Check that the game is public and the URL looks like online-go.com/game/12345.', { gameId }),
    };
  }

  if (looksLikeUrl(trimmed)) {
    return {
      kind: 'url',
      helper: t('This looks like a URL. Only Online-Go game links are downloaded; paste raw SGF for other sites.'),
      submitStatus: t('Opening SGF text...'),
      errorStatus: t('Could not parse this as SGF. Paste raw SGF text or an Online-Go game URL.'),
    };
  }

  return {
    kind: 'text',
    helper: t('This will be parsed as SGF text. SGF usually starts with (;GM[1].'),
    submitStatus: t('Opening SGF text...'),
    errorStatus: t('Could not parse this as SGF. Paste raw SGF text or an Online-Go game URL.'),
  };
};
