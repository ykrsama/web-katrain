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

/** A whole-board map, including empty points, as in Shudan's Goban.js. */
export function buildFuzzyStoneOffsets(boardSize: number, enabled: boolean, rotation = 0): FuzzyStoneOffset[][] {
  const shifts = readjustShifts(Array.from({ length: boardSize }, (_, y) =>
    Array.from({ length: boardSize }, (_, x) => enabled ? stableHash(boardSize, x, y) % 9 : 0)
  ));
  return shifts.map((row) => row.map((direction) => {
    const offset = FUZZY_OFFSETS[direction]!;
    if (direction === 0) return offset;
    const { dxFactor: dx, dyFactor: dy } = offset;
    if (rotation === 1) return { dxFactor: -dy, dyFactor: dx };
    if (rotation === 2) return { dxFactor: -dx, dyFactor: -dy };
    if (rotation === 3) return { dxFactor: dy, dyFactor: -dx };
    return offset;
  }));
}
