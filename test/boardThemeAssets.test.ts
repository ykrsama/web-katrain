import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Metadata must remain valid when board geometry is optimized. */
const BOARD = 'public/themes/hikaru/board.svg';

describe('Hikaru board asset', () => {
  it('keeps the document intact outside its geometry', () => {
    const svg = readFileSync(BOARD, 'utf8');
    /**
     * Rounding every number in the file, rather than only the geometry, also
     * rewrote `version="1.0"` to `1.00` and the Dublin Core namespace to
     * `elements/1.10/`. Neither changes a pixel, so the render comparison that
     * cleared the change could not see it. These can.
     */
    expect(svg).toContain('http://purl.org/dc/elements/1.1/');
    expect(svg).toContain('http://creativecommons.org/ns#');
    expect(svg).toContain('<?xml version="1.0" encoding="UTF-8"');
    // No stray URL got a decimal rewritten into it.
    expect(svg).not.toMatch(/https?:\/\/[^"']*\d\.\d\d\//);
  });
});
