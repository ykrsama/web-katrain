/**
 * Blindfold (盲棋) coordinate speech.
 *
 * Both announcement modes speak two numbers joined by "之":
 *  - 'xy'     : the column counted from the left, then the row counted from the
 *               bottom — the numbers a Go board prints.
 *  - 'rowcol' : the row counted from the top, then the column counted from the
 *               left.
 *
 * The player answers in the same shape, so the parser is deliberately loose
 * about how the recogniser wrote it down: Arabic digits, Chinese numerals,
 * "之"/"至"/"到"/"-"/spaces, and "第…行第…列" phrasing all work. Anything it
 * cannot turn into exactly two in-range numbers is a miss, and the mode asks
 * again.
 */

export type BlindfoldAnnounceMode = 'xy' | 'rowcol';

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 1 -> 一, 10 -> 十, 11 -> 十一, 19 -> 十九 (19x19 is all we need, larger works too). */
export const toChineseNumeral = (value: number): string => {
  const n = Math.floor(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 10) return CN_DIGITS[n]!;
  if (n === 10) return '十';
  if (n < 20) return `十${CN_DIGITS[n - 10]!}`;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${CN_DIGITS[tens]!}十${ones === 0 ? '' : CN_DIGITS[ones]!}`;
};

/** The two numbers that name `x,y` (0-based) in the chosen mode, both 1-based. */
export const blindfoldNumbersFor = (
  x: number,
  y: number,
  boardSize: number,
  mode: BlindfoldAnnounceMode
): { first: number; second: number } =>
  mode === 'xy'
    ? { first: x + 1, second: boardSize - y }
    : { first: y + 1, second: x + 1 };

/** What the app says out loud for a move, e.g. "四之十六". */
export const formatBlindfoldCoordinate = (
  x: number,
  y: number,
  boardSize: number,
  mode: BlindfoldAnnounceMode
): string => {
  const { first, second } = blindfoldNumbersFor(x, y, boardSize, mode);
  return `${toChineseNumeral(first)}之${toChineseNumeral(second)}`;
};

const CN_NUMERAL_CHARS = new Set([...CN_DIGITS, '十', '两', '幺']);

const FULL_WIDTH_DIGIT_OFFSET = '０'.charCodeAt(0) - '0'.charCodeAt(0);

/** Best-effort value of a run of Chinese numeral characters ("十六" -> 16). */
const chineseRunToNumber = (run: string): number | null => {
  if (run.length === 0) return null;
  const normalized = run.replace(/零/g, '').replace(/两/g, '二').replace(/幺/g, '一');
  if (normalized.length === 0) return null;
  const tenIndex = normalized.indexOf('十');
  if (tenIndex === -1) {
    // Every character must be a digit, so "一二" is not a number we accept.
    if (normalized.length !== 1) return null;
    const digit = CN_DIGITS.indexOf(normalized);
    return digit > 0 ? digit : null;
  }
  const head = normalized.slice(0, tenIndex);
  const tail = normalized.slice(tenIndex + 1);
  const tens = head.length === 0 ? 1 : CN_DIGITS.indexOf(head);
  const ones = tail.length === 0 ? 0 : CN_DIGITS.indexOf(tail);
  if (tens <= 0 || ones < 0) return null;
  return tens * 10 + ones;
};

/**
 * Every number the recogniser's text contains, in the order it said them.
 * Arabic digits and Chinese numerals can be mixed ("4之十六").
 */
export const extractSpokenNumbers = (text: string): number[] => {
  const numbers: number[] = [];
  let digits = '';
  let chinese = '';

  const flushDigits = () => {
    if (digits.length === 0) return;
    const parsed = Number.parseInt(digits, 10);
    if (Number.isFinite(parsed)) numbers.push(parsed);
    digits = '';
  };
  const flushChinese = () => {
    if (chinese.length === 0) return;
    const parsed = chineseRunToNumber(chinese);
    if (parsed !== null && parsed > 0) numbers.push(parsed);
    chinese = '';
  };

  for (const rawChar of text) {
    const code = rawChar.charCodeAt(0);
    const char = code >= 0xff10 && code <= 0xff19 ? String.fromCharCode(code - FULL_WIDTH_DIGIT_OFFSET) : rawChar;
    if (char >= '0' && char <= '9') {
      flushChinese();
      digits += char;
      continue;
    }
    if (CN_NUMERAL_CHARS.has(char)) {
      flushDigits();
      chinese += char;
      continue;
    }
    flushDigits();
    flushChinese();
  }
  flushDigits();
  flushChinese();
  return numbers;
};

/**
 * Turn what the player said into a board point, or null when it is not exactly
 * two in-range numbers. The mode decides which number is which, so the player
 * answers in the shape they just heard.
 */
export const parseBlindfoldCoordinate = (
  text: string,
  boardSize: number,
  mode: BlindfoldAnnounceMode
): { x: number; y: number } | null => {
  const numbers = extractSpokenNumbers(text);
  if (numbers.length !== 2) return null;
  const [first, second] = numbers as [number, number];
  if (first < 1 || first > boardSize || second < 1 || second > boardSize) return null;

  const point =
    mode === 'xy'
      ? { x: first - 1, y: boardSize - second }
      : { x: second - 1, y: first - 1 };

  if (point.x < 0 || point.y < 0 || point.x >= boardSize || point.y >= boardSize) return null;
  return point;
};
