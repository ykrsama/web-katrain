import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BotPersonaPicker } from '../src/components/BotPersonaPicker';
import { BOT_PERSONAS } from '../src/data/botPersonas';
import { formatKyuRank } from '../src/utils/tournament';

describe('BotPersonaPicker', () => {
  it('starts as a compact two-column roster', () => {
    const html = renderToStaticMarkup(<BotPersonaPicker selectedId={null} onSelect={() => undefined} />);

    // Counted from the roster rather than pinned, so adding a bot is a
    // one-line change here instead of a puzzle about which number is stale.
    expect(html.match(/role="radio"/g)).toHaveLength(BOT_PERSONAS.length);
    expect(html).toContain('Gentle · Balanced');
    expect(html).not.toContain('A patient beginner.');
    expect(html).not.toContain('>Reading</span>');
  });

  it('expands only the selected bot with its decision-making detail', () => {
    const html = renderToStaticMarkup(<BotPersonaPicker selectedId="pebble" onSelect={() => undefined} />);

    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('A patient beginner.');
    expect(html).toContain('>Reading</span>');
    expect(html).not.toContain('Solid single-digit kyu.');
  });

  it('lists the bots weakest first, whatever order they are declared in', () => {
    const html = renderToStaticMarkup(<BotPersonaPicker selectedId={null} onSelect={() => undefined} />);
    const shown = [...html.matchAll(/font-mono[^>]*>([^<]+)</g)].map((match) => match[1]!.trim());
    const expected = [...BOT_PERSONAS]
      .sort((a, b) => b.rankKyu - a.rankKyu)
      .map((persona) => formatKyuRank(persona.rankKyu));

    expect(shown).toEqual(expected);
    // Declaration order ran 15k, 7k, 1d, 9d, so the strongest bot in the app
    // sat fourth. Someone picking an opponent scans for a rank near their own.
  });

  it('does not invent a rank below the calibration', () => {
    const ranks = BOT_PERSONAS.map((persona) => persona.rankKyu);
    // 18k is the weakest rank CALIBRATED_RANK_ELO names; anything below it
    // would be a calibration this app does not have.
    const aiStrength = readFileSync('src/utils/aiStrength.ts', 'utf8');
    const weakest = Number(/CALIBRATED_RANK_ELO[\s\S]*?=\s*\[\[[^,]+,\s*(\d+)\]/.exec(aiStrength)?.[1]);
    // Assert the reading itself: a regex that stops matching would otherwise
    // turn this into `<= NaN` and take the whole check down with it.
    expect(Number.isFinite(weakest), 'could not read the weakest calibrated rank').toBe(true);
    expect(Math.max(...ranks)).toBeLessThanOrEqual(weakest);
  });
});
