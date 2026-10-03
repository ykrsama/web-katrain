import { describe, expect, it } from 'vitest';
import {
  extractSpokenNumbers,
  formatBlindfoldCoordinate,
  parseBlindfoldCoordinate,
  toChineseNumeral,
} from '../src/utils/blindfoldCoordinates';
import { blindfoldExample } from '../src/utils/blindfold';

describe('blindfold numerals', () => {
  it('writes 1..19 the way a Chinese speaker reads them', () => {
    expect(toChineseNumeral(1)).toBe('一');
    expect(toChineseNumeral(9)).toBe('九');
    expect(toChineseNumeral(10)).toBe('十');
    expect(toChineseNumeral(11)).toBe('十一');
    expect(toChineseNumeral(16)).toBe('十六');
    expect(toChineseNumeral(19)).toBe('十九');
  });

  it('reads numbers back out of whatever the recogniser wrote', () => {
    expect(extractSpokenNumbers('4之16')).toEqual([4, 16]);
    expect(extractSpokenNumbers('四之十六')).toEqual([4, 16]);
    expect(extractSpokenNumbers('4之十六')).toEqual([4, 16]);
    expect(extractSpokenNumbers('第4行第16列')).toEqual([4, 16]);
    expect(extractSpokenNumbers('十六')).toEqual([16]);
    expect(extractSpokenNumbers('十九 之 十九')).toEqual([19, 19]);
    expect(extractSpokenNumbers('四至十六')).toEqual([4, 16]);
    // 幺 is how "1" is read out loud, but two single-digit numerals in a row are
    // ambiguous ("一六" is either 16 or 1 then 6), so the mode asks again
    // instead of guessing.
    expect(extractSpokenNumbers('幺')).toEqual([1]);
    expect(extractSpokenNumbers('幺六')).toEqual([]);
    // Junk that is not two numbers stays out of range rather than guessing.
    expect(extractSpokenNumbers('四十六')).toEqual([46]);
    expect(extractSpokenNumbers('听不清楚')).toEqual([]);
  });
});

describe('blindfold coordinates', () => {
  // (x=16, y=3) on 19x19: 17th column from the left, 16th row from the bottom.
  it('formats the x-y mode as column-then-row from the bottom', () => {
    expect(formatBlindfoldCoordinate(16, 3, 19, 'xy')).toBe('十七之十六');
    expect(formatBlindfoldCoordinate(0, 18, 19, 'xy')).toBe('一之一');
    expect(formatBlindfoldCoordinate(18, 0, 19, 'xy')).toBe('十九之十九');
  });

  it('formats the row-column mode as row from the top, column from the left', () => {
    expect(formatBlindfoldCoordinate(3, 2, 19, 'rowcol')).toBe('三之四');
    // One point, two spellings: this is the x-y example's stone seen with the
    // row first.
    expect(formatBlindfoldCoordinate(16, 3, 19, 'rowcol')).toBe('四之十七');
    expect(formatBlindfoldCoordinate(0, 0, 19, 'rowcol')).toBe('一之一');
    expect(formatBlindfoldCoordinate(18, 18, 19, 'rowcol')).toBe('十九之十九');
  });

  it('parses each mode back into the same point', () => {
    for (const [x, y] of [[3, 2], [0, 0], [18, 18], [8, 15], [15, 3]] as const) {
      for (const mode of ['xy', 'rowcol'] as const) {
        const spoken = formatBlindfoldCoordinate(x, y, 19, mode);
        expect(parseBlindfoldCoordinate(spoken, 19, mode)).toEqual({ x, y });
      }
    }
  });

  it('accepts digits, mixed numerals and loose separators', () => {
    expect(parseBlindfoldCoordinate('4之17', 19, 'xy')).toEqual({ x: 3, y: 2 });
    expect(parseBlindfoldCoordinate('十七之十六', 19, 'xy')).toEqual({ x: 16, y: 3 });
    expect(parseBlindfoldCoordinate('4 17', 19, 'xy')).toEqual({ x: 3, y: 2 });
    expect(parseBlindfoldCoordinate('第4之第17', 19, 'xy')).toEqual({ x: 3, y: 2 });
    expect(parseBlindfoldCoordinate('3之4', 19, 'rowcol')).toEqual({ x: 3, y: 2 });
    expect(parseBlindfoldCoordinate('第3行第4列', 19, 'rowcol')).toEqual({ x: 3, y: 2 });
  });

  it('refuses anything that is not exactly two in-range numbers', () => {
    expect(parseBlindfoldCoordinate('听不清楚', 19, 'xy')).toBeNull();
    expect(parseBlindfoldCoordinate('十七之十六之三', 19, 'xy')).toBeNull();
    expect(parseBlindfoldCoordinate('二十之三', 19, 'xy')).toBeNull();
    expect(parseBlindfoldCoordinate('零之三', 19, 'xy')).toBeNull();
    expect(parseBlindfoldCoordinate('十九之二十', 19, 'xy')).toBeNull();
    expect(parseBlindfoldCoordinate('', 19, 'xy')).toBeNull();
  });

  it('maps a 9x9 board with the same conventions', () => {
    expect(formatBlindfoldCoordinate(0, 0, 9, 'xy')).toBe('一之九');
    expect(parseBlindfoldCoordinate('一之九', 9, 'xy')).toEqual({ x: 0, y: 0 });
    expect(parseBlindfoldCoordinate('九之一', 9, 'xy')).toEqual({ x: 8, y: 8 });
    expect(parseBlindfoldCoordinate('一之九', 9, 'rowcol')).toEqual({ x: 8, y: 0 });
  });
});

describe('the blindfold example', () => {
  it('names the upper-right 3-4 point, spelled the way each mode reads it', () => {
    // 围棋礼仪 puts the first stone in the player's own upper-right corner, the
    // one nearest the opponent: 17th column from the left, 16th row from the
    // bottom, which is the 4th row from the top when the row comes first.
    expect(blindfoldExample(19, 'xy')).toBe('十七之十六');
    expect(blindfoldExample(19, 'rowcol')).toBe('四之十七');
  });

  it('stays inside smaller boards', () => {
    expect(blindfoldExample(9, 'xy')).toBe('七之六');
    expect(blindfoldExample(9, 'rowcol')).toBe('四之七');
  });
});
