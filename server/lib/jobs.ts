import { randomUUID } from 'node:crypto';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface Job<T = unknown> {
  id: string;
  type: string;
  ownerId: string;
  status: JobStatus;
  createdAt: string;
  finishedAt?: string;
  result?: T;
  error?: string;
}

/**
 * In-process job queue for slow work (satellite lookups, filing parsing).
 * Jobs live in memory, so they are lost on restart. To scale out, swap this
 * class for BullMQ + Redis behind the same enqueue()/get() surface.
 */
export class JobQueue {
  private jobs = new Map<string, Job>();
  private pending: Array<() => Promise<void>> = [];
  private running = 0;

  constructor(
    private readonly concurrency = 2,
    private readonly ttlMs = 60 * 60 * 1000,
    private readonly maxJobs = 500,
  ) {}

  enqueue<T>(type: string, ownerId: string, work: () => Promise<T>): Job<T> {
    this.prune();
    const job: Job<T> = {
      id: randomUUID(),
      type,
      ownerId,
      status: 'queued',
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    this.pending.push(async () => {
      job.status = 'running';
      try {
        job.result = await work();
        job.status = 'succeeded';
      } catch (err) {
        job.error = err instanceof Error ? err.message : String(err);
        job.status = 'failed';
      } finally {
        job.finishedAt = new Date().toISOString();
      }
    });
    this.drain();
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  private drain(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const next = this.pending.shift()!;
      this.running++;
      void next().finally(() => {
        this.running--;
        this.drain();
      });
    }
  }

  private prune(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, j] of this.jobs) {
      const done = j.status === 'succeeded' || j.status === 'failed';
      if (done && j.finishedAt && Date.parse(j.finishedAt) < cutoff) this.jobs.delete(id);
    }
    // hard cap: drop oldest finished jobs
    if (this.jobs.size >= this.maxJobs) {
      for (const [id, j] of this.jobs) {
        if (j.status === 'succeeded' || j.status === 'failed') this.jobs.delete(id);
        if (this.jobs.size < this.maxJobs) break;
      }
    }
  }
}
