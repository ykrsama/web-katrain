import { describe, expect, it } from 'vitest';
import { applyFoxImportOptions, foxImportOptions, validFoxImportOptions } from '../src/utils/foxImportOptions';
import { rulesOf } from '../src/utils/goRules';
import { parseSgf } from '../src/utils/sgf';

describe('Fox import rules and komi', () => {
  it.each([
    ['Chinese', '375', 'chinese', 7.5],
    ['Japanese', '650', 'japanese', 6.5],
    ['Korean', '650', 'korean', 6.5],
    ['Chinese', '6.5', 'chinese', 6.5],
    ['Japanese', '0', 'japanese', 0],
    ['Korean', '-0.5', 'korean', -0.5],
  ] as const)('decodes %s KM[%s] while retaining ordinary point values', (ru, raw, rules, komi) => {
    expect(foxImportOptions({ RU: [ru], KM: [raw] })).toEqual({ rules, komi: String(komi), needsConfirmation: false });
  });
  it('uses a rule default for missing or unknown encodings', () => {
    for (const rule of ['Chinese', 'Japanese', 'Korean']) {
      for (const raw of ['', 'not-a-number', '999', 'Infinity']) {
        const options = foxImportOptions({ RU: [rule], KM: [raw] });
        expect(Number(options.komi)).toBe(rulesOf(options.rules).defaultKomi);
        expect(validFoxImportOptions(options)).toBe(true);
        expect(options.needsConfirmation).toBe(true);
      }
    }
    expect(foxImportOptions({ KM: ['650'] }).rules).toBe('japanese');
    expect(foxImportOptions({ KM: ['375'] }).rules).toBe('chinese');
    expect(foxImportOptions({ KM: ['375'] }).needsConfirmation).toBe(true);
    expect(foxImportOptions({ RU: ['unknown'], KM: ['6.5'] }).needsConfirmation).toBe(true);
  });
  it('applies both user choices to the playable import without changing the source SGF', () => {
    const source = '(;SZ[19]RU[Chinese]KM[375];B[dd])';
    const parsed = applyFoxImportOptions(parseSgf(source), { rules: 'korean', komi: '0.5' });
    expect(parsed.komi).toBe(0.5);
    expect(parsed.tree?.props).toMatchObject({ RU: ['Korean'], KM: ['0.5'] });
    expect(parseSgf(source).tree?.props.KM).toEqual(['375']);
  });
  it('prevents blank or invalid edited komi from importing', () => {
    for (const komi of ['', ' ', 'NaN', 'Infinity', '375']) expect(validFoxImportOptions({ rules: 'chinese', komi })).toBe(false);
  });
});
