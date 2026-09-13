import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('command palette availability', () => {
  it('uses the same navigation capabilities as the visible board controls', () => {
    const source = readFileSync('src/components/Layout.tsx', 'utf8');

    expect(source).toContain("disabledReason: historyNavigation.back ? undefined : t('No previous move')");
    expect(source).toContain("disabledReason: historyNavigation.forward ? undefined : t('No next move')");
    expect(source).toContain("disabledReason: branchInfo.hasBranches ? undefined : t('No alternate branch')");
    expect(source).toContain("disabledReason: mistakeNavigation.previous ? undefined : t('No earlier analyzed mistake')");
    expect(source).toContain("disabledReason: mistakeNavigation.next ? undefined : t('No later analyzed mistake')");
  });

  it('does not offer a no-op finish scoring command outside scoring mode', () => {
    const source = readFileSync('src/components/Layout.tsx', 'utf8');

    expect(source).toContain("disabledReason: scoringMode ? undefined : t('Scoring mode is not active')");
  });
});
