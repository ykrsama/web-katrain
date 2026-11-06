import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('mobile library import access', () => {
  it('the library empty state offers a control a phone actually has', () => {
    const library = readFileSync('src/components/LibraryPanel.tsx', 'utf8');

    // Dropping files in is desktop-only, so it cannot be the only route
    // offered. It used to point at the header's import button, which
    // `@container (max-width: 430px)` hides -- so the empty state now carries
    // its own, which no width can collapse.
    expect(library).toContain('data-library-empty-import="true"');
  });
});
