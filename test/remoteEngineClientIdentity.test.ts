import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRemoteEngineClient, resetRemoteEngineClientForTests } from '../src/engine/remote/client';

/**
 * A relative proxy path is resolved against the origin on construction, so the
 * instance's `url` is not the string the caller passed. Comparing the resolved
 * form against the configured one made every lookup look like a different
 * server: each analysis disposed the client — closing the socket the previous
 * analysis was using — and built a new one that had to connect from scratch.
 * A game review then opened dozens of sockets at once and Chrome refused with
 * "Connection failed: Insufficient resources".
 */
describe('remote engine client identity', () => {
  const realWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {
      location: { protocol: 'http:', host: 'localhost:5173' },
    };
    resetRemoteEngineClientForTests();
  });

  afterEach(() => {
    resetRemoteEngineClientForTests();
    if (realWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = realWindow;
  });

  it('reuses one client for repeated lookups of the same relative URL', () => {
    const first = getRemoteEngineClient('/katago-proxy');
    const second = getRemoteEngineClient('/katago-proxy');

    expect(second).toBe(first);
    // And the resolved form is what it connects to.
    expect(first.sourceUrl).toBe('/katago-proxy');
  });

  it('reuses one client for repeated lookups of the same absolute URL', () => {
    const first = getRemoteEngineClient('ws://engine.invalid/katago');
    expect(getRemoteEngineClient('ws://engine.invalid/katago')).toBe(first);
  });

  it('replaces the client only when the configured URL actually changes', () => {
    const first = getRemoteEngineClient('/katago-proxy');
    const other = getRemoteEngineClient('ws://engine.invalid/katago');

    expect(other).not.toBe(first);
    expect(other.sourceUrl).toBe('ws://engine.invalid/katago');
  });
});
