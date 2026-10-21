/**
 * The worker pool of npm run results, shared by the level scripts: one
 * worker per core but one (at most 8, or RESULTS_WORKERS), one task per
 * message, results returned in task order whatever order they finish in.
 */
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

export function workerCount(): number {
  return Number(process.env.RESULTS_WORKERS) || Math.max(1, Math.min(availableParallelism() - 1, 8));
}

export async function runPool<T, R>(workerUrl: URL, tasks: T[], progress?: (done: number, total: number) => void): Promise<R[]> {
  const results: R[] = new Array(tasks.length);
  let sent = 0, done = 0;
  const count = Math.min(workerCount(), Math.max(1, tasks.length));
  await new Promise<void>((resolve, reject) => {
    let active = count;
    for (let index = 0; index < count; index++) {
      const worker = new Worker(workerUrl);
      let current = -1;
      const next = () => {
        if (sent < tasks.length) { current = sent++; worker.postMessage(tasks[current]); return; }
        void worker.terminate();
        if (--active === 0) resolve();
      };
      worker.on("message", (reply: { ok: true; result: R } | { ok: false; error: string }) => {
        if (!reply.ok) { reject(new Error(`Task ${current} failed: ${JSON.stringify(tasks[current]).slice(0, 300)}\n${reply.error}`)); return; }
        results[current] = reply.result;
        progress?.(++done, tasks.length);
        next();
      });
      worker.on("error", reject);
      next();
    }
  });
  return results;
}

/** Prints the wall time of a script, as npm run results does. */
export function wallTime(script: string, started: number) {
  console.log(`${script} took ${((performance.now() - started) / 1000).toFixed(1)} seconds of wall time.`);
}
