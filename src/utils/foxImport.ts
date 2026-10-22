import type { TranslationVars } from '../i18n/translate';

/** Store a source key and variables, not a rendered error frozen to one locale. */
export class FoxImportError extends Error {
  readonly vars?: TranslationVars;
  constructor(key: string, vars?: TranslationVars) { super(key); this.name = 'FoxImportError'; this.vars = vars; }
}

/** Fox's raw SGF stays untouched; only an explicit import copy may get new komi. */
export function resolveFoxKomi(raw: string | undefined, confirmed = ''): number | undefined {
  const chosen = confirmed.trim();
  if (chosen) {
    const value = Number(chosen);
    if (!Number.isFinite(value) || Math.abs(value) >= 100) throw new FoxImportError('Enter a valid komi with an absolute value below 100.');
    return value;
  }
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) >= 100) {
    throw new FoxImportError('Original KM[{komi}] cannot be used directly as points. Check the rules and confirm the import komi.', { komi: raw });
  }
  return value;
}
