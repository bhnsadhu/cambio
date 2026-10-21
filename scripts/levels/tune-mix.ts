/**
 * npm run ml:tune-mix: chooses each level's action mix on validation seeds
 * only, by the procedure pre-registered for H10 to H15 in
 * docs/experiments/bot-evaluation.md. Writes results-tuning/ and the chosen
 * mixes to src/lib/game/models/action-mix.json.
 *
 * For each level and each mix in {0, 0.25, 0.5, 0.75, 1}: the level at that
 * mix against its frozen self, against the beginner, and (easy and medium)
 * against the frozen level above. Per level, the chosen mix has the highest
 * share against its frozen self among the mixes whose share against the
 * beginner lies inside the level's target range and whose share against the
 * frozen level above is below 50%. Ties go to the lower mix; if no mix
 * qualifies, the mix is 0.
 */
import { BEGINNER, LEVELS, levelSide, mixSide, shareInterval, fmt, tasksFor, type Matchup, type RoundRow, type SeedSet, type Task, type TaskResult } from "./play";
import { runPool, wallTime, workerCount } from "./pool";
import { takeLock } from "./lock";
import { writeCsv, writeJson } from "./csv";
import type { BotDifficulty } from "../../src/lib/game/types";

const started = performance.now();
const OUT = "results-tuning";
const MIXES = [0, 0.25, 0.5, 0.75, 1];
const ABOVE: Partial<Record<BotDifficulty, BotDifficulty>> = { easy: "medium", medium: "hard" };
const BEGINNER_TARGET: Record<BotDifficulty, [number, number]> = { easy: [0.45, 0.85], medium: [0.65, 0.95], hard: [0.85, 1] };
const LIMIT_SECONDS = 20 * 60;

takeLock(OUT, "npm run ml:tune-mix", "validation seeds 200001 to 200100");
const worker = new URL("./worker.ts", import.meta.url);

const matchups: (Matchup & { level: BotDifficulty; mix: number; against: "self" | "beginner" | "above" })[] = LEVELS.flatMap((level) => MIXES.flatMap((mix) => [
  { id: `${level}_mix${mix}_vs_${level}`, level, mix, against: "self" as const, a: mixSide(level, mix), b: levelSide(level, "C0") },
  { id: `${level}_mix${mix}_vs_beginner`, level, mix, against: "beginner" as const, a: mixSide(level, mix), b: BEGINNER },
  ...(ABOVE[level] ? [{ id: `${level}_mix${mix}_vs_${ABOVE[level]}`, level, mix, against: "above" as const, a: mixSide(level, mix), b: levelSide(ABOVE[level]!, "C0") }] : []),
]));

// Estimate from one seed of every matchup, both seatings, before choosing the sample size.
const sampleStarted = performance.now();
await runPool<Task, TaskResult>(worker, tasksFor(matchups, [{ name: "V", from: 200001, count: 1 }]));
const perSeed = (performance.now() - sampleStarted) / 1000;
const estimate = perSeed * 100;
const seeds: SeedSet[] = [{ name: "V", from: 200001, count: estimate > LIMIT_SECONDS ? 50 : 100 }];
console.log(`${matchups.length} matchups on ${workerCount()} workers. One seed of each took ${perSeed.toFixed(1)} seconds, so 100 seeds would take about ${(estimate / 60).toFixed(1)} minutes: ${seeds[0].count * 2} rounds per matchup.`);

const tasks = tasksFor(matchups, seeds);
const results = await runPool<Task, TaskResult>(worker, tasks, (done, total) => { if (done % 2000 === 0) console.log(`  ${done} of ${total} rounds`); });
const rounds: RoundRow[] = results.map((r) => r.round);

const grid = matchups.map((m) => ({ ...m, share: shareInterval(rounds, m.id) }));
const share = (level: BotDifficulty, mix: number, against: string) => grid.find((g) => g.level === level && g.mix === mix && g.against === against)?.share;
const chosen = {} as Record<BotDifficulty, number>;
const selection = LEVELS.map((level) => {
  const [low, high] = BEGINNER_TARGET[level];
  const rows = MIXES.map((mix) => {
    const self = share(level, mix, "self")!, beginner = share(level, mix, "beginner")!, above = share(level, mix, "above");
    const qualifies = beginner.mean >= low && beginner.mean <= high && (!above || above.mean < 0.5);
    return { mix, self: self.mean, beginner: beginner.mean, above: above?.mean ?? null, qualifies };
  });
  // Highest share against its frozen self among qualifying mixes; MIXES is ascending, so a strict > keeps the lower mix on a tie.
  let best: typeof rows[number] | null = null;
  for (const row of rows) if (row.qualifies && (!best || row.self > best.self)) best = row;
  chosen[level] = best ? best.mix : 0;
  return { level, beginnerTarget: BEGINNER_TARGET[level], rows, chosen: chosen[level], anyQualified: !!best };
});

writeCsv(`${OUT}/rounds.csv`, ["matchup", "set", "seed", "seating", "share_a", "score_a", "score_b", "steps", "caller_side"],
  rounds.map((r) => [r.matchup, r.set, r.seed, r.seating, r.shareA, r.scoreA, r.scoreB, r.steps, r.callerSide]));
writeCsv(`${OUT}/grid.csv`, ["level", "mix", "against", "matchup", "rounds", "share_a", "share_a_low", "share_a_high"],
  grid.map((g) => [g.level, g.mix, g.against, g.id, rounds.filter((r) => r.matchup === g.id).length, g.share.mean, g.share.low, g.share.high]));
writeJson(`${OUT}/summary.json`, {
  procedure: "Pre-registered in docs/experiments/bot-evaluation.md, H10 to H15: highest share against the frozen self among mixes whose share against the beginner is inside the level's target range and whose share against the frozen level above is below 50% (point estimates); ties to the lower mix; 0 if none qualifies.",
  seeds, roundsPerMatchup: seeds[0].count * 2, estimateSeconds: estimate, workers: workerCount(),
  grid: grid.map((g) => ({ id: g.id, level: g.level, mix: g.mix, against: g.against, share: g.share })),
  selection, chosen,
});
writeJson("src/lib/game/models/action-mix.json", {
  status: `chosen by npm run ml:tune-mix on validation seeds 200001 to ${200000 + seeds[0].count}, both seatings; see results-tuning/summary.json`,
  mix: chosen,
});

for (const g of grid) console.log(`${g.id.padEnd(26)} ${fmt(g.share)}`);
for (const s of selection) console.log(`${s.level}: mix ${s.chosen}${s.anyQualified ? "" : " (no mix qualified)"}`);
wallTime("npm run ml:tune-mix", started);
