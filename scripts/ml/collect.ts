/**
 * npm run ml:data -- --split train --seeds 200
 *
 * Plays seeded rounds of frozen bots and values sampled decision points by
 * rollouts (scripts/ml/decisions.ts), writing one JSON line per decision
 * point to ml/data/<split>.jsonl and a manifest beside it. ml/README.md
 * documents the schema. Output is deterministic for a given commit.
 *
 * Only the training and validation seed sets are accepted. The test seeds
 * are reserved for the single evaluation run.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { ACTION_FEATURES, CALL_FEATURES, MAX_CANDIDATES } from "../../src/lib/game/bot-features";
import { ROLLOUTS, SAMPLE, type Row } from "./decisions";

export const SPLITS = {
  train: { from: 100001, max: 99999 },
  validation: { from: 200001, max: 400 },
} as const;

const args = process.argv.slice(2);
const option = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
const split = option("split") as keyof typeof SPLITS | undefined;
if (!split || !(split in SPLITS)) throw new Error("Pass --split train or --split validation. The test seeds are not collected.");
const count = Number(option("seeds") ?? 100);
const from = SPLITS[split].from + Number(option("skip") ?? 0);
if (!(count > 0) || from + count > SPLITS[split].from + SPLITS[split].max) throw new Error(`The ${split} split has ${SPLITS[split].max} seeds from ${SPLITS[split].from}.`);

const started = performance.now();
const seeds = Array.from({ length: count }, (_, index) => from + index);
const workerCount = Number(process.env.ML_WORKERS) || Math.max(1, availableParallelism());
console.log(`Valuing decision points in ${count} ${split} rounds (seeds ${from} to ${from + count - 1}) on ${workerCount} workers.`);

const bySeed = new Map<number, Row[]>();
await new Promise<void>((resolve, reject) => {
  const queue = seeds.slice();
  let active = workerCount;
  for (let index = 0; index < workerCount; index++) {
    const worker = new Worker(new URL("./collect-worker.ts", import.meta.url));
    const next = () => {
      const seed = queue.shift();
      if (seed !== undefined) { worker.postMessage(seed); return; }
      void worker.terminate();
      if (--active === 0) resolve();
    };
    worker.on("message", (reply: { ok: true; seed: number; rows: Row[] } | { ok: false; seed: number; error: string }) => {
      if (!reply.ok) { reject(new Error(`seed ${reply.seed} failed\n${reply.error}`)); return; }
      bySeed.set(reply.seed, reply.rows);
      if (bySeed.size % 20 === 0) console.log(`  ${bySeed.size} of ${count} rounds, ${((performance.now() - started) / 1000).toFixed(0)} seconds`);
      next();
    });
    worker.on("error", reject);
    next();
  }
});

const rows = seeds.flatMap((seed) => bySeed.get(seed)!);
const text = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
mkdirSync("ml/data", { recursive: true });
writeFileSync(`ml/data/${split}.jsonl`, text);
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const kinds: Record<string, number> = {};
for (const row of rows) { const kind = row.type === "call" ? "call" : row.kind; kinds[kind] = (kinds[kind] ?? 0) + 1; }
const manifest = {
  split, seeds: { from, to: from + count - 1, count },
  commit, rollouts: ROLLOUTS, sample: SAMPLE, maxCandidates: MAX_CANDIDATES,
  callFeatures: CALL_FEATURES, actionFeatures: ACTION_FEATURES,
  rows: rows.length, kinds,
  sha256: createHash("sha256").update(text).digest("hex"),
  seconds: Math.round((performance.now() - started) / 1000),
};
writeFileSync(`ml/data/${split}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ml/data/${split}.jsonl: ${rows.length} decision points ${JSON.stringify(kinds)} in ${manifest.seconds} seconds.`);
