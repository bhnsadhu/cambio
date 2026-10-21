import { parentPort } from "node:worker_threads";
import { playTask, type Task } from "./play";

/** Plays one round per message for the pool in pool.ts. */
parentPort!.on("message", (task: Task) => {
  try {
    parentPort!.postMessage({ ok: true, result: playTask(task) });
  } catch (error) {
    parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error) });
  }
});
