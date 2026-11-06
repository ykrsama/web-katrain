import type { GameNode, Move } from '../types';

const same = (a: Move | null, b: Move) => a?.x === b.x && a.y === b.y && a.player === b.player;
/** Keep node identities, analysis and study branches while replacing the broadcast line. */
export function reconcileFoxLiveLine(root: GameNode, previous: GameNode[], moves: Move[], createMove: (parent: GameNode, move: Move) => GameNode | null, createEnd: (parent: GameNode) => GameNode): GameNode[] {
  const line = [root];
  const added: Array<{ parent: GameNode; child: GameNode }> = [];
  try {
    for (let i = 0; i < moves.length; i++) {
      const parent = line.at(-1)!;
      const old = previous[i + 1];
      let child = old?.parent === parent && parent.children.includes(old) && same(old.move, moves[i]) ? old : parent.children.find(c => same(c.move, moves[i]));
      if (!child) {
        child = createMove(parent, moves[i]) ?? undefined;
        if (!child) throw new Error('The live move could not be replayed.');
        added.push({ parent, child });
      }
      line.push(child);
    }
  } catch (error) {
    for (const { parent, child } of added.reverse()) parent.children = parent.children.filter(c => c !== child);
    throw error;
  }
  for (let i = 1; i < line.length; i++) {
    const parent = line[i - 1], child = line[i];
    parent.children = [child, ...parent.children.filter(c => c !== child)];
  }
  const tip = line.at(-1)!;
  // A no-move first child terminates the live SGF after an undo. Withdrawn moves
  // and reader variations stay available as sibling branches, not extra live moves.
  if (tip.children.length && !tip.children[0].properties?.XFLIVEEND) {
    const marker = tip.children.find(c => c.properties?.XFLIVEEND) ?? createEnd(tip);
    marker.properties = { ...marker.properties, XFLIVEEND: ['1'] };
    tip.children = [marker, ...tip.children.filter(c => c !== marker)];
  }
  return line;
}
