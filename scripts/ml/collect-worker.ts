import { parentPort } from "node:worker_threads";
import { collectSeed } from "./decisions";

/** Values one seed's decision points per message, so the main thread can use every core. */
parentPort!.on("message", (seed: number) => {
  try {
    parentPort!.postMessage({ ok: true, seed, rows: collectSeed(seed) });
  } catch (error) {
    parentPort!.postMessage({ ok: false, seed, error: error instanceof Error ? error.stack ?? error.message : String(error) });
  }
});
