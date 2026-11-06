import { describe, expect, it } from 'vitest';
import {
  CORES_RESERVED_FOR_UI,
  LOW_MEMORY_GB,
  LOW_MEMORY_MAX_THREADS,
  MAX_SEARCH_THREADS,
  detectSearchThreadCount,
  resolveSearchThreadCount,
} from '../src/utils/workerThreads';

describe('search thread budget', () => {
  it('leaves cores for the thread that paints the board', () => {
    for (const usable of [2, 4]) {
      const threads = resolveSearchThreadCount({
        hardwareConcurrency: CORES_RESERVED_FOR_UI + usable,
        deviceMemoryGB: LOW_MEMORY_GB * 2,
      });
      expect(threads).toBeGreaterThanOrEqual(1);
      expect(threads).toBeLessThanOrEqual(usable);
      expect(threads).toBeLessThanOrEqual(MAX_SEARCH_THREADS);
    }
  });

  it('is unchanged on the desktops the old cap already covered', () => {
    // Anything with MAX + reserved cores or more was pinned at the cap before
    // and still is, so this costs nothing where the search had room anyway.
    for (const extra of [0, 2, 8, 32]) {
      expect(resolveSearchThreadCount({
        hardwareConcurrency: MAX_SEARCH_THREADS + CORES_RESERVED_FOR_UI + extra,
        deviceMemoryGB: LOW_MEMORY_GB * 2,
      }))
        .toBe(MAX_SEARCH_THREADS);
    }
  });

  it('never returns less than one, however small the machine', () => {
    for (const cores of [undefined, 0, 1, 2, CORES_RESERVED_FOR_UI]) {
      expect(resolveSearchThreadCount({ hardwareConcurrency: cores })).toBeGreaterThanOrEqual(1);
    }
  });

  it('holds back on a machine short of memory', () => {
    for (const extra of [2, 8]) {
      expect(resolveSearchThreadCount({
        hardwareConcurrency: LOW_MEMORY_MAX_THREADS + CORES_RESERVED_FOR_UI + extra,
        deviceMemoryGB: LOW_MEMORY_GB / 2,
      })).toBe(LOW_MEMORY_MAX_THREADS);
    }
  });

  it('treats readings at or above the configured low-memory threshold alike', () => {
    const hardwareConcurrency = MAX_SEARCH_THREADS + CORES_RESERVED_FOR_UI;
    const atThreshold = resolveSearchThreadCount({ hardwareConcurrency, deviceMemoryGB: LOW_MEMORY_GB });
    const aboveThreshold = resolveSearchThreadCount({ hardwareConcurrency, deviceMemoryGB: LOW_MEMORY_GB * 4 });
    expect(atThreshold).toBe(aboveThreshold);
    expect(atThreshold).toBe(MAX_SEARCH_THREADS);
  });

  it('treats an absent or nonsense memory reading as unknown, not as low', () => {
    const hardwareConcurrency = MAX_SEARCH_THREADS + CORES_RESERVED_FOR_UI;
    const unknown = resolveSearchThreadCount({ hardwareConcurrency });
    expect(unknown).toBe(MAX_SEARCH_THREADS);
    expect(resolveSearchThreadCount({ hardwareConcurrency, deviceMemoryGB: NaN })).toBe(unknown);
    expect(resolveSearchThreadCount({ hardwareConcurrency, deviceMemoryGB: 0 })).toBe(unknown);
  });

  it('reads the signals a worker has', () => {
    expect(detectSearchThreadCount({ navigator: {
      hardwareConcurrency: MAX_SEARCH_THREADS + CORES_RESERVED_FOR_UI + 2,
      deviceMemory: LOW_MEMORY_GB * 2,
    } })).toBe(MAX_SEARCH_THREADS);
    expect(detectSearchThreadCount({ navigator: {
      hardwareConcurrency: LOW_MEMORY_MAX_THREADS + CORES_RESERVED_FOR_UI + 2,
      deviceMemory: LOW_MEMORY_GB / 2,
    } })).toBe(LOW_MEMORY_MAX_THREADS);
    expect(detectSearchThreadCount({})).toBe(1);
  });
});
