import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENGINE_MAX_VISITS,
  ENGINE_MAX_VISITS,
  parseEngineMaxVisits,
} from '../src/engine/katago/limits';

describe('engine visit cap', () => {
  it('defaults to 500000 visits', () => {
    expect(DEFAULT_ENGINE_MAX_VISITS).toBe(500_000);
  });

  it('wires the exported cap to the Vite env override', () => {
    expect(ENGINE_MAX_VISITS).toBe(parseEngineMaxVisits(import.meta.env.VITE_KATAGO_MAX_VISITS));
  });

  it('parses configured values and falls back on junk', () => {
    expect(parseEngineMaxVisits('250000')).toBe(250_000);
    expect(parseEngineMaxVisits('  750000 ')).toBe(750_000);
    expect(parseEngineMaxVisits(123_456.9)).toBe(123_456);
    expect(parseEngineMaxVisits(undefined)).toBe(DEFAULT_ENGINE_MAX_VISITS);
    expect(parseEngineMaxVisits(null)).toBe(DEFAULT_ENGINE_MAX_VISITS);
    expect(parseEngineMaxVisits('')).toBe(DEFAULT_ENGINE_MAX_VISITS);
    expect(parseEngineMaxVisits('abc')).toBe(DEFAULT_ENGINE_MAX_VISITS);
    expect(parseEngineMaxVisits('0')).toBe(16);
    expect(parseEngineMaxVisits(-5)).toBe(16);
  });
});
