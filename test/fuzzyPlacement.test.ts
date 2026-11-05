import { describe, expect, it } from 'vitest';
import { buildFuzzyStoneOffsets, readjustShifts } from '../src/utils/fuzzyPlacement';

describe('Sabaki fuzzy placement', () => {
  it.each([
    { before: [[3, 1]], after: [[3, 0]] },
    { before: [[4], [5]], after: [[4], [0]] },
    { before: [[3, 2]], after: [[3, 2]] },
    { before: [[0, 0]], after: [[0, 0]] },
    { before: [[6, 8]], after: [[6, 0]] },
    { before: [[8], [6]], after: [[8], [0]] },
  ])('matches Shudan neighbor adjustment: $before', ({ before, after }) => {
    expect(readjustShifts(before)).toEqual(after);
  });

  it('centers every point when disabled', () => {
    for (const offset of buildFuzzyStoneOffsets(19, false).flat()) {
      expect(offset).toEqual({ dxFactor: 0, dyFactor: 0 });
    }
  });

  it('keeps the whole-board layout stable across renders and navigation', () => {
    const first = buildFuzzyStoneOffsets(19, true);
    buildFuzzyStoneOffsets(9, true);
    expect(buildFuzzyStoneOffsets(19, true)).toEqual(first);
    expect(new Set(first.flat().map(({ dxFactor, dyFactor }) => `${dxFactor},${dyFactor}`)).size).toBeGreaterThan(1);
    for (const offset of first.flat()) {
      expect(Math.abs(offset.dxFactor)).toBeLessThanOrEqual(0.07);
      expect(Math.abs(offset.dyFactor)).toBeLessThanOrEqual(0.07);
    }
  });

  it.each([9, 13, 19])('prevents overlapping stone bodies even on a full board of size %i', (size) => {
    const offsets = buildFuzzyStoneOffsets(size, true);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const a = offsets[y]![x]!;
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
          const nx = x + dx!;
          const ny = y + dy!;
          const b = offsets[ny]?.[nx];
          if (!b) continue;
          const distance = Math.hypot(nx + b.dxFactor - x - a.dxFactor, ny + b.dyFactor - y - a.dyFactor);
          expect(distance, `(${x},${y}) to (${nx},${ny})`).toBeGreaterThanOrEqual(0.92);
        }
      }
    }
  });

  it.each([1, 2, 3])('rotates the adjusted vectors with the board (rotation %i)', (rotation) => {
    const initial = buildFuzzyStoneOffsets(19, true);
    const rotated = buildFuzzyStoneOffsets(19, true, rotation);
    for (let y = 0; y < 19; y++) {
      for (let x = 0; x < 19; x++) {
        let { dxFactor: dx, dyFactor: dy } = initial[y]![x]!;
        for (let i = 0; i < rotation; i++) [dx, dy] = [-dy, dx];
        expect(rotated[y]![x]!.dxFactor).toBeCloseTo(dx);
        expect(rotated[y]![x]!.dyFactor).toBeCloseTo(dy);
      }
    }
  });
});
