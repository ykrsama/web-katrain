import { describe, expect, it } from 'vitest';
import {
  AnalysisQueue,
  isAnalysisQueueCanceledError,
  isAnalysisQueueStaleError,
} from '../src/utils/analysisQueue';

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AnalysisQueue concurrency', () => {
  it('runs up to the configured number of jobs at once', async () => {
    const queue = new AnalysisQueue();
    queue.setConcurrency(2);
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];

    const jobs = gates.map((gate, i) =>
      queue.enqueue({
        id: `job-${i}`,
        group: 'background',
        priority: 1,
        run: async () => {
          started.push(i);
          await gate.promise;
          return i;
        },
      }),
    );

    await flush();
    expect(started).toEqual([0, 1]);

    gates[0]!.resolve();
    await flush();
    expect(started).toEqual([0, 1, 2]);

    gates[1]!.resolve();
    gates[2]!.resolve();
    await expect(Promise.all(jobs)).resolves.toEqual([0, 1, 2]);
  });

  it('still runs one job at a time by default', async () => {
    const queue = new AnalysisQueue();
    const gate = deferred();
    const started: string[] = [];

    const first = queue.enqueue({
      id: 'first',
      group: 'background',
      priority: 1,
      run: async () => {
        started.push('first');
        await gate.promise;
      },
    });
    const second = queue.enqueue({
      id: 'second',
      group: 'background',
      priority: 1,
      run: async () => {
        started.push('second');
      },
    });

    await flush();
    expect(started).toEqual(['first']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(started).toEqual(['first', 'second']);
  });

  it('starts a waiting job as soon as the active one is canceled', async () => {
    const queue = new AnalysisQueue();
    const gate = deferred();
    const started: string[] = [];

    const active = queue.enqueue({
      id: 'active',
      group: 'interactive',
      priority: 1,
      run: async () => {
        started.push('active');
        await gate.promise;
      },
    });
    const waiting = queue.enqueue({
      id: 'waiting',
      group: 'background',
      priority: 1,
      run: async () => {
        started.push('waiting');
        return 'waiting';
      },
    });

    await flush();
    expect(started).toEqual(['active']);

    queue.cancelGroup('interactive');
    await flush();
    expect(started).toEqual(['active', 'waiting']);

    gate.resolve();
    await expect(active).rejects.toSatisfy(isAnalysisQueueCanceledError);
    await expect(waiting).resolves.toBe('waiting');
  });

  it('gives the runner the job priority and an engine-facing AbortSignal', async () => {
    const queue = new AnalysisQueue();
    let seen: { priority: number; aborted: boolean } | null = null;

    await queue.enqueue({
      id: 'p',
      group: 'background',
      priority: 42,
      run: async (ctx) => {
        seen = { priority: ctx.priority, aborted: ctx.signal.aborted };
        return 'ok';
      },
    });

    expect(seen).toEqual({ priority: 42, aborted: false });
  });

  it('aborts an active job whose stale key was superseded', async () => {
    const queue = new AnalysisQueue();
    const gate = deferred();
    let aborted = false;

    const superseded = queue.enqueue({
      id: 'old',
      group: 'interactive',
      priority: 1,
      staleKey: 'live',
      run: async (ctx) => {
        ctx.signal.addEventListener('abort', () => {
          aborted = true;
        });
        await gate.promise;
        return 'old';
      },
    });

    await flush();

    const fresh = queue.enqueue({
      id: 'new',
      group: 'interactive',
      priority: 1,
      staleKey: 'live',
      run: async () => 'new',
    });

    await expect(superseded).rejects.toSatisfy(isAnalysisQueueStaleError);
    expect(aborted).toBe(true);
    await expect(fresh).resolves.toBe('new');
    gate.resolve();
  });
});
