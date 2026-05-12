export type JobStatus = "queued" | "running" | "done" | "error";

export type KwaiJob = {
  id: string;
  title: string;
  status: JobStatus;
  error?: string;
  logs: string[];
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
};

const MAX_CONCURRENT = 5;

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

  get activeCount() { return this.running; }
  get pendingCount() { return this.waiting.length; }
}

const g = globalThis as typeof globalThis & {
  __kwaiQueue?: ConcurrentQueue;
  __kwaiJobs?: Map<string, KwaiJob>;
};

const queue: ConcurrentQueue = g.__kwaiQueue ?? (g.__kwaiQueue = new ConcurrentQueue());
const jobs: Map<string, KwaiJob> = g.__kwaiJobs ?? (g.__kwaiJobs = new Map());

export function kwaiEnqueue(id: string, title: string, task: () => Promise<void>): void {
  const job: KwaiJob = { id, title, status: "queued", logs: [], createdAt: Date.now() };
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

export function kwaiAppendLog(id: string, message: string): void {
  const job = jobs.get(id);
  if (!job) return;
  const t = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  job.logs.push(`[${t}] ${message}`);
}

export function kwaiGetAllJobs(): Record<string, KwaiJob> {
  return Object.fromEntries(jobs);
}

export function kwaiGetStats() {
  return { active: queue.activeCount, queued: queue.pendingCount };
}
