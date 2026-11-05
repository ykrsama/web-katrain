import { describe, expect, it } from 'vitest';
import { sgfHeaderText } from '../src/utils/sgfScan';
import { filterProGames, PRO_GAMES } from '../src/utils/proGames';

describe('pro game headers', () => {
  it('reads the result and ranks that follow another value directly', () => {
    // "KM[6.5]RE[B+R]": requiring a ";" or space before the key missed RE,
    // BR and WR in all seven bundled games.
    expect(PRO_GAMES.length).toBeGreaterThan(0);
    for (const game of PRO_GAMES) {
      const header = sgfHeaderText(game.sgf);
      for (const [property, value] of [['RE', game.result], ['BR', game.blackRank], ['WR', game.whiteRank]] as const) {
        if (new RegExp(`(?<![A-Za-z])${property}\\[`).test(header)) expect(value, game.name + property).toBeTruthy();
        else expect(value).toBeUndefined();
      }
    }
  });

  it('finds games by result', () => {
    expect(filterProGames(PRO_GAMES, 'B+R').length).toBeGreaterThan(0);
  });
});
