import { describe, expect, it } from 'vitest';
import { ENGINE_MAX_VISITS } from '../src/engine/katago/limits';
import {
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
    expect(clampAnalysisVisits(1)).toBe(16);
    expect(clampAnalysisVisits(ENGINE_MAX_VISITS + 1)).toBe(ENGINE_MAX_VISITS);
    expect(clampAnalysisVisits(999999)).toBe(Math.min(999999, ENGINE_MAX_VISITS));
    expect(clampAnalysisVisits(250.9)).toBe(250);
  });

  it('merges the current custom value into sorted presets', () => {
    expect(mergeVisitPresets(ANALYSIS_VISIT_PRESETS, 750)).toEqual([500, 750, 5000, 50000, 500000]);
    expect(mergeVisitPresets(ANALYSIS_VISIT_PRESETS, 5000)).toEqual([500, 5000, 50000, 500000]);
  });

  it('labels default and depth bands', () => {
    expect(visitPresetLabel(5000, 5000)).toBe('Default');
    expect(visitPresetLabel(16, 5000)).toBe('Fast');
    expect(visitPresetLabel(500)).toBe('Fast');
    expect(visitPresetLabel(5000)).toBe('Balanced');
    expect(visitPresetLabel(50000)).toBe('Deep');
    expect(visitPresetLabel(500000)).toBe('Thorough');
  });

  it('describes preset depth tradeoffs for the live selector', () => {
    expect(visitPresetDescription(500)).toMatch(/minimal waiting/i);
    expect(visitPresetDescription(5000)).toMatch(/steady feedback/i);
    expect(visitPresetDescription(50000)).toMatch(/deeper reading/i);
    expect(visitPresetDescription(500000)).toMatch(/slower/i);
  });

  it('cycles to the next merged live preset', () => {
    expect(nextVisitPreset(500)).toBe(5000);
    expect(nextVisitPreset(750)).toBe(5000);
    expect(nextVisitPreset(500000)).toBe(500);
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
    expect(sliderValueToVisitCount(Number.NaN)).toBe(16);
    expect(sliderValueToVisitCount(ANALYSIS_VISIT_SLIDER_MIN - 1)).toBe(16);
    expect(sliderValueToVisitCount(ANALYSIS_VISIT_SLIDER_MAX + 1)).toBe(ENGINE_MAX_VISITS);
    expect(visitSliderFillPercent(16)).toBeCloseTo(0);
    expect(visitSliderFillPercent(ENGINE_MAX_VISITS)).toBeCloseTo(100);
  });
});
