export type FuzzyStoneOffset = {
  dxFactor: number;
  dyFactor: number;
};

// Sabaki/Shudan's nine directions, in grid-cell units (css/goban.css).
const FUZZY_OFFSETS: readonly FuzzyStoneOffset[] = [
  { dxFactor: 0, dyFactor: 0 },
  { dxFactor: -0.07, dyFactor: 0 },
  { dxFactor: 0, dyFactor: -0.07 },
  { dxFactor: 0.07, dyFactor: 0 },
  { dxFactor: 0, dyFactor: 0.07 },
  { dxFactor: -0.04, dyFactor: -0.04 },
  { dxFactor: 0.04, dyFactor: -0.04 },
  { dxFactor: 0.04, dyFactor: 0.04 },
  { dxFactor: -0.04, dyFactor: 0.04 },
];

/** Ported from SabakiHQ/Shudan src/helper.js; see public/licenses/shudan.txt. */
export function readjustShifts(shiftMap: number[][]): number[][] {
  for (let y = 0; y < shiftMap.length; y++) {
    for (let x = 0; x < (shiftMap[0]?.length ?? 0); x++) {
      const direction = shiftMap[y]![x]!;
      const neighbors: Array<[number[], number, number, number[]]> = [
        [[1, 5, 8], x - 1, y, [3, 7, 6]],
        [[2, 5, 6], x, y - 1, [4, 7, 8]],
        [[3, 7, 6], x + 1, y, [1, 5, 8]],
        [[4, 7, 8], x, y + 1, [2, 5, 6]],
      ];
      for (const [directions, qx, qy, removeShifts] of neighbors) {
        if (directions.includes(direction) && removeShifts.includes(shiftMap[qy]?.[qx] ?? -1)) {
          shiftMap[qy]![qx] = 0;
        }
      }
    }
  }
  return shiftMap;
}

function stableHash(boardSize: number, x: number, y: number): number {
  let hash = 2166136261;
  hash = Math.imul(hash ^ boardSize, 16777619);
  hash = Math.imul(hash ^ x, 16777619);
  hash = Math.imul(hash ^ y, 16777619);
  return hash >>> 0;
}

type FuzzyStoneGeometry = {
  /** Visible stone diameter in horizontal grid-cell units. */
  stoneDiameter: number;
  cellHeightRatio: number;
};

/** Nearest offsets whose adjacent centers retain the required axis spacing. */
function fitOffsets(values: number[], clearance: number): number[] {
  // Isotonic regression of offset[i] + i * clearance. Pooling a violating
  // block spreads the correction across its stones instead of shrinking them.
  const blocks: Array<{ sum: number; count: number }> = [];
  values.forEach((value, index) => {
    blocks.push({ sum: value + index * clearance, count: 1 });
    while (blocks.length > 1) {
      const right = blocks[blocks.length - 1]!;
      const left = blocks[blocks.length - 2]!;
      if (left.sum / left.count <= right.sum / right.count) break;
      blocks.splice(-2, 2, { sum: left.sum + right.sum, count: left.count + right.count });
    }
  });
  return blocks.flatMap(({ sum, count }) => Array<number>(count).fill(sum / count))
    .map((value, index) => value - index * clearance);
}

function fitStoneSpacing(offsets: FuzzyStoneOffset[][], geometry: FuzzyStoneGeometry, rotation: number): void {
  const size = offsets.length;
  const { stoneDiameter: diameter, cellHeightRatio: ratio } = geometry;
  const display = Array.from({ length: size }, () => Array<FuzzyStoneOffset>(size));
  const diagonal = Math.hypot(1, ratio);
  // Bound diagonal approach as well as horizontal/vertical neighbors. Already
  // touching theme stones keep their original spacing; fuzz adds no overlap.
  const amplitude = Math.min(0.07, Math.max(0, (1 - diameter / diagonal) / 2));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = offsets[y]![x]!;
      offset.dxFactor *= amplitude / 0.07;
      offset.dyFactor *= amplitude / 0.07;
      const [dx, dy] = rotation === 1 ? [size - 1 - y, x]
        : rotation === 2 ? [size - 1 - x, size - 1 - y]
        : rotation === 3 ? [y, size - 1 - x] : [x, y];
      display[dy!]![dx!] = offset;
    }
  }
  for (const row of display) {
    const fitted = fitOffsets(row.map(offset => offset.dxFactor), Math.max(0, 1 - diameter));
    row.forEach((offset, x) => { offset.dxFactor = fitted[x]!; });
  }
  for (let x = 0; x < size; x++) {
    const fitted = fitOffsets(display.map(row => row[x]!.dyFactor), Math.max(0, 1 - diameter / ratio));
    display.forEach((row, y) => { row[x]!.dyFactor = fitted[y]!; });
  }
}

/** A stable whole-board map, so playing a stone never moves its neighbors. */
export function buildFuzzyStoneOffsets(boardSize: number, enabled: boolean, rotation = 0, geometry?: FuzzyStoneGeometry): FuzzyStoneOffset[][] {
  const shifts = readjustShifts(Array.from({ length: boardSize }, (_, y) =>
    Array.from({ length: boardSize }, (_, x) => enabled ? stableHash(boardSize, x, y) % 9 : 0)
  ));
  const offsets = shifts.map((row) => row.map((direction) => {
    const offset = FUZZY_OFFSETS[direction]!;
    if (direction === 0) return { ...offset };
    const { dxFactor: dx, dyFactor: dy } = offset;
    if (rotation === 1) return { dxFactor: -dy, dyFactor: dx };
    if (rotation === 2) return { dxFactor: -dx, dyFactor: -dy };
    if (rotation === 3) return { dxFactor: dy, dyFactor: -dx };
    return { ...offset };
  }));
  if (enabled && geometry) fitStoneSpacing(offsets, geometry, rotation);
  return offsets;
}
