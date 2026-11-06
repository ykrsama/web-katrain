import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_MAX_VISITS } from '../src/engine/katago/limits';
import {
  ANALYSIS_MIN_VISITS,
  ANALYSIS_VISIT_PRESETS,
  ANALYSIS_VISIT_SLIDER_MAX,
  ANALYSIS_VISIT_SLIDER_MIN,
  clampAnalysisVisits,
  formatVisitCount,
  mergeVisitPresets,
  nextVisitPreset,
  sliderValueToVisitCount,
  snapVisitCount,
  visitCountToSliderValue,
  visitPresetDescription,
  visitPresetLabel,
  visitSliderFillPercent,
} from '../src/utils/visitPresets';

describe('visit preset utilities', () => {
  it('clamps analysis visits to the browser engine range', () => {
    expect(clampAnalysisVisits(1)).toBe(ANALYSIS_MIN_VISITS);
    expect(clampAnalysisVisits(ENGINE_MAX_VISITS + 1)).toBe(ENGINE_MAX_VISITS);
    expect(clampAnalysisVisits(999999)).toBe(Math.min(999999, ENGINE_MAX_VISITS));
    expect(clampAnalysisVisits(250.9)).toBe(250);
  });

  it('merges the current custom value into sorted presets', () => {
    const presets = [500, 1000, 5000];
    expect(mergeVisitPresets(presets, 750)).toEqual([500, 750, 1000, 5000]);
    expect(mergeVisitPresets(presets, 1000)).toEqual(presets);
  });

  it('labels default and depth bands', () => {
    expect(visitPresetLabel(5000, 5000)).toBe('Default');
    expect(ANALYSIS_VISIT_PRESETS.map(visits => visitPresetLabel(visits)))
      .toEqual(['Fast', 'Balanced', 'Deep', 'Thorough']);
  });

  it('describes preset depth tradeoffs for the live selector', () => {
    expect(visitPresetDescription(ANALYSIS_VISIT_PRESETS[0])).toMatch(/minimal waiting/i);
    expect(visitPresetDescription(ANALYSIS_VISIT_PRESETS[1])).toMatch(/steady feedback/i);
    expect(visitPresetDescription(ANALYSIS_VISIT_PRESETS[2])).toMatch(/deeper reading/i);
    expect(visitPresetDescription(ANALYSIS_VISIT_PRESETS[3])).toMatch(/slower/i);
  });

  it('cycles to the next merged live preset', () => {
    const presets = [500, 1000, 5000];
    expect(nextVisitPreset(500, presets)).toBe(1000);
    expect(nextVisitPreset(750, presets)).toBe(1000);
    expect(nextVisitPreset(5000, presets)).toBe(500);
    expect(nextVisitPreset(ENGINE_MAX_VISITS, [16, 250, 1000, 5000, ENGINE_MAX_VISITS])).toBe(16);
  });

  it('formats visit counts for compact controls', () => {
    expect(formatVisitCount(250)).toBe('250');
    expect(formatVisitCount(1000)).toBe('1k');
    expect(formatVisitCount(2500)).toBe('2.5k');
    expect(formatVisitCount(5000)).toBe('5k');
    expect(formatVisitCount(50000)).toBe('50k');
    expect(formatVisitCount(ENGINE_MAX_VISITS)).toBe(`${Math.round(ENGINE_MAX_VISITS / 1000)}k`);
  });

  it('maps visit counts to a log slider with readable snapping', () => {
    expect(snapVisitCount(236)).toBe(240);
    expect(snapVisitCount(1260)).toBe(1300);
    expect(sliderValueToVisitCount(visitCountToSliderValue(250))).toBe(250);
    expect(sliderValueToVisitCount(Number.NaN)).toBe(ANALYSIS_MIN_VISITS);
    expect(sliderValueToVisitCount(ANALYSIS_VISIT_SLIDER_MIN - 1)).toBe(ANALYSIS_MIN_VISITS);
    expect(sliderValueToVisitCount(ANALYSIS_VISIT_SLIDER_MAX + 1)).toBe(ENGINE_MAX_VISITS);
    expect(visitSliderFillPercent(ANALYSIS_MIN_VISITS)).toBeCloseTo(0);
    expect(visitSliderFillPercent(ENGINE_MAX_VISITS)).toBeCloseTo(100);
  });
});

describe('the store clamps visits in one place', () => {
  const store = readFileSync('src/store/gameStore.ts', 'utf8');

  /**
   * `Math.max(16, Math.min(x, ENGINE_MAX_VISITS))` was written out by hand
   * fourteen times in the store, and the copy driving live analysis had lost
   * its `Math.min`.
   *
   * That one mattered: `runAnalysis` caps what it will request at
   * ENGINE_MAX_VISITS, so the achieved visit count can never pass 50,000. With
   * an unbounded target -- reachable by typing a larger number into Settings,
   * whose `max` attribute only governs the spinner -- `normalizedVisits <
   * target` stayed true forever, the "settled" branch was unreachable, and the
   * loop re-ran a full search every 50ms for as long as the tab stayed open.
   */
  it('escalates live analysis toward a bounded target', () => {
    const target = /const target = ([^;]+);/.exec(
      store.slice(store.indexOf('const token = ++continuousToken;'))
    )?.[1];
    expect(target, 'the live-analysis target moved').toBeDefined();
    expect(target).toContain('clampAnalysisVisits');
  });

  it('leaves no hand-rolled copy of the clamp to drift again', () => {
    expect(store).not.toMatch(/Math\.max\(16, Math\.min\([^;]*ENGINE_MAX_VISITS\)\)/);
    // Any remaining lower bound must be against an already-bounded value, not
    // against a raw setting.
    expect(store).not.toMatch(/Math\.max\(16, [^)]*settings\.katago\w*Visits\)/);
  });

  it('is reachable: the settled branch needs target <= what runAnalysis grants', () => {
    // The two halves of the invariant, asserted against the real helper rather
    // than against the spelling of either site.
    expect(clampAnalysisVisits(999_999)).toBe(ENGINE_MAX_VISITS);
    expect(clampAnalysisVisits(ENGINE_MAX_VISITS + 1)).toBeLessThanOrEqual(ENGINE_MAX_VISITS);
    // And the other half: what runAnalysis actually grants is bounded too, so
    // the achieved count can reach the target. Asserted by what the line does,
    // not how it is spelled -- pinning the old `Math.min(...)` text broke the
    // moment the clamp was consolidated.
    const desired = /const desiredVisits = ([^;]+);/.exec(store)?.[1];
    expect(desired, 'runAnalysis no longer computes desiredVisits').toBeDefined();
    expect(desired).toContain('clampAnalysisVisits');
  });
});
