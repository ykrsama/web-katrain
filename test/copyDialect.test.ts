import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { readFileSync as readLocalizedSource } from './helpers/localizedSource';
import { describe, expect, it } from 'vitest';

const collectSourceFiles = (dir: string): string[] => {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...collectSourceFiles(path));
    else if (/\.tsx?$/.test(path) && !path.endsWith('.test.ts')) files.push(path);
  }

  return files;
};

/** Comments are prose for us, not for the reader, and may say what they like. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const prose = (source: string, path = 'component.tsx'): { text: string; index: number }[] => {
  const stripped = stripComments(source);
  const ast = ts.createSourceFile(path, stripped, ts.ScriptTarget.Latest, true);
  const strings: { text: string; index: number }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) && node.text.includes(' ')) strings.push({ text: node.text, index: node.getStart(ast) });
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return strings;
};

const BRITISH = [
  'analysed', 'analysing', 'colour', 'colours', 'coloured', 'grey', 'cancelled',
  'behaviour', 'centre', 'favourite', 'recognise', 'customise', 'organise',
  'licence', 'defence',
];

const sources = collectSourceFiles('src').filter(path => !path.includes('/i18n/')).map((path) => ({ path, source: readFileSync(path, 'utf8') }));

describe('user-facing copy keeps one dialect', () => {
  it('spells its prose the way the rest of the app does', () => {
    // Measured before the fix: "analyzed" appeared in 22 strings and
    // "analysed" in 4; "Import canceled." shipped alongside "OGS request
    // cancelled."; "Swap traced stone colors" alongside a lesson about "one
    // colour". Nothing was wrong with either spelling -- only with using both.
    const offenders = sources.flatMap(({ path, source }) =>
      prose(source, path).flatMap(({ text, index }) =>
        BRITISH.filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(text)).map(
          (word) => `${path}:${stripComments(source).slice(0, index).split('\n').length} ${word} in "${text.slice(0, 60)}"`,
        ),
      ),
    );

    expect(offenders).toEqual([]);
  });

  it('counts the things it is talking about', () => {
    // One string in the app wrote "Moved 3 item(s); skipped 1 invalid move(s)."
    // while the line directly below it wrote "Moved 3 selected items." — the
    // same action, reported two ways, and the only "(s)" anywhere. It also used
    // "move" as a noun for a drag in an app where a move is a stone.
    const offenders = sources.flatMap(({ path, source }) =>
      prose(source, path)
        .filter(({ text }) => /\b[a-z]+\(s\)/i.test(text))
        .map(({ text, index }) =>
          `${path}:${stripComments(source).slice(0, index).split('\n').length} "${text.slice(0, 60)}"`),
    );

    expect(offenders, 'write the plural out: `${n} item${n === 1 ? \'\' : \'s\'}`').toEqual([]);
  });

  it('reads enough prose to be checking anything', () => {
    // Without this the assertion above passes on a literal matcher that broke.
    const total = sources.reduce((count, { source, path }) => count + prose(source, path).length, 0);

    expect(total).toBeGreaterThanOrEqual(500);
  });

  it('leaves the stored trainer theme value spelled as KaTrain stores it', () => {
    // This one is a persisted setting shared with KaTrain, not copy. Only the
    // option's visible text was Americanised; renaming the value would drop
    // the saved preference of anyone already using it.
    const settings = readLocalizedSource('src/components/SettingsModal.tsx', 'utf8');

    expect(settings).toContain('<option value="theme:red-green-colourblind">Red/Green colorblind</option>');
    expect(readFileSync('src/types.ts', 'utf8')).toContain("'theme:red-green-colourblind'");
    expect(readFileSync('src/utils/katrainTheme.ts', 'utf8')).toContain("'theme:red-green-colourblind'");
  });
});
