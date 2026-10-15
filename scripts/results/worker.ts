import { parentPort } from "node:worker_threads";
import { benchmark, playTask, type Task } from "./evaluate";

/** Plays one round per message, so the main thread can spread work over every core. */
parentPort!.on("message", (message: { kind: "task"; task: Task } | { kind: "benchmark" }) => {
  try {
    if (message.kind === "benchmark") parentPort!.postMessage({ ok: true, kind: "benchmark", rows: benchmark() });
    else parentPort!.postMessage({ ok: true, kind: "task", ...playTask(message.task) });
  } catch (error) {
    parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error), message });
  }
});
