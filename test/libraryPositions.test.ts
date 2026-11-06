import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ENTRIES, readLibraryPosition, writeLibraryPosition } from '../src/utils/libraryPositions';

let entries: Map<string, string>;
beforeEach(() => {
  entries = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, String(value)); },
    removeItem: (key: string) => { entries.delete(key); },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('where each Library game was left', () => {
  it('remembers a path per game', () => {
    writeLibraryPosition('a', [0, 0, 1]);
    writeLibraryPosition('b', [0]);
    expect(readLibraryPosition('a')).toEqual([0, 0, 1]);
    expect(readLibraryPosition('b')).toEqual([0]);
    expect(readLibraryPosition('missing')).toBeNull();
  });

  it('ignores damaged storage rather than throwing', () => {
    entries.set('web-katrain:library_positions:v1', '{"a":[0,"x"],"b":[1]');
    expect(readLibraryPosition('a')).toBeNull();
    entries.set('web-katrain:library_positions:v1', '{"a":[0,-1],"b":[1]}');
    expect(readLibraryPosition('a')).toBeNull();
    expect(readLibraryPosition('b')).toEqual([1]);
  });

  it('keeps the configured number of most recent games', () => {
    for (let i = 0; i < MAX_ENTRIES + 5; i++) writeLibraryPosition(`g${i}`, [i]);
    expect(readLibraryPosition('g0')).toBeNull();
    expect(readLibraryPosition(`g${MAX_ENTRIES + 4}`)).toEqual([MAX_ENTRIES + 4]);
    expect(Object.keys(JSON.parse(entries.get('web-katrain:library_positions:v1')!))).toHaveLength(MAX_ENTRIES);
  });

  it('is restored when the Library opens a game and saved as it is left', () => {
    // A review left at move 140 used to reopen at move 0.
    const layout = readFileSync('src/components/Layout.tsx', 'utf8');
    expect(layout).toContain('const savedPath = itemId ? readLibraryPosition(itemId) : null;');
    expect(layout).toContain('writeLibraryPosition(id, path)');
    expect(readFileSync('src/components/LibraryPanel.tsx', 'utf8')).toContain('await onLoadSgf(item.sgf, item.id)');
  });
});
