/**
 * npm run ml:speed: the time per learned action decision (rules_v1 choice,
 * candidates, features and the forward pass), for H13. Each level plays
 * four copies of itself with learned actions on every focused decision
 * (mix 1) on validation seeds 200001 to 200015, both seatings, on the
 * worker pool of npm run results. Writes ml/reports/speed.json.
 */
import { writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { LEVELS, mixSide, tasksFor, type TaskResult } from "./play";
import { runPool, wallTime, workerCount } from "./pool";

const started = performance.now();
const SEEDS = [{ name: "V", from: 200001, count: 15 }];
const BOUND_MS = 25;

const matchups = LEVELS.map((level) => ({ id: `${level}_mix1_copies`, a: mixSide(level, 1), b: mixSide(level, 1) }));
const tasks = tasksFor(matchups, SEEDS, { timing: true });
console.log(`Timing learned action decisions over ${tasks.length} validation rounds on ${workerCount()} workers.`);
const results = await runPool<typeof tasks[number], TaskResult>(new URL("./worker.ts", import.meta.url), tasks);

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
const summarize = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return { decisions: sorted.length, meanMs: sorted.reduce((s, v) => s + v, 0) / sorted.length, p50Ms: quantile(sorted, 0.5), p99Ms: quantile(sorted, 0.99), maxMs: sorted.at(-1)! };
};
const byLevel = Object.fromEntries(LEVELS.map((level) => [level, summarize(results.flatMap((r) => r.decisionMs![level]))]));
const all = summarize(results.flatMap((r) => LEVELS.flatMap((level) => r.decisionMs![level])));
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const report = {
  what: "Wall time of one learned action decision (modelChoice in src/lib/game/bots.ts), measured with performance.now inside the worker threads while every worker was busy.",
  seeds: SEEDS, rounds: tasks.length, workers: workerCount(),
  machine: { cpu: cpus()[0]?.model ?? "unknown", cores: cpus().length, memoryGb: Math.round(totalmem() / 2 ** 30), os: `${platform()} ${release()}`, node: process.version },
  boundMs: BOUND_MS,
  all, byLevel,
  underBound: all.p99Ms < BOUND_MS,
};
writeFileSync("ml/reports/speed.json", `${JSON.stringify(report, (_, v) => typeof v === "number" ? round3(v) : v, 2)}\n`);
for (const [name, s] of [["all", all], ...Object.entries(byLevel)] as const) {
  console.log(`${String(name).padEnd(7)} ${String(s.decisions).padStart(6)} decisions, mean ${s.meanMs.toFixed(2)} ms, p99 ${s.p99Ms.toFixed(2)} ms, max ${s.maxMs.toFixed(2)} ms`);
}
console.log(`99th percentile ${all.p99Ms < BOUND_MS ? "under" : "OVER"} the ${BOUND_MS} ms bound. Wrote ml/reports/speed.json.`);
wallTime("npm run ml:speed", started);
