import { afterEach, expect, it, vi } from 'vitest';
import { foxApiUrl } from '../src/utils/foxApi';

afterEach(() => vi.unstubAllEnvs());

it('routes capability, search and downloads to the configured Worker even from a Pages subdirectory', () => {
  vi.stubEnv('VITE_FOX_API_BASE_URL', 'https://fox.example/');
  for (const route of ['status', 'search?q=123&mode=uid', 'download/1793188530010001919.sgf']) {
    expect(foxApiUrl(route)).toBe(`https://fox.example/api/fox/${route}`);
  }
  vi.stubEnv('VITE_FOX_API_BASE_URL', '');
  expect(foxApiUrl('status')).toBe('/api/fox/status');
});
