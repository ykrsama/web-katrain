import { rulesFromSgf, rulesOf, rulesToSgf } from './goRules';
import type { GameRules } from '../types';
import { resolveFoxKomi } from './foxImport';
type FoxMoveNode = { props: Record<string, string[]>; children: FoxMoveNode[] };

export type FoxImportOptions = { rules: GameRules; komi: string; needsConfirmation?: boolean };
export function validFoxImportOptions(options: FoxImportOptions): boolean {
  return options.komi.trim() !== '' && Number.isFinite(Number(options.komi)) && Math.abs(Number(options.komi)) < 100;
}

/** Fox encodes Chinese komi in hundredths of a stone, Japanese/Korean in
 * hundredths of a point. Ordinary SGF point values remain unchanged. */
export function foxImportOptions(props: Record<string, string[]>): FoxImportOptions {
  const raw = props.KM?.[0]?.trim();
  const value = raw ? Number(raw) : NaN;
  const sourceRules = rulesFromSgf(props.RU?.[0]);
  const rules = sourceRules ?? (Math.abs(value) === 650 ? 'japanese' : 'chinese');
  let komi = rulesOf(rules).defaultKomi;
  let hasKomi = false;
  if (Number.isFinite(value)) {
    if (Math.abs(value) < 100) { komi = value; hasKomi = true; }
    else {
      const decoded = value / (rules === 'chinese' ? 50 : 100);
      // Unknown encodings fall back to the rule preset rather than an
      // implausible point value. Half-point values cover Fox's normal komi.
      if (Math.abs(decoded) < 100 && Number.isInteger(decoded * 2)) { komi = decoded; hasKomi = true; }
    }
  }
  return { rules, komi: String(komi), needsConfirmation: !sourceRules || !hasKomi };
}

export function applyFoxImportOptions<T extends { komi: number; tree?: FoxMoveNode }>(parsed: T, options: FoxImportOptions): T {
  parsed.komi = resolveFoxKomi(undefined, options.komi) ?? rulesOf(options.rules).defaultKomi;
  if (parsed.tree) {
    parsed.tree.props.KM = [String(parsed.komi)];
    parsed.tree.props.RU = [rulesToSgf(options.rules)];
  }
  return parsed;
}
