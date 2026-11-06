import { afterEach, describe, expect, it } from 'vitest';
import {
  getNextSettingsTabId,
  isSettingsTabId,
  readSettingsActiveTab,
  saveSettingsActiveTab,
  SETTINGS_ACTIVE_TAB_STORAGE_KEY,
  SETTINGS_TAB_IDS,
} from '../src/utils/settingsTabs';

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

describe('settings tab storage', () => {
  it('validates known settings tabs', () => {
    for (const tab of SETTINGS_TAB_IDS) expect(isSettingsTabId(tab)).toBe(true);
    expect(isSettingsTabId('__unknown-tab__')).toBe(false);
    expect(isSettingsTabId(null)).toBe(false);
  });

  it('wraps keyboard navigation through settings tabs', () => {
    SETTINGS_TAB_IDS.forEach((tab, index, tabs) => {
      expect(getNextSettingsTabId(tab, 'ArrowRight')).toBe(tabs[(index + 1) % tabs.length]);
      expect(getNextSettingsTabId(tab, 'ArrowLeft')).toBe(tabs[(index - 1 + tabs.length) % tabs.length]);
      expect(getNextSettingsTabId(tab, 'Home')).toBe(tabs[0]);
      expect(getNextSettingsTabId(tab, 'End')).toBe(tabs.at(-1));
      expect(getNextSettingsTabId(tab, 'Tab')).toBeNull();
    });
  });

  it('persists the requested settings tab through safe storage', () => {
    installMemoryStorage();

    const tab = SETTINGS_TAB_IDS.at(-1)!;
    saveSettingsActiveTab(tab);

    expect(localStorage.getItem(SETTINGS_ACTIVE_TAB_STORAGE_KEY)).toBe(tab);
    expect(readSettingsActiveTab()).toBe(tab);
  });

  it('falls back when storage contains an unknown tab', () => {
    installMemoryStorage();
    localStorage.setItem(SETTINGS_ACTIVE_TAB_STORAGE_KEY, '__unknown-tab__');

    const fallback = SETTINGS_TAB_IDS[0];
    expect(readSettingsActiveTab(fallback)).toBe(fallback);
  });
});
