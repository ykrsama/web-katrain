import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const boardSource = () => readFileSync('src/components/GoBoard.tsx', 'utf8');

describe('the blindfold board', () => {
  it('covers the board instead of unmounting it', () => {
    const source = boardSource();
    const overlay = source.indexOf('data-blindfold-board="true"');
    const board = source.indexOf('data-board-snapshot="true"');

    expect(overlay).toBeGreaterThan(-1);
    // The board has to stay in the tree behind the overlay: unmounting the
    // canvas stack left the re-mounted canvases blank when the mode ended,
    // because the drawing effects only depend on board state and never had a
    // reason to run again.
    expect(board).toBeGreaterThan(overlay);
  });

  it('shows the read-back point and nothing else in the board area', () => {
    const source = boardSource();

    // A sample point read as the current one while nothing had been said yet,
    // and the status lines only duplicated the banner below.
    expect(source).not.toContain('blindfoldExample');
    expect(source).toContain("const blindfoldHeadline = blindfold?.lastPoint?.text ?? '';");
    expect(source).not.toContain("t('Listening for your move…')");
    expect(source).not.toContain("t('Engine is thinking…')");
    expect(source).toContain('data-blindfold-headline="true"');
  });

  it('names the shape of the newest move under its point', () => {
    const source = boardSource();

    // The engine says the shape out loud, so the same name has to be readable
    // when the player looks at the covered board.
    expect(source).toContain("const blindfoldShape = blindfold?.lastPoint?.shape ?? '';");
    expect(source).toContain('data-blindfold-shape="true"');
  });
});
