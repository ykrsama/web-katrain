import type { AppLocaleId } from '../types';
import { zhMessages } from './zh/index';

export type TranslationVars = Record<string, string | number>;

/**
 * Translate a source English string to the target locale.
 *
 * For 'zh' (Chinese Simplified), the dictionary is consulted; all other locales
 * return the English source unchanged.  If a key is missing from the zh catalog
 * the English source is returned as a fallback.
 *
 * Template placeholders `{name}` in the source string are replaced with the
 * corresponding value from `vars`.
 */
export function translate(locale: AppLocaleId, text: string, vars?: TranslationVars): string {
  let result = locale === 'zh' ? (zhMessages[text] ?? text) : text;
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      result = result.split(`{${key}}`).join(String(value));
    }
  }
  return result;
}