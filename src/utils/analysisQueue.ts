export class AnalysisQueueCanceledError extends Error {
  readonly canceled = true;

  constructor(message = 'Analysis queue job canceled') {
    super(message);
    this.name = 'AnalysisQueueCanceledError';
  }
}

export class AnalysisQueueStaleError extends Error {
  readonly stale = true;

  constructor(message = 'Analysis queue job is stale') {
    super(message);
    this.name = 'AnalysisQueueStaleError';
  }
}

export const isAnalysisQueueCanceledError = (err: unknown): err is AnalysisQueueCanceledError => {
  if (!err || typeof err !== 'object') return false;
  if ((err as { canceled?: boolean }).canceled) return true;
  return err instanceof Error && err.name === 'AnalysisQueueCanceledError';
};

export const isAnalysisQueueStaleError = (err: unknown): err is AnalysisQueueStaleError => {
  if (!err || typeof err !== 'object') return false;
  if ((err as { stale?: boolean }).stale) return true;
  return err instanceof Error && err.name === 'AnalysisQueueStaleError';
};

type AbortListener = () => void;

export class AnalysisQueueSignal {
  private readonly controller = new AbortController();
  private listeners = new Set<AbortListener>();
  aborted = false;
  reason = '';

  /**
   * The native signal handed to engine clients.
   *
   * The queue's own signal is what the queue reasons about; engine clients take
   * an `AbortSignal` so that aborting a job can also tell the engine to stop
   * (a remote engine is sent a `terminate` for the query it is still searching).
   */
  toAbortSignal(): AbortSignal {
    return this.controller.signal;
  }

  addAbortListener(listener: AbortListener): () => void {
    if (this.aborted) {
      listener();
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  throwIfAborted(): void {
    if (this.aborted) throw new AnalysisQueueCanceledError(this.reason || undefined);
  }

  abort(reason: string): void {
    if (this.aborted) return;
    this.aborted = true;
    this.reason = reason;
    this.controller.abort(new AnalysisQueueCanceledError(reason || undefined));
    for (const listener of this.listeners) listener();
    this.listeners.clear();
  }
}

export type AnalysisQueueContext = {
  jobId: string;
  /** Aborted when the job is canceled; forwarded to the engine so it can stop. */
  signal: AbortSignal;
  /** The job's queue priority. Higher is more urgent, the same direction KataGo uses. */
  priority: number;
  isStale: () => boolean;
};

export type AnalysisQueueJobSnapshot = {
  id: string;
  label: string;
  group: string;
  priority: number;
  state: 'pending' | 'active';
  staleKey?: string;
  cacheKey?: string;
};

type AnalysisQueueJob<T> = {
  id: string;
  label: string;
  group: string;
  priority: number;
  sequence: number;
  staleKey?: string;
  staleVersion?: number;
  cacheKey?: string;
  preempt: boolean;
  signal: AnalysisQueueSignal;
  run: (ctx: AnalysisQueueContext) => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
};

type AnalysisQueueCacheSizeListener = (size: number) => void;

export type AnalysisQueueEnqueueOptions<T> = {
  id?: string;
  label?: string;
  group: string;
  priority: number;
  staleKey?: string;
  cacheKey?: string;
  bypassCache?: boolean;
  preempt?: boolean;
  run: (ctx: AnalysisQueueContext) => Promise<T>;
};

export class AnalysisQueue {
  private nextId = 1;
  private sequence = 1;
  private readonly pending: AnalysisQueueJob<unknown>[] = [];
  private readonly active = new Set<AnalysisQueueJob<unknown>>();
  private readonly staleVersions = new Map<string, number>();
  private readonly cache = new Map<string, unknown>();
  private readonly cacheSizeListeners = new Set<AnalysisQueueCacheSizeListener>();
  private readonly maxCacheEntries: number;
  /**
   * How many jobs may run at once.
   *
   * 1 is the local worker: it keeps a single search tree, and its background
   * cancellation treats the newest request in a group as the only one that
   * matters, so a concurrent batch would cancel itself down to its last node.
   * `Number.POSITIVE_INFINITY` matches KaTrain, which pushes every query to the
   * engine and lets the engine's own scheduler order them; a remote analysis
   * engine parallelizes across positions itself.
   */
  private concurrency = 1;

  constructor(maxCacheEntries = 128) {
    this.maxCacheEntries = maxCacheEntries;
  }

  setConcurrency(value: number): void {
    const next = Math.max(1, value);
    if (next === this.concurrency) return;
    this.concurrency = next;
    this.pump();
  }

  getConcurrency(): number {
    return this.concurrency;
  }

  enqueue<T>(opts: AnalysisQueueEnqueueOptions<T>): Promise<T> {
    const staleVersion = opts.staleKey ? this.bumpStaleVersion(opts.staleKey) : undefined;
    if (opts.staleKey) this.cancelStaleJobs(opts.staleKey, staleVersion);

    const cached = opts.cacheKey && !opts.bypassCache ? this.cache.get(opts.cacheKey) : undefined;
    if (cached !== undefined) return Promise.resolve(cached as T);

    return new Promise<T>((resolve, reject) => {
      const job: AnalysisQueueJob<T> = {
        id: opts.id ?? `analysis-job-${this.nextId++}`,
        label: opts.label ?? opts.id ?? 'Analysis job',
        group: opts.group,
        priority: opts.priority,
        sequence: this.sequence++,
        staleKey: opts.staleKey,
        staleVersion,
        cacheKey: opts.cacheKey,
        preempt: opts.preempt === true,
        signal: new AnalysisQueueSignal(),
        run: opts.run,
        resolve,
        reject,
      };

      // A preempting job cancels whatever is at or below its priority, so a
      // live analysis does not have to wait behind a background batch. It is
      // then queued normally: `pump` treats an aborted job as no longer holding
      // a slot, so it starts at once when a slot was freed, and waits when the
      // slots are taken by jobs that outrank it.
      if (job.preempt) this.cancelActiveAtOrBelow(job.priority, `Preempted by ${job.label}`);
      this.pending.push(job as AnalysisQueueJob<unknown>);
      this.pump();
    });
  }

  cancelGroup(group: string, reason = `Canceled ${group} analysis jobs`): number {
    return this.cancelWhere((job) => job.group === group, reason);
  }

  cancelWhere(predicate: (job: AnalysisQueueJobSnapshot) => boolean, reason = 'Analysis job canceled'): number {
    let count = 0;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const job = this.pending[i]!;
      if (!predicate(this.snapshotOf(job, 'pending'))) continue;
      this.pending.splice(i, 1);
      job.signal.abort(reason);
      job.reject(new AnalysisQueueCanceledError(reason));
      count++;
    }

    for (const job of this.active) {
      if (!predicate(this.snapshotOf(job, 'active'))) continue;
      job.signal.abort(reason);
      count++;
    }
    // Aborting frees a slot, so whatever was waiting behind it may start now.
    this.pump();
    return count;
  }

  clearCache(): void {
    if (this.cache.size === 0) return;
    this.cache.clear();
    this.emitCacheSize();
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  subscribeCacheSize(listener: AnalysisQueueCacheSizeListener): () => void {
    this.cacheSizeListeners.add(listener);
    listener(this.cache.size);
    return () => this.cacheSizeListeners.delete(listener);
  }

  getSnapshot(): { active: AnalysisQueueJobSnapshot[]; pending: AnalysisQueueJobSnapshot[] } {
    return {
      active: Array.from(this.active).map((job) => this.snapshotOf(job, 'active')),
      pending: this.pending.map((job) => this.snapshotOf(job, 'pending')),
    };
  }

  private start(job: AnalysisQueueJob<unknown>): void {
    if (job.signal.aborted) {
      // Superseded between being queued and being started: it never held a slot.
      job.reject(new AnalysisQueueCanceledError(job.signal.reason || undefined));
      return;
    }

    this.active.add(job);
    const isStale = () => this.isStale(job);

    void job
      .run({ jobId: job.id, signal: job.signal.toAbortSignal(), priority: job.priority, isStale })
      .then((result) => {
        if (job.signal.aborted) throw new AnalysisQueueCanceledError(job.signal.reason || undefined);
        if (isStale()) throw new AnalysisQueueStaleError(`${job.label} result was superseded`);
        if (job.cacheKey) this.writeCache(job.cacheKey, result);
        job.resolve(result);
      })
      .catch((err: unknown) => {
        if (job.signal.aborted) {
          job.reject(new AnalysisQueueCanceledError(job.signal.reason || undefined));
          return;
        }
        if (this.isStale(job)) {
          job.reject(new AnalysisQueueStaleError(`${job.label} result was superseded`));
          return;
        }
        job.reject(err);
      })
      .finally(() => {
        this.active.delete(job);
        this.pump();
      });
  }

  private pump(): void {
    while (this.activeSlots() < this.concurrency) {
      if (this.pending.length === 0) return;
      this.pending.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
      const next = this.pending.shift();
      if (!next) return;
      this.start(next);
    }
  }

  /**
   * Active jobs that still hold a slot. An aborted job's engine work is being
   * torn down and must not keep the job behind it waiting.
   */
  private activeSlots(): number {
    let slots = 0;
    for (const job of this.active) {
      if (!job.signal.aborted) slots++;
    }
    return slots;
  }

  private cancelActiveAtOrBelow(priority: number, reason: string): void {
    for (const job of this.active) {
      if (job.priority <= priority) job.signal.abort(reason);
    }
  }

  /**
   * Supersede everything still referencing an older version of `staleKey`.
   *
   * This covers jobs that have not started, and jobs that have: an answer
   * nobody will read must not keep an engine slot busy. For a remote engine the
   * abort is also what sends the `terminate`, which is the only way to give the
   * slot back before the search finishes on its own.
   */
  private cancelStaleJobs(staleKey: string, currentVersion?: number): void {
    const superseded = (job: AnalysisQueueJob<unknown>) =>
      job.staleKey === staleKey && job.staleVersion !== currentVersion;

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const job = this.pending[i]!;
      if (!superseded(job)) continue;
      this.pending.splice(i, 1);
      const reason = `${job.label} was superseded`;
      job.signal.abort(reason);
      job.reject(new AnalysisQueueStaleError(reason));
    }

    for (const job of this.active) {
      if (!superseded(job)) continue;
      const reason = `${job.label} was superseded`;
      job.signal.abort(reason);
      job.reject(new AnalysisQueueStaleError(reason));
    }
    // The superseded job no longer holds a slot; start whatever was behind it.
    this.pump();
  }

  private bumpStaleVersion(staleKey: string): number {
    const next = (this.staleVersions.get(staleKey) ?? 0) + 1;
    this.staleVersions.set(staleKey, next);
    return next;
  }

  private isStale(job: AnalysisQueueJob<unknown>): boolean {
    if (!job.staleKey) return false;
    return this.staleVersions.get(job.staleKey) !== job.staleVersion;
  }

  private writeCache(cacheKey: string, value: unknown): void {
    const before = this.cache.size;
    if (this.cache.has(cacheKey)) this.cache.delete(cacheKey);
    this.cache.set(cacheKey, value);
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    if (this.cache.size !== before) this.emitCacheSize();
  }

  private emitCacheSize(): void {
    for (const listener of this.cacheSizeListeners) listener(this.cache.size);
  }

  private snapshotOf(job: AnalysisQueueJob<unknown>, state: 'pending' | 'active'): AnalysisQueueJobSnapshot {
    return {
      id: job.id,
      label: job.label,
      group: job.group,
      priority: job.priority,
      state,
      staleKey: job.staleKey,
      cacheKey: job.cacheKey,
    };
  }
}

export const analysisQueue = new AnalysisQueue();
