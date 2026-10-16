/**
 * npm run ml:tune: choose each level's call threshold and action sharpness
 * by play on validation seeds only (200101 to 200400; 200001 to 200100
 * hold the validation decision data). Writes ml/reports/tuning-validation.json.
 *
 *   --thresholds  each level's call model against its frozen self, over a
 *                 range of thresholds
 *   --check       the level identity and ordering checks for the current
 *                 constants in src/lib/game/bot-policies.ts, with optional
 *                 overrides: --easy-k 2, --medium-share 0.6,
 *                 --medium-threshold 0.6, and so on; --only medium_A keeps
 *                 the matchups whose names contain it
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import type { BotDifficulty, BotStrategy } from "../../src/lib/game/types";
import { runTasks, shareInterval, side, tasksFor, type Matchup, type SeedSet } from "./play";

const VALIDATION: SeedSet[] = [{ name: "V", from: 200101, count: 300 }];
const THRESHOLDS = [0.35, 0.45, 0.5, 0.55, 0.6, 0.7];
const LEVELS: BotDifficulty[] = ["easy", "medium", "hard"];
const REPORT = "ml/reports/tuning-validation.json";

const args = process.argv.slice(2);
const option = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? Number(args[index + 1]) : undefined; };
const overrides = (level: BotDifficulty): BotStrategy => ({
  ...(option(`${level}-threshold`) !== undefined ? { callThreshold: option(`${level}-threshold`) } : {}),
  ...(option(`${level}-k`) !== undefined ? { actionTopK: option(`${level}-k`) } : {}),
  ...(option(`${level}-share`) !== undefined ? { actionModelShare: option(`${level}-share`) } : {}),
});

const report = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, "utf8")) : {};
const fmt = (i: { mean: number; low: number; high: number }) => `${(i.mean * 100).toFixed(1)}% (${(i.low * 100).toFixed(1)} to ${(i.high * 100).toFixed(1)})`;

if (args.includes("--thresholds")) {
  const matchups: Matchup[] = LEVELS.flatMap((level) => THRESHOLDS.map((threshold) => ({
    id: `${level}_C_${threshold}_vs_${level}`, a: side(level, "C", { callThreshold: threshold }), b: side(level, "frozen"),
  })));
  const { rounds } = await runTasks(tasksFor(matchups, VALIDATION));
  report.thresholds = Object.fromEntries(matchups.map((m) => [m.id, shareInterval(rounds, m.id)]));
  for (const m of matchups) console.log(m.id.padEnd(28), fmt(report.thresholds[m.id]));
}

if (args.includes("--check")) {
  const sides = (config: "C" | "A" | "CA", level: BotDifficulty) => side(level, config, overrides(level));
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";
  const matchups: Matchup[] = (["C", "A", "CA"] as const).flatMap((config) => [
    ...LEVELS.map((level) => ({ id: `${level}_${config}_vs_${level}`, a: sides(config, level), b: side(level, "frozen") })),
    { id: `hard_${config}_vs_medium_${config}`, a: sides(config, "hard"), b: sides(config, "medium") },
    { id: `medium_${config}_vs_easy_${config}`, a: sides(config, "medium"), b: sides(config, "easy") },
    { id: `easy_${config}_vs_medium`, a: sides(config, "easy"), b: side("medium", "frozen") },
    { id: `medium_${config}_vs_hard`, a: sides(config, "medium"), b: side("hard", "frozen") },
  ]).filter((m) => m.id.includes(only));
  const { rounds } = await runTasks(tasksFor(matchups, VALIDATION));
  // One entry per run, named by its overrides and filter, so earlier runs stay on record.
  const ran = { overrides: Object.fromEntries(LEVELS.map((level) => [level, overrides(level)])), only, matchups: Object.fromEntries(matchups.map((m) => [m.id, shareInterval(rounds, m.id)])) };
  (report.checks ??= {})[`${JSON.stringify(ran.overrides)}${only ? ` only ${only}` : ""}`] = ran;
  for (const m of matchups) console.log(m.id.padEnd(28), fmt(ran.matchups[m.id]));
}

mkdirSync("ml/reports", { recursive: true });
writeFileSync(REPORT, `${JSON.stringify(report, (_, value) => typeof value === "number" ? Math.round(value * 1e6) / 1e6 : value, 2)}\n`);
