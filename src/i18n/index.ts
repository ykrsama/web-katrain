import { useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import { translate } from './translate';
import type { TranslationVars } from './translate';

export type { TranslationVars };
export { translate };

/**
 * React hook that returns a translation function bound to the current document
 * language (`settings.appLocale`).  Components re-render when the locale changes
 * so every call site stays in sync.
 *
 * Usage:
 *   const { t } = useT();
 *   <button>{t('Save SGF')}</button>
 *   <span>{t('B win {win}', { win })}</span>
 */
export function useT() {
  const locale = useGameStore((s) => s.settings.appLocale);
  return useCallback(
    (text: string, vars?: TranslationVars) => translate(locale, text, vars),
    [locale],
  );
}

/**
 * Standalone translate function for non-React contexts (event handlers,
 * utility functions that cannot use hooks).  Reads the current locale directly
 * from the zustand store — call it at the time you need the translated string.
 *
 * CAUTION: this imports the game store.  Do not use it in modules that are
 * themselves imported by `store/gameStore` — use the pure `translate(locale,
 * text, vars)` export instead.
 */
export function t(text: string, vars?: TranslationVars): string {
  return translate(useGameStore.getState().settings.appLocale, text, vars);
}