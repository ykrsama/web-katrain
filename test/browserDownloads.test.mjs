import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackBrowserDownloads } from '../scripts/lib/browser.mjs';

afterEach(() => vi.useRealTimers());

const fixture = () => {
  let listener;
  const dispose = vi.fn();
  const tracker = trackBrowserDownloads({ on(callback) { listener = callback; return dispose; } });
  const send = (state, guid = 'download-1') => listener({ method: 'Browser.downloadProgress', params: { state, guid } });
  return { tracker, send, dispose };
};

describe('CI download completion', () => {
  it('waits for completion instead of treating a newly created file as saved', async () => {
    vi.useFakeTimers();
    const { tracker, send, dispose } = fixture();
    send('inProgress');
    let finished = false;
    const result = tracker.waitForCount(1).then(value => { finished = true; return value; });
    await vi.advanceTimersByTimeAsync(50);
    expect(finished).toBe(false);
    send('completed');
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toEqual(['download-1']);
    send('completed');
    expect(tracker.completed).toHaveLength(1);
    tracker.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('reports a canceled download immediately', async () => {
    const { tracker, send } = fixture();
    send('canceled');
    await expect(tracker.waitForCount(1)).rejects.toThrow('Browser canceled download');
  });

  it('reports the number of completed downloads on timeout', async () => {
    const { tracker, send } = fixture();
    send('completed');
    await expect(tracker.waitForCount(2, 0)).rejects.toThrow('1 of 2');
  });
});
