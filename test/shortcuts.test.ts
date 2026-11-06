import { afterEach, describe, expect, it } from 'vitest';
import {
  bindingToDisplay,
  createShortcutCollisionReplacement,
  eventMatchesBinding,
  eventToShortcutBinding,
  filterShortcutGroups,
  filterShortcutGroupsByStatus,
  findShortcutCollision,
  getShortcutBindings,
  getShortcutGroups,
  isNativePasteShortcutEvent,
  isShortcutRecordingCancelKey,
  loadShortcutOverrides,
  saveShortcutOverrides,
  setShortcutOverride,
  SHORTCUT_DEFINITIONS,
  shortcutDisplay,
  type ShortcutBinding,
} from '../src/utils/shortcuts';

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function restoreLocalStorage() {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

function installMemoryStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    } satisfies Storage,
  });
}

afterEach(() => {
  restoreLocalStorage();
});

const keyboardEvent = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  ({
    key,
    ctrlKey: !!init.ctrlKey,
    metaKey: !!init.metaKey,
    shiftKey: !!init.shiftKey,
    altKey: !!init.altKey,
  }) as KeyboardEvent;

describe('shortcut utilities', () => {
  it('formats shortcut bindings for help and settings', () => {
    expect(bindingToDisplay({ key: 's', ctrl: true })).toBe('Ctrl+S');
    expect(bindingToDisplay({ key: 'ArrowLeft', shift: true })).toBe('Shift+←');
    expect(bindingToDisplay({ key: 'Escape' })).toBe('Esc');
    expect(bindingToDisplay({ key: '/', shift: true })).toBe('?');
    expect(bindingToDisplay({ key: '?', shift: true })).toBe('?');
    expect(bindingToDisplay({ key: 'f11' })).toBe('F11');
    expect(shortcutDisplay([{ key: 'ArrowLeft' }, { key: 'z' }])).toBe('← / Z');
    expect(shortcutDisplay(null)).toBe('Disabled');
  });

  it('matches browser key events with normalized bindings', () => {
    expect(eventMatchesBinding(keyboardEvent('S', { metaKey: true }), { key: 's', ctrl: true })).toBe(true);
    expect(eventMatchesBinding(keyboardEvent(' ', {}), { key: 'Space' })).toBe(true);
    expect(eventMatchesBinding(keyboardEvent('?', { shiftKey: true }), { key: '?' })).toBe(true);
    expect(eventMatchesBinding(keyboardEvent('?', { shiftKey: true }), { key: '/', shift: true })).toBe(true);
    expect(eventMatchesBinding(keyboardEvent('F11'), { key: 'f11' })).toBe(true);
    expect(eventMatchesBinding(keyboardEvent('s'), { key: 's', ctrl: true })).toBe(false);
  });

  it('records shifted punctuation as the visible shortcut key', () => {
    expect(eventToShortcutBinding(keyboardEvent('?', { shiftKey: true }))).toEqual({
      key: '?',
      ctrl: false,
      shift: false,
      alt: false,
    });
    expect(eventToShortcutBinding(keyboardEvent('A', { shiftKey: true }))).toEqual({
      key: 'a',
      ctrl: false,
      shift: true,
      alt: false,
    });
  });

  it('detects shortcut collisions against active overrides', () => {
    const binding: ShortcutBinding = { key: 's', ctrl: true };
    const collision = findShortcutCollision(binding, 'open-sgf', { 'save-sgf': [binding] });
    expect(collision?.id).toBe('save-sgf');
  });

  it('keeps default shortcuts collision-free', () => {
    const seen = new Map<string, string>();
    const signature = (binding: ShortcutBinding) =>
      `${binding.ctrl ? 'C' : '-'}${binding.shift ? 'S' : '-'}${binding.alt ? 'A' : '-'}:${binding.key.length === 1 ? binding.key.toLowerCase() : binding.key}`;

    for (const shortcut of SHORTCUT_DEFINITIONS) {
      for (const binding of shortcut.defaultBindings) {
        const key = signature(binding);
        expect(seen.get(key), `${shortcut.id} conflicts with ${seen.get(key)} on ${key}`).toBeUndefined();
        seen.set(key, shortcut.id);
      }
    }
  });

  it('supports disabled and overridden bindings', () => {
    expect(getShortcutBindings('save-sgf', { 'save-sgf': null })).toBe(null);
    expect(getShortcutBindings('save-sgf', { 'save-sgf': [{ key: 'F9' }] })).toEqual([{ key: 'F9', ctrl: false, shift: false, alt: false }]);
    expect(getShortcutBindings('fullscreen', { fullscreen: [{ key: 'f11' }] })).toEqual([{ key: 'F11', ctrl: false, shift: false, alt: false }]);
  });

  it('matches the configured keyboard help binding', () => {
    for (const binding of getShortcutBindings('keyboard-help', {}) ?? []) {
      expect(eventMatchesBinding(keyboardEvent(binding.key, {
        ctrlKey: binding.ctrl, shiftKey: binding.shift, altKey: binding.alt,
      }), binding)).toBe(true);
    }
  });

  it('treats Escape as a shortcut recording cancel key', () => {
    expect(isShortcutRecordingCancelKey(keyboardEvent('Escape'))).toBe(true);
    expect(isShortcutRecordingCancelKey(keyboardEvent('Esc'))).toBe(true);
    expect(isShortcutRecordingCancelKey(keyboardEvent('s', { ctrlKey: true }))).toBe(false);
  });

  it('recognizes native paste chords so clipboard images can reach paste events', () => {
    expect(isNativePasteShortcutEvent(keyboardEvent('v', { ctrlKey: true }))).toBe(true);
    expect(isNativePasteShortcutEvent(keyboardEvent('V', { metaKey: true }))).toBe(true);
    expect(isNativePasteShortcutEvent(keyboardEvent('v', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isNativePasteShortcutEvent(keyboardEvent('p', { ctrlKey: true }))).toBe(false);
  });

  it('builds replacement overrides when resolving a shortcut collision', () => {
    const next = createShortcutCollisionReplacement(
      { 'save-sgf': [{ key: 's', ctrl: true }] },
      'open-sgf',
      'save-sgf',
      { key: 's', ctrl: true }
    );

    expect(getShortcutBindings('open-sgf', next)).toEqual([{ key: 's', ctrl: true, shift: false, alt: false }]);
    expect(getShortcutBindings('save-sgf', next)).toBe(null);
  });

  it('does not persist shortcut overrides that match command defaults', () => {
    installMemoryStorage();

    const defaults = getShortcutBindings('save-sgf', {});
    setShortcutOverride('save-sgf', defaults);

    expect(loadShortcutOverrides()).toEqual({});
    expect(getShortcutBindings('save-sgf')).toEqual(defaults);
  });

  it('canonicalizes shortcut overrides before saving', () => {
    installMemoryStorage();

    saveShortcutOverrides({
      'save-sgf': [{ key: 'F9' }, { key: 'f9' }],
      'open-sgf': [],
      fullscreen: getShortcutBindings('fullscreen', {}),
      'toggle-sound': null,
    });

    expect(loadShortcutOverrides()).toEqual({
      'save-sgf': [{ key: 'F9', ctrl: false, shift: false, alt: false }],
      'toggle-sound': null,
    });
  });

  it('clears a collision without persisting no-op default overrides', () => {
    const defaults = getShortcutBindings('save-sgf', {})!;
    const binding = defaults[0]!;
    const next = createShortcutCollisionReplacement(
      {
        'save-sgf': null,
        'open-sgf': [binding],
      },
      'save-sgf',
      'open-sgf',
      binding
    );

    expect(Object.prototype.hasOwnProperty.call(next, 'save-sgf')).toBe(false);
    expect(getShortcutBindings('save-sgf', next)).toEqual(defaults);
    expect(getShortcutBindings('open-sgf', next)).toBe(null);
  });

  it('preserves non-conflicting bindings when replacing one binding from a multi-binding shortcut', () => {
    const next = createShortcutCollisionReplacement(
      { 'settings-modal': [{ key: ',', ctrl: true }, { key: 'F8' }] },
      'open-sgf',
      'settings-modal',
      { key: ',', ctrl: true }
    );

    expect(getShortcutBindings('open-sgf', next)).toEqual([{ key: ',', ctrl: true, shift: false, alt: false }]);
    expect(getShortcutBindings('settings-modal', next)).toEqual([{ key: 'F8', ctrl: false, shift: false, alt: false }]);
  });

  it('filters shortcut groups by label, category, command id, and binding display', () => {
    const groups = getShortcutGroups({
      'save-sgf': [{ key: 's', ctrl: true }],
      'edit-undo': [{ key: 'z', ctrl: true }],
    });
    const flatten = (query: string) => filterShortcutGroups(groups, query).flatMap((group) => group.shortcuts);

    expect(filterShortcutGroups(groups, '   ')).toBe(groups);
    expect(flatten('policy').map((shortcut) => shortcut.id)).toEqual(expect.arrayContaining([
      'toggle-policy',
      'cycle-policy-metric',
    ]));
    expect(flatten('make-main-branch').map((shortcut) => shortcut.label)).toEqual(['Make current branch main']);
    expect(flatten('ctrl+s').map((shortcut) => shortcut.label)).toEqual(['Save SGF']);
    expect(flatten('ctrl+z').map((shortcut) => shortcut.label)).toEqual(['Undo edit']);
    expect(filterShortcutGroups(groups, 'visualization').map((group) => group.title)).toEqual(['Visualization']);
  });

  it('returns no shortcut groups when a shortcut search has no matches', () => {
    expect(filterShortcutGroups(getShortcutGroups({}), 'zzzz-no-match')).toEqual([]);
  });

  it('filters shortcut groups by edited or disabled status', () => {
    const overrides = {
      'save-sgf': [{ key: 'F9' }],
      'open-sgf': null,
    };
    const groups = getShortcutGroups(overrides);
    const edited = filterShortcutGroupsByStatus(groups, 'custom', overrides).flatMap((group) => group.shortcuts);
    const disabled = filterShortcutGroupsByStatus(groups, 'disabled', overrides).flatMap((group) => group.shortcuts);

    expect(filterShortcutGroupsByStatus(groups, 'all', overrides)).toBe(groups);
    expect(edited.map((shortcut) => shortcut.id)).toEqual(['save-sgf', 'open-sgf']);
    expect(disabled.map((shortcut) => shortcut.id)).toEqual(['open-sgf']);
  });
});
