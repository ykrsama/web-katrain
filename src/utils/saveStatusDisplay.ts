import { t } from '../i18n';
import { AUTO_SAVE_MAX_LABEL } from './autoSave';

export type AutoSaveStatus = {
  state: 'pending' | 'saved' | 'failed' | 'too-large';
  savedAt?: number;
};

export type SaveStatusDisplayState = AutoSaveStatus['state'] | 'dirty';

export interface SaveStatusDisplay {
  state: SaveStatusDisplayState;
  label: string;
  compactLabel: string;
  detail?: string;
  title: string;
  tone: 'warning' | 'success' | 'danger' | 'accent';
  role: 'status' | 'alert';
  ariaLive: 'polite' | 'assertive';
}

export function formatSaveStatusTime(savedAt: number): string {
  return new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function getSaveStatusDisplay(
  unsavedChanges: boolean,
  autoSaveStatus: AutoSaveStatus | null = null,
): SaveStatusDisplay | null {
  if (!unsavedChanges) return null;

  if (!autoSaveStatus) {
    return {
      state: 'dirty',
      label: t('Unsaved'),
      compactLabel: t('Unsaved'),
      title: t('Unsaved changes. Save to Library or download SGF to keep this game permanently.'),
      tone: 'warning',
      role: 'status',
      ariaLive: 'polite',
    };
  }

  if (autoSaveStatus.state === 'pending') {
    return {
      state: 'pending',
      label: t('Recovery saving'),
      compactLabel: t('Saving'),
      title: t('Unsaved changes. Updating the recovery copy; save to Library or download SGF for a permanent copy.'),
      tone: 'accent',
      role: 'status',
      ariaLive: 'polite',
    };
  }

  if (autoSaveStatus.state === 'saved') {
    const detail = autoSaveStatus.savedAt ? formatSaveStatusTime(autoSaveStatus.savedAt) : undefined;
    return {
      state: 'saved',
      label: t('Recovery saved'),
      // Keep the compact badge short and fixed-width; the save time stays in
      // the detail/title so narrow bottom bars never clip it mid-string.
      compactLabel: t('Saved'),
      detail,
      title: detail
        ? t('Recovery copy saved at {detail}. This game is still unsaved until you save to Library or download SGF.', { detail })
        : t('Recovery copy saved. This game is still unsaved until you save to Library or download SGF.'),
      tone: 'success',
      role: 'status',
      ariaLive: 'polite',
    };
  }

  if (autoSaveStatus.state === 'too-large') {
    return {
      state: 'too-large',
      label: t('Recovery skipped'),
      compactLabel: t('Too large'),
      title: t('Game is too large for recovery auto-save ({max}). Save to Library or download SGF to keep changes.', { max: AUTO_SAVE_MAX_LABEL }),
      tone: 'warning',
      role: 'alert',
      ariaLive: 'assertive',
    };
  }

  return {
    state: 'failed',
    label: t('Recovery failed'),
    compactLabel: t('Save failed'),
    title: t('Recovery auto-save failed. Save to Library or download SGF to keep changes.'),
    tone: 'danger',
    role: 'alert',
    ariaLive: 'assertive',
  };
}
