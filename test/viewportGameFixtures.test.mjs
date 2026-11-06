import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { withoutCachedAnalysis, viewportGameFixtures } from '../scripts/lib/viewport-game-fixtures.mjs';
import { countSgfMoves } from '../src/utils/sgfScan';

describe('viewport game fixtures', () => {
  it('removes only cached analysis properties, respecting escapes and multiple values', () => {
    expect(withoutCachedAnalysis('(;GM[1]C[Keep KT[words\\] here]KT[a\\]b][c];B[aa]KT[search];W[bb])'))
      .toBe('(;GM[1]C[Keep KT[words\\] here];B[aa];W[bb])');
  });

  it('keeps every bundled game and move while fitting the localStorage fixture budget', () => {
    const directory = path.resolve('src/data/sgf');
    const games = fs.readdirSync(directory).filter(file => file.endsWith('.sgf'));
    let bytes = 0;
    for (const file of games) {
      const original = fs.readFileSync(path.join(directory, file), 'utf8');
      const fixture = withoutCachedAnalysis(original);
      expect(countSgfMoves(fixture), file).toBe(countSgfMoves(original));
      bytes += Buffer.byteLength(fixture, 'utf16le');
    }
    expect(games.length).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(500_000);
  });

  it('only substitutes bundled raw SGFs on its dedicated test server', () => {
    const plugin = viewportGameFixtures(process.cwd());
    expect(plugin.load(path.resolve('src/utils/library.ts'))).toBeUndefined();
    expect(plugin.load(path.resolve('src/data/sgf/example.sgf'))).toBeUndefined();
    expect(plugin.load(path.resolve('public/example.sgf') + '?raw')).toBeUndefined();
  });

  it('assigns every viewport check to exactly one CI shard', () => {
    const script = fs.readFileSync('scripts/check-viewports.mjs', 'utf8');
    const workflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
    const checks = ['layout', ...Array.from(script.matchAll(/\['(\w+)', \(\) => assert/g), match => match[1])];
    const assigned = Array.from(workflow.matchAll(/^\s+checks: (.+)$/gm), match => match[1].split(',')).flat();
    expect(assigned.slice().sort()).toEqual(checks.slice().sort());
    expect(new Set(assigned).size).toBe(assigned.length);
  });
});
