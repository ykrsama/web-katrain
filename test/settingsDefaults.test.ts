import { describe, expect, it } from 'vitest';
import { DEFAULT_KATAGO_VISITS, normalizeStoredSettings, useGameStore } from '../src/store/gameStore';

describe('settings defaults', () => {
  it('uses the configured full-strength KataGo visit default', () => {
    expect(useGameStore.getState().settings.katagoVisits).toBe(DEFAULT_KATAGO_VISITS);
  });

});

describe('the old 500-visit default', () => {
  it('is read as the old default in settings saved before revisions', () => {
    expect(normalizeStoredSettings({ katagoVisits: 500 }, null)?.katagoVisits).toBe(DEFAULT_KATAGO_VISITS);
  });

  it('is kept when chosen and saved since', () => {
    const settings = normalizeStoredSettings({ katagoVisits: 500, settingsRevision: 1 }, null);
    expect(settings?.katagoVisits).toBe(500);
    expect(settings && 'settingsRevision' in settings).toBe(false);
  });

  it('drops stored values of the wrong type instead of crashing the UI on them', () => {
    const settings = normalizeStoredSettings({
      humanSlProfile: null,
      humanSlBotStyle: 7,
      aiStrategy: 'nope',
      analysisPolicySource: 3,
      teachNumUndoPrompts: 'abc',
      showCoordinates: 'yes',
      katagoVisits: 800,
    }, null);
    expect(settings).toEqual({ katagoVisits: 800 });
  });
});
