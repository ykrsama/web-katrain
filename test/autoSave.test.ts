import { describe, expect, it, vi } from 'vitest';
import {
  AUTO_SAVE_MAX_BYTES,
  AUTO_SAVED_GAME_KEY,
  clearAutoSavedGame,
  readAutoSavedGame,
  writeAutoSavedGame,
} from '../src/utils/autoSave';

const makeStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
};

describe('auto-save helpers', () => {
  it('round trips an SGF snapshot', () => {
    const storage = makeStorage();

    expect(writeAutoSavedGame('(;GM[1]SZ[19];B[pd])', storage, 123)).toBe('saved');
    expect(readAutoSavedGame(storage)).toEqual({
      version: 1,
      savedAt: 123,
      sgf: '(;GM[1]SZ[19];B[pd])',
    });
  });

  it('ignores malformed snapshots and blank games', () => {
    const storage = makeStorage();

    expect(writeAutoSavedGame('   ', storage, 123)).toBe('failed');
    storage.setItem(AUTO_SAVED_GAME_KEY, '{"version":1,"savedAt":123,"sgf":"   "}');
    expect(readAutoSavedGame(storage)).toBeNull();
    storage.setItem(AUTO_SAVED_GAME_KEY, '{not json');
    expect(readAutoSavedGame(storage)).toBeNull();
  });

  it('skips oversized snapshots and clears stale recovery data', () => {
    const storage = makeStorage();

    expect(writeAutoSavedGame('(;GM[1]SZ[19];B[pd])', storage, 123)).toBe('saved');
    expect(storage.getItem(AUTO_SAVED_GAME_KEY)).not.toBeNull();

    // Exercise the measured-byte limit without allocating/stringifying a
    // 500 MB SGF and another 500 MB encoded buffer on a shared CI runner.
    const encoder = vi.spyOn(TextEncoder.prototype, 'encode')
      .mockReturnValueOnce({ byteLength: AUTO_SAVE_MAX_BYTES + 1 } as ReturnType<TextEncoder['encode']>);
    try {
      expect(writeAutoSavedGame('(;GM[1]SZ[19]C[Oversized snapshot])', storage, 124)).toBe('too-large');
      expect(storage.getItem(AUTO_SAVED_GAME_KEY)).toBeNull();
    } finally { encoder.mockRestore(); }
  });

  it.each([AUTO_SAVE_MAX_BYTES - 1, AUTO_SAVE_MAX_BYTES])('accepts a snapshot measuring %i bytes', bytes => {
    const storage = makeStorage();
    const encoder = vi.spyOn(TextEncoder.prototype, 'encode')
      .mockReturnValueOnce({ byteLength: bytes } as ReturnType<TextEncoder['encode']>);
    try {
      expect(writeAutoSavedGame('(;GM[1]SZ[19])', storage, 123)).toBe('saved');
      expect(readAutoSavedGame(storage)?.sgf).toBe('(;GM[1]SZ[19])');
    } finally { encoder.mockRestore(); }
  });

  it('clears snapshots', () => {
    const storage = makeStorage();

    writeAutoSavedGame('(;GM[1]SZ[19])', storage, 123);
    clearAutoSavedGame(storage);

    expect(readAutoSavedGame(storage)).toBeNull();
  });
});
