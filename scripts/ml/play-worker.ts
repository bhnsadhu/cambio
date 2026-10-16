import { parentPort } from "node:worker_threads";
import { playTask, type Task } from "./play";

/** Plays one round per message, so the main thread can spread work over every core. */
parentPort!.on("message", (task: Task) => {
  try {
    parentPort!.postMessage({ ok: true, ...playTask(task) });
  } catch (error) {
    parentPort!.postMessage({ ok: false, error: `${task.matchup.id} ${task.set} ${task.seed} ${task.seating}\n${error instanceof Error ? error.stack ?? error.message : String(error)}` });
  }
});
