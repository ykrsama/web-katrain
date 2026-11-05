import { describe, expect, it } from 'vitest';
import { normalizeLocalizedSource } from './helpers/localizedSource';

describe('source guards with translated UI', () => {
  it('reads translated attributes and visible text as their English source', () => {
    expect(normalizeLocalizedSource(`<button aria-label={t('Open game')}>{t('Open game')}</button>`))
      .toBe('<button aria-label="Open game">Open game</button>');
  });
  it('restores template expressions and leaves technical attributes alone', () => {
    const source = `<button className="pbtn" title={t('Move {count}', { count: index + 1 })} />`;
    expect(normalizeLocalizedSource(source)).toBe('<button className="pbtn" title={`Move ${index + 1}`} />');
  });
  it('reads source words in a translated conditional', () => {
    expect(normalizeLocalizedSource(`const name = t(active ? 'Hide' : 'Show');`, 'helper.ts'))
      .toBe("const name = active ? 'Hide' : 'Show';");
  });
});
