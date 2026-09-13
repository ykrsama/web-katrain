import { describe, expect, it, vi } from 'vitest';
import { parseSgf } from '../src/utils/sgf';
import {
  MAX_SGF_IMPORT_BYTES,
  MAX_SGF_IMPORT_LABEL,
  assertSgfImportSize,
  exceedsUtf8ByteLimit,
  getSgfImportSizeError,
} from '../src/utils/sgfImportLimits';
import * as sgfImportLimits from '../src/utils/sgfImportLimits';

const TOO_LARGE_MESSAGE = `SGF files are limited to ${MAX_SGF_IMPORT_LABEL}.`;

describe('SGF import limits', () => {
  it('accepts a normal SGF and an exact-size file preflight', () => {
    expect(getSgfImportSizeError('(;GM[1]SZ[19];B[pd])')).toBeNull();
    expect(getSgfImportSizeError(MAX_SGF_IMPORT_BYTES)).toBeNull();
  });

  it('rejects oversized file metadata before the file is read', () => {
    expect(getSgfImportSizeError(MAX_SGF_IMPORT_BYTES + 1)).toBe(TOO_LARGE_MESSAGE);
    expect(() => assertSgfImportSize(MAX_SGF_IMPORT_BYTES + 1)).toThrow(TOO_LARGE_MESSAGE);
  });

  it('counts multibyte text by UTF-8 bytes', () => {
    // '界' is three UTF-8 bytes in a single code unit, so a check on `.length`
    // alone would let a multibyte paste through. Exercised at small limits: the
    // real ceiling is hundreds of megabytes, and materialising a string that
    // size would cost more memory than the guard it is meant to protect.
    expect(exceedsUtf8ByteLimit('界'.repeat(3), 9)).toBe(false);
    expect(exceedsUtf8ByteLimit('界'.repeat(4), 11)).toBe(true);
    // A surrogate pair is four bytes, not the two its `.length` reports.
    expect(exceedsUtf8ByteLimit('😀', 3)).toBe(true);
    expect(exceedsUtf8ByteLimit('😀', 4)).toBe(false);
    // Two-byte characters count as two.
    expect(exceedsUtf8ByteLimit('é'.repeat(3), 5)).toBe(true);
    expect(exceedsUtf8ByteLimit('é'.repeat(3), 6)).toBe(false);
  });

  it('enforces the ceiling at the parser boundary for every import path', () => {
    // Every import path funnels through `parseSgf`, so the guard has to run
    // there. Spying keeps the check honest without allocating a string the size
    // of the real (hundreds of megabytes) ceiling.
    const spy = vi.spyOn(sgfImportLimits, 'assertSgfImportSize');

    try {
      expect(() => parseSgf('(;GM[1]SZ[19];B[pd])')).not.toThrow();
      expect(spy).toHaveBeenCalledWith('(;GM[1]SZ[19];B[pd])');
      spy.mockImplementation(() => {
        throw new Error(TOO_LARGE_MESSAGE);
      });
      expect(() => parseSgf('(;GM[1]C[oversized])')).toThrow(TOO_LARGE_MESSAGE);
    } finally {
      spy.mockRestore();
    }
  });
});
