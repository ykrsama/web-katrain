import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('layout sound recovery', () => {
  it('reports sound failures without switching the sound setting off', () => {
    const source = readFileSync('src/components/Layout.tsx', 'utf8');

    expect(source).toContain('setSoundInitErrorHandler((error) => {');
    // One failed play must not silence the rest of the session: the next play
    // tries again, so the setting stays as the user left it.
    expect(source).not.toContain('updateSettings({ soundEnabled: false });');
    expect(source).toContain('Could not play sound. It will keep trying.');
    expect(source).toContain('if (settings.soundEnabled) resetSoundFailureReport();');
    expect(source).toContain('return () => setSoundInitErrorHandler(null);');
  });
});
