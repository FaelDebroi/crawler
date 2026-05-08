// Module-level singleton. In dev, persists across hot-reloads via globalThis.

export type JobStatus = "queued" | "running" | "done" | "error";

export type Job = {
  id: string;
  title: string;
  status: JobStatus;
  error?: string;
  logs: string[];
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
};

const MAX_CONCURRENT = 10;

class ConcurrentQueue {
  private running = 0;
  private waiting: Array<() => void> = [];

  async run(task: () => Promise<void>): Promise<void> {
    if (this.running >= MAX_CONCURRENT) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.running++;
    try {
      await task();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }

  get activeCount() {
    return this.running;
  }
  get pendingCount() {
    return this.waiting.length;
  }
}

// Persist across Next.js hot-reloads in development
const g = globalThis as typeof globalThis & {
  __tiktokQueue?: ConcurrentQueue;
  __tiktokJobs?: Map<string, Job>;
};

const queue: ConcurrentQueue = g.__tiktokQueue ?? (g.__tiktokQueue = new ConcurrentQueue());
const jobs: Map<string, Job> = g.__tiktokJobs ?? (g.__tiktokJobs = new Map());

export function enqueue(id: string, title: string, task: () => Promise<void>): void {
  const job: Job = { id, title, status: "queued", logs: [], createdAt: Date.now() };
  jobs.set(id, job);

  queue.run(async () => {
    job.status = "running";
    job.startedAt = Date.now();
    try {
      await task();
      job.status = "done";
    } catch (err) {
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
    } finally {
      job.finishedAt = Date.now();
    }
  });
}

export function appendLog(id: string, message: string): void {
  const job = jobs.get(id);
  if (!job) return;
  const t = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  job.logs.push(`[${t}] ${message}`);
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function getAllJobs(): Record<string, Job> {
  return Object.fromEntries(jobs);
}

export function getStats() {
  return { active: queue.activeCount, queued: queue.pendingCount };
}
