import type { TranslationVars } from '../i18n/translate';

/** Store a source key and variables, not a rendered error frozen to one locale. */
export class FoxImportError extends Error {
  readonly vars?: TranslationVars;
  constructor(key: string, vars?: TranslationVars) { super(key); this.name = 'FoxImportError'; this.vars = vars; }
}

type FoxMoveNode = { props: Record<string, string[]>; children: FoxMoveNode[] };

/** Validate every variation too: the general SGF loader reads one move per node. */
export function assertFoxMoveNodes(root: FoxMoveNode | undefined): void {
  const pending = root ? [root] : [];
  while (pending.length) {
    const node = pending.pop()!;
    if ((node.props.B?.length ?? 0) + (node.props.W?.length ?? 0) > 1) {
      throw new FoxImportError('This record has multiple moves in one node and cannot be imported safely. Download the original SGF to preserve handicap stones.');
    }
    for (const child of node.children) pending.push(child);
  }
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
