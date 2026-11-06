import { describe, expect, it } from 'vitest';
import { TEXT_SELECTION_MODIFIER, textEditingCommands } from '../scripts/lib/browser.mjs';

describe('native text editing in the CI browser harness', () => {
  it('uses Chromium editing actions for select-all and backspace', () => {
    expect(textEditingCommands('keyDown', 'a', TEXT_SELECTION_MODIFIER)).toEqual(['selectAll']);
    expect(textEditingCommands('keyDown', 'Backspace', 0)).toEqual(['deleteBackward']);
  });

  it('does not repeat editing on key release or override application shortcuts', () => {
    expect(textEditingCommands('keyUp', 'a', TEXT_SELECTION_MODIFIER)).toEqual([]);
    expect(textEditingCommands('keyUp', 'Backspace', 0)).toEqual([]);
    expect(textEditingCommands('keyDown', 'ArrowRight', 0)).toEqual([]);
    expect(textEditingCommands('keyDown', 'k', 2)).toEqual([]);
    expect(textEditingCommands('keyDown', 'Backspace', 2)).toEqual([]);
  });
});
