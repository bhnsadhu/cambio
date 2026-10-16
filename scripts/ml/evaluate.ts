/**
 * npm run ml:evaluate: the single run on the test seeds described in
 * docs/experiments/bot-evaluation.md (H5 to H9). Writes results-learned/
 * and two charts in docs/images/, and leaves results/ untouched.
 *
 * The test seeds are used once. The script refuses to run if
 * results-learned/summary.json already exists.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { BotDifficulty } from "../../src/lib/game/types";
import { ACTION_TOP_K, CALL_THRESHOLDS } from "../../src/lib/game/bot-policies";
import { wilson } from "../results/stats";
import { renderLearnedCharts } from "./charts";
import { ece, runTasks, scoreInterval, shareInterval, side, tasksFor, type CallRow, type Matchup, type SeedSet } from "./play";
import { seededRng } from "../../src/lib/game/testkit";

const OUT = "results-learned";
const TEST: SeedSet[] = [{ name: "T1", from: 300001, count: 200 }, { name: "T2", from: 310001, count: 200 }];
const LEVELS: BotDifficulty[] = ["easy", "medium", "hard"];
const CONFIGS = ["C", "A", "CA"] as const;

if (existsSync(`${OUT}/summary.json`)) {
  console.error(`${OUT}/summary.json exists. The test seeds are used once; this run has already happened.`);
  process.exit(1);
}

export const MATCHUPS: (Matchup & { group: string; config: string })[] = [
  ...CONFIGS.flatMap((config) => [
    ...LEVELS.map((level) => ({ id: `${level}_${config}_vs_${level}`, group: "learned vs frozen self", config, a: side(level, config), b: side(level, "frozen") })),
    { id: `hard_${config}_vs_medium_${config}`, group: "ordering", config, a: side("hard", config), b: side("medium", config) },
    { id: `medium_${config}_vs_easy_${config}`, group: "ordering", config, a: side("medium", config), b: side("easy", config) },
    { id: `easy_${config}_vs_medium`, group: "against the frozen level above", config, a: side("easy", config), b: side("medium", "frozen") },
    { id: `medium_${config}_vs_hard`, group: "against the frozen level above", config, a: side("medium", config), b: side("hard", "frozen") },
  ]),
  { id: "hard_vs_medium", group: "frozen reference", config: "frozen", a: side("hard", "frozen"), b: side("medium", "frozen") },
  { id: "medium_vs_easy", group: "frozen reference", config: "frozen", a: side("medium", "frozen"), b: side("easy", "frozen") },
];

const started = performance.now();
const tasks = tasksFor(MATCHUPS, TEST);
console.log(`Playing ${tasks.length} rounds on the test seeds, once.`);
const { rounds, calls } = await runTasks(tasks);

const summaries = MATCHUPS.map((m) => ({
  id: m.id, group: m.group, config: m.config, sideA: m.a.label, sideB: m.b.label,
  rounds: rounds.filter((r) => r.matchup === m.id).length,
  shareA: shareInterval(rounds, m.id),
  shareABySet: Object.fromEntries(TEST.map((set) => [set.name, shareInterval(rounds.filter((r) => r.set === set.name), m.id)])),
  meanScoreA: scoreInterval(rounds, m.id, (r) => r.scoreA), meanScoreB: scoreInterval(rounds, m.id, (r) => r.scoreB),
}));
const byId = Object.fromEntries(summaries.map((s) => [s.id, s]));

// H5: the model's stated chance at its calls against the gate's belief at frozen seats' calls, same matchups.
const modelCalls = calls.filter((c) => c.policy === "model_v1");
const gateCalls = calls.filter((c) => c.frozen);
const seedKeys = [...new Set(rounds.map((r) => `${r.set}:${r.seed}`))];
const bySeed = (list: CallRow[]) => {
  const map = new Map<string, CallRow[]>();
  for (const call of list) map.set(`${call.set}:${call.seed}`, [...(map.get(`${call.set}:${call.seed}`) ?? []), call]);
  return map;
};
const modelBySeed = bySeed(modelCalls), gateBySeed = bySeed(gateCalls);
const random = seededRng(20261015);
const differences: number[] = [];
for (let b = 0; b < 2000; b++) {
  const model: CallRow[] = [], gate: CallRow[] = [];
  for (let i = 0; i < seedKeys.length; i++) {
    const key = seedKeys[Math.floor(random() * seedKeys.length)];
    model.push(...(modelBySeed.get(key) ?? []));
    gate.push(...(gateBySeed.get(key) ?? []));
  }
  differences.push(ece(gate) - ece(model));
}
differences.sort((x, y) => x - y);
const modelEce = ece(modelCalls), gateEce = ece(gateCalls);
const difference = { mean: gateEce - modelEce, low: differences[Math.floor(0.025 * differences.length)], high: differences[Math.ceil(0.975 * differences.length) - 1] };
const rate = (list: CallRow[]) => {
  const w = wilson(list.filter((c) => c.won).length, list.length);
  return { calls: list.length, wins: list.filter((c) => c.won).length, winRate: w.rate, low: w.low, high: w.high, meanStated: list.reduce((s, c) => s + c.stated, 0) / list.length, ece: ece(list) };
};

const above = (id: string) => byId[id].shareA.low > 0.5;
const below = (id: string) => byId[id].shareA.high < 0.5;
const hypotheses = {
  h5: {
    rule: "Refuted if the model's ECE is above 0.10, or if the 95% bootstrap interval of the gate's ECE minus the model's ECE includes zero or falls below it.",
    model: rate(modelCalls), gate: rate(gateCalls),
    modelByLevel: Object.fromEntries(LEVELS.map((l) => [l, rate(modelCalls.filter((c) => c.difficulty === l))])),
    gateByLevel: Object.fromEntries(LEVELS.map((l) => [l, rate(gateCalls.filter((c) => c.difficulty === l))])),
    difference,
    supported: modelEce <= 0.1 && difference.low > 0,
  },
  h6: {
    rule: "Refuted for a level if the 95% interval of the learned side's win share includes 50% or lies below it.",
    levels: Object.fromEntries(LEVELS.map((l) => [l, { shareA: byId[`${l}_A_vs_${l}`].shareA, supported: above(`${l}_A_vs_${l}`) }])),
    supported: LEVELS.every((l) => above(`${l}_A_vs_${l}`)),
  },
  h7: {
    rule: "Refuted for a configuration if either matchup's 95% interval for the stronger level includes 50% or lies below it.",
    configs: Object.fromEntries(CONFIGS.map((c) => [c, {
      hard_vs_medium: byId[`hard_${c}_vs_medium_${c}`].shareA, medium_vs_easy: byId[`medium_${c}_vs_easy_${c}`].shareA,
      supported: above(`hard_${c}_vs_medium_${c}`) && above(`medium_${c}_vs_easy_${c}`),
    }])),
  },
  h8: { rule: "Checked by the hidden information tests in npm test (src/lib/game/bot-strength.test.ts, bot-features.test.ts, bot-learned.test.ts); see the write up." },
  h9: {
    rule: "Refuted for a configuration if the learned lower level's 95% interval includes 50% or lies above it.",
    configs: Object.fromEntries(CONFIGS.map((c) => [c, {
      easy_vs_medium: byId[`easy_${c}_vs_medium`].shareA, medium_vs_hard: byId[`medium_${c}_vs_hard`].shareA,
      supported: below(`easy_${c}_vs_medium`) && below(`medium_${c}_vs_hard`),
    }])),
  },
};

// Calibration bins for the chart and the CSV: the model's calls next to the frozen gate's.
const calibration = (["model", "gate"] as const).flatMap((group) => {
  const list = group === "model" ? modelCalls : gateCalls;
  return Array.from({ length: 10 }, (_, index) => {
    const inBin = list.filter((c) => Math.min(9, Math.floor(c.stated * 10)) === index);
    const w = wilson(inBin.filter((c) => c.won).length, inBin.length);
    return { group, from: index / 10, to: (index + 1) / 10, calls: inBin.length, wins: inBin.filter((c) => c.won).length,
      meanStated: inBin.length ? inBin.reduce((s, c) => s + c.stated, 0) / inBin.length : null,
      rate: inBin.length ? w.rate : null, low: inBin.length ? w.low : null, high: inBin.length ? w.high : null, tooSmall: inBin.length < 30 };
  });
});

mkdirSync(OUT, { recursive: true });
const round6 = (value: number) => Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : value;
const csv = (path: string, header: string[], rows: (string | number | boolean | null)[][]) =>
  writeFileSync(path, [header, ...rows].map((row) => row.map((v) => typeof v === "number" ? String(round6(v)) : v === null ? "" : String(v)).join(",")).join("\n") + "\n");
csv(`${OUT}/rounds.csv`, ["matchup", "set", "seed", "seating", "side_a_seats", "share_a", "score_a", "score_b"],
  rounds.map((r) => [r.matchup, r.set, r.seed, r.seating, r.seating === 1 ? "1 and 3" : "2 and 4", r.shareA, r.scoreA, r.scoreB]));
csv(`${OUT}/calls.csv`, ["matchup", "set", "seed", "seating", "seat", "side", "difficulty", "policy", "frozen_seat", "stated", "gate_belief", "won"],
  calls.map((c) => [c.matchup, c.set, c.seed, c.seating, c.seat, c.side, c.difficulty, c.policy, c.frozen ? 1 : 0, c.stated, c.gateBelief, c.won ? 1 : 0]));
csv(`${OUT}/matchups.csv`, ["id", "group", "config", "side_a", "side_b", "rounds", "share_a", "share_a_low", "share_a_high", ...TEST.flatMap((s) => [`share_a_set_${s.name}`, `share_a_set_${s.name}_low`, `share_a_set_${s.name}_high`]), "mean_score_a", "mean_score_b"],
  summaries.map((s) => [s.id, s.group, s.config, s.sideA, s.sideB, s.rounds, s.shareA.mean, s.shareA.low, s.shareA.high, ...TEST.flatMap((t) => [s.shareABySet[t.name].mean, s.shareABySet[t.name].low, s.shareABySet[t.name].high]), s.meanScoreA.mean, s.meanScoreB.mean]));
csv(`${OUT}/calibration.csv`, ["group", "from", "to", "calls", "wins", "mean_stated", "observed_win_rate", "rate_low", "rate_high", "too_small"],
  calibration.map((b) => [b.group, b.from, b.to, b.calls, b.wins, b.meanStated, b.rate, b.low, b.high, b.tooSmall ? 1 : 0]));
const summary = {
  question: "Can models trained on simulated play make each level play more accurately, with Cambio calls whose probabilities can be trusted, while each level still knows only what it knows today and the three levels stay distinct?",
  method: {
    harness: "src/lib/game/bot-harness.ts, as in npm run results",
    seedSets: TEST,
    seatings: "Side A at seats 1 and 3, then reversed to seats 2 and 4.",
    interval: "Per seed, average over its seatings; the mean across seeds plus or minus the t critical value times the standard deviation over the square root of n. Call bins use the Wilson interval; the H5 difference uses 2,000 bootstrap resamples of test seeds.",
    settings: { callThresholds: CALL_THRESHOLDS, actionTopK: ACTION_TOP_K },
  },
  totals: { rounds: rounds.length, calls: calls.length, modelCalls: modelCalls.length, gateCalls: gateCalls.length },
  matchups: summaries, calibration, hypotheses,
};
writeFileSync(`${OUT}/summary.json`, `${JSON.stringify(summary, (_, value) => typeof value === "number" ? round6(value) : value, 2)}\n`);
renderLearnedCharts("docs/images", summaries, calibration);
console.log(JSON.stringify({ h5: hypotheses.h5.supported, h6: hypotheses.h6.supported, h7: Object.fromEntries(CONFIGS.map((c) => [c, hypotheses.h7.configs[c].supported])), h9: Object.fromEntries(CONFIGS.map((c) => [c, hypotheses.h9.configs[c].supported])) }));
console.log(`Wrote ${OUT}/ and two charts in ${((performance.now() - started) / 1000).toFixed(0)} seconds.`);
