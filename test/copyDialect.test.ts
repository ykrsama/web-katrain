import { readFileSync } from 'node:fs';
import { readFileSync as readLocalizedSource } from './helpers/localizedSource';
import { describe, expect, it } from 'vitest';

describe('stored trainer theme compatibility', () => {
  it('leaves the stored trainer theme value spelled as KaTrain stores it', () => {
    // This one is a persisted setting shared with KaTrain, not copy. Only the
    // option's visible text was Americanised; renaming the value would drop
    // the saved preference of anyone already using it.
    const settings = readLocalizedSource('src/components/SettingsModal.tsx', 'utf8');

    expect(settings).toContain('<option value="theme:red-green-colourblind">Red/Green colorblind</option>');
    expect(readFileSync('src/types.ts', 'utf8')).toContain("'theme:red-green-colourblind'");
    expect(readFileSync('src/utils/katrainTheme.ts', 'utf8')).toContain("'theme:red-green-colourblind'");
  });
});
