import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForStableSnapshot } from '../scripts/lib/browser.mjs';

afterEach(() => vi.useRealTimers());

describe('browser layout readiness', () => {
  it('does not accept unchanged bounds while the grid still uses a stale container size', async () => {
    vi.useFakeTimers();
    let ready = false;
    let finished = false;
    const read = () => ({ ready, left: ready ? 12 : 0 });
    const pending = waitForStableSnapshot(read, { ready:snapshot=>snapshot.ready })
      .then(snapshot=>{ finished=true; return snapshot; });
    await vi.advanceTimersByTimeAsync(400);
    expect(finished).toBe(false);
    ready = true;
    await vi.advanceTimersByTimeAsync(200);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toEqual({ ready:true, left:12 });
  });

  it('restarts the quiet window after a resize and returns the actual final position', async () => {
    vi.useFakeTimers();
    let left = 0;
    let finished = false;
    const pending = waitForStableSnapshot(()=>({left})).then(snapshot=>{ finished=true; return snapshot; });
    await vi.advanceTimersByTimeAsync(150);
    left = 5;
    await vi.advanceTimersByTimeAsync(200);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(150);
    expect(await pending).toEqual({left:5});
  });

  it('reports the last measured state when layout never becomes ready', async () => {
    vi.useFakeTimers();
    const pending = waitForStableSnapshot(()=>({ready:false,left:12}), {ready:snapshot=>snapshot.ready,timeoutMs:200});
    const assertion = expect(pending).rejects.toThrow('"ready":false,"left":12');
    await vi.advanceTimersByTimeAsync(300);
    await assertion;
  });
});
