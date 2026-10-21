/**
 * npm run ml:ladder: the five ladder matchups for C0 and for A*, once, on
 * fresh seeds 520001 to 520200 and 530001 to 530200 (H11, H13 and H15 in
 * docs/experiments/bot-evaluation.md). Writes results-ladder/ and refuses
 * to run twice.
 */
import { TUNED_ACTION_MIX, type PolicyConfig } from "../../src/lib/game/bot-policies";
import type { BotDifficulty } from "../../src/lib/game/types";
import { BEGINNER, fmt, levelSide, tasksFor, type Matchup } from "./play";
import { wallTime } from "./pool";
import { takeLock } from "./lock";
import { writeCsv, writeJson } from "./csv";
import { callColumns, callRow, chooseSeedSets, matchupColumns, matchupRow, play, roundColumns, roundRow, summarize } from "./run";

const started = performance.now();
const OUT = "results-ladder";
takeLock(OUT, "npm run ml:ladder", "seeds 520001 to 520200 and 530001 to 530200");

const TARGETS: { pair: string; a: BotDifficulty | "beginner"; b: BotDifficulty | "beginner"; low: number; high: number }[] = [
  { pair: "easy_vs_beginner", a: "easy", b: "beginner", low: 0.45, high: 0.85 },
  { pair: "medium_vs_beginner", a: "medium", b: "beginner", low: 0.65, high: 0.95 },
  { pair: "hard_vs_beginner", a: "hard", b: "beginner", low: 0.85, high: 1 },
  { pair: "hard_vs_medium", a: "hard", b: "medium", low: 0.55, high: 0.75 },
  { pair: "medium_vs_easy", a: "medium", b: "easy", low: 0.65, high: 0.9 },
];
const CONFIGS: PolicyConfig[] = ["C0", "A*"];
const tag = (config: PolicyConfig) => config === "A*" ? "Astar" : config;
const side = (who: BotDifficulty | "beginner", config: PolicyConfig) => who === "beginner" ? BEGINNER : levelSide(who, config);
const matchups: (Matchup & { config: PolicyConfig; pair: string })[] = CONFIGS.flatMap((config) => TARGETS.map((t) => ({
  id: `${t.pair}_${tag(config)}`, config, pair: t.pair, a: side(t.a, config), b: side(t.b, config),
})));

const { sets, estimateSeconds, fallback } = await chooseSeedSets(matchups);
const tasks = tasksFor(matchups, sets);
const { rounds, calls } = await play(tasks);
const summaries = summarize(matchups, rounds, calls, sets);
const byId = Object.fromEntries(summaries.map((s) => [s.id, s]));

const verdict = (i: { mean: number; low: number; high: number }, low: number, high: number) =>
  i.mean >= low && i.mean <= high ? "met" : i.high >= low && i.low <= high ? "marginal" : "missed";
const targets = TARGETS.map((t) => ({
  pair: t.pair, range: [t.low, t.high],
  ...Object.fromEntries(CONFIGS.map((config) => {
    const s = byId[`${t.pair}_${tag(config)}`];
    return [config, { shareA: s.shareA, verdict: verdict(s.shareA, t.low, t.high) }];
  })),
}));
const h11 = {
  rule: "Refuted if hard A* vs medium A* or medium A* vs easy A* has a 95% interval for the stronger side whose lower bound is at or below 50%.",
  hard_vs_medium: byId.hard_vs_medium_Astar.shareA, medium_vs_easy: byId.medium_vs_easy_Astar.shareA,
  holds: byId.hard_vs_medium_Astar.shareA.low > 0.5 && byId.medium_vs_easy_Astar.shareA.low > 0.5,
};
const h13 = {
  roundsExpected: tasks.length, roundsFinished: rounds.length,
  botCalls: calls.length, callsRefusedByGate: calls.filter((c) => !c.passesGate).length,
  holds: rounds.length === tasks.length && calls.every((c) => c.passesGate),
};

writeCsv(`${OUT}/rounds.csv`, roundColumns, rounds.map(roundRow));
writeCsv(`${OUT}/calls.csv`, callColumns, calls.map(callRow));
writeCsv(`${OUT}/matchups.csv`, matchupColumns(sets), summaries.map((s) => matchupRow(s, sets)));
writeJson(`${OUT}/summary.json`, {
  question: "Do easy, medium and hard play at the strength the owner wants, with the tuned action mix (A*) and frozen (C0)?",
  seeds: sets, fallback, estimateSeconds, roundsPerMatchup: sets.length * 400, mix: TUNED_ACTION_MIX,
  matchups: summaries, targets, h11, h13,
});
for (const s of summaries) console.log(`${s.id.padEnd(26)} ${fmt(s.shareA)}`);
for (const t of targets) {
  const v = t as unknown as Record<PolicyConfig, { verdict: string }>;
  console.log(`${t.pair.padEnd(20)} C0 ${v.C0.verdict.padEnd(9)} A* ${v["A*"].verdict}`);
}
console.log(JSON.stringify({ h11: h11.holds, h13: h13.holds }));
wallTime("npm run ml:ladder", started);
