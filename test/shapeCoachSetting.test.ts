import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SETTINGS_SEARCH_INDEX } from '../src/utils/settingsSearch';
import { defaultUiState } from '../src/components/layout/types';

const read = (path: string) => readFileSync(path, 'utf8');

describe('shape coach display setting', () => {
  it('is offered in Settings > Analysis > Analysis Detail, bound to its checkbox', () => {
    const modal = read('src/components/SettingsModal.tsx');

    // The modal mounts only the active tab, so the control's markup is the
    // contract: a label paired with the checkbox it names.
    expect(modal).toContain('htmlFor="settings-analysis-show-shape-coach"');
    expect(modal).toContain('id="settings-analysis-show-shape-coach"');
    expect(modal).toContain('checked={settings.showShapeCoach}');
    expect(modal).toContain('updateSettings({ showShapeCoach: e.target.checked })');
    expect(modal).toContain("t('Analysis Detail')");
  });

  it('defaults to off and is discoverable from the settings search', () => {
    expect(read('src/store/gameStore.ts')).toContain('showShapeCoach: false');
    expect(read('src/types.ts')).toContain('showShapeCoach: boolean');

    const entry = SETTINGS_SEARCH_INDEX.find((item) => item.id === 'settings-analysis-show-shape-coach');
    expect(entry?.tab).toBe('analysis');
    expect(entry?.label).toBe('Shape Coach');
  });

  it('drives the comment-panel coach on desktop and mobile from the same setting', () => {
    const layout = read('src/components/Layout.tsx');

    // One derived flag feeds RightPanel, which both the desktop rail and the
    // mobile panel render; the star button writes the persisted setting back.
    expect(layout).toContain('const shapeCoachEnabled = settings.showShapeCoach;');
    expect(layout).toContain('updateSettings({ showShapeCoach: !settings.showShapeCoach })');
    expect(layout).toContain('shapeCoachEnabled={shapeCoachEnabled}');
  });

  it('no longer lives in the transient UI layout state', () => {
    expect('shapeCoachEnabled' in defaultUiState()).toBe(false);
  });
});
