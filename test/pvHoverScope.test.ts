import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hoveredMoveForNode } from '../src/utils/pvAnimation';
import type { CandidateMove } from '../src/types';

const candidate = (nodeId: string, pv: string[]): { nodeId: string; move: CandidateMove } => ({
  nodeId,
  move: {
    x: 15,
    y: 15,
    winRate: 0.5,
    scoreLead: 0,
    visits: 100,
    pointsLost: 0,
    order: 0,
    pv,
  },
});

describe('a hovered candidate belongs to one position', () => {
  it('is kept while the board still shows the node it was read off', () => {
    const hover = candidate('node-a', ['Q4', 'D16']);
    expect(hoveredMoveForNode(hover, 'node-a')).toBe(hover.move);
  });

  it('is dropped once the board has moved on', () => {
    // Hovering an engine candidate, then playing a stone, leaves the pointer
    // where it was: without this the old variation stayed on the new board,
    // replayed from its first move, and -- because the PV overlay colours move
    // 0 with the side to move -- came back with black and white swapped.
    const hover = candidate('node-a', ['Q4', 'D16']);
    expect(hoveredMoveForNode(hover, 'node-b')).toBeNull();
  });

  it('has nothing to hand back when no candidate is hovered', () => {
    expect(hoveredMoveForNode(null, 'node-a')).toBeNull();
  });
});

describe('the workspace scopes the board hover to the current node', () => {
  const layout = readFileSync('src/components/Layout.tsx', 'utf8');

  it('stamps the hover with the node that was on the board', () => {
    expect(layout).toContain('nodeId: useGameStore.getState().currentNode.id');
  });

  it('reads the hover back through the node it belongs to', () => {
    expect(layout).toContain('hoveredMoveForNode(hoveredMove, currentNode.id)');
  });

  it('hands both boards the scoping handler rather than the raw setter', () => {
    expect(layout).toContain('onHoverMove={handleHoverMove}');
    expect(layout).not.toContain('onHoverMove={setHoveredMove}');
  });
});
