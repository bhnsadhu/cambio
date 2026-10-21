/**
 * npm run audit:levels: H14 in docs/experiments/bot-evaluation.md. Frozen
 * bots (C0), with observe only instrumentation, play hard vs medium, medium
 * vs easy and hard vs easy once on fresh seeds 540001 to 540050, both
 * seatings, and every measurable claim in the docs is checked against the
 * tolerance fixed before the run. Writes results-audit/ and refuses to run
 * twice. It audits the shipped bots and never blocks the switch.
 */
import type { BotDifficulty } from "../../src/lib/game/types";
import { wilson } from "../results/stats";
import { addAudit, DECISION_TYPES, emptyAudit, LEVELS, levelSide, pct, tasksFor, type LevelAudit, type Matchup, type Task, type TaskResult } from "./play";
import { runPool, wallTime, workerCount } from "./pool";
import { takeLock } from "./lock";
import { writeCsv, writeJson } from "./csv";
import { callColumns, callRow, WORKER } from "./run";

const started = performance.now();
const OUT = "results-audit";
const SEEDS = [{ name: "AU", from: 540001, count: 50 }];
takeLock(OUT, "npm run audit:levels", "seeds 540001 to 540050");

const matchups: Matchup[] = [
  { id: "hard_vs_medium_C0", a: levelSide("hard", "C0"), b: levelSide("medium", "C0") },
  { id: "medium_vs_easy_C0", a: levelSide("medium", "C0"), b: levelSide("easy", "C0") },
  { id: "hard_vs_easy_C0", a: levelSide("hard", "C0"), b: levelSide("easy", "C0") },
];
const tasks = tasksFor(matchups, SEEDS, { audit: true });
console.log(`Auditing ${tasks.length} instrumented rounds of frozen bots on ${workerCount()} workers.`);
const results = await runPool<Task, TaskResult>(WORKER, tasks);
const calls = results.flatMap((r) => r.calls);
const audit: Record<BotDifficulty, LevelAudit> = { easy: emptyAudit(), medium: emptyAudit(), hard: emptyAudit() };
for (const r of results) for (const level of LEVELS) addAudit(audit[level], r.audit![level]);

const share = (k: number, n: number) => ({ k, n, ...wilson(k, n) });
const effort = Object.fromEntries(LEVELS.map((l) => [l, share(audit[l].effortFocused, audit[l].effortRolls)]));
const stickMiss = Object.fromEntries(LEVELS.map((l) => [l, share(audit[l].sticksMissed, audit[l].sticksWanted)]));
const powerMiss = Object.fromEntries(LEVELS.map((l) => [l, share(audit[l].powersSkipped, audit[l].powersWanted)]));
const delay = Object.fromEntries(DECISION_TYPES.map((type) => [type, Object.fromEntries(LEVELS.map((l) => {
  const d = audit[l].delays[type];
  return [l, d.n ? { n: d.n, meanMs: d.sum / d.n } : { n: 0, meanMs: null }];
}))])) as Record<string, Record<BotDifficulty, { n: number; meanMs: number | null }>>;
const ordered = (values: (number | null)[]) => values.every((v) => v !== null) && values[0]! > values[1]! && values[1]! > values[2]!;
const contains = (s: { low: number; high: number }, p: number) => s.low <= p && p <= s.high;

const checks = [
  { claim: "Easy uses the full strategy on 50% of its opportunities", measured: `${pct(effort.easy.rate)} of ${effort.easy.n} rolls (${pct(effort.easy.low)} to ${pct(effort.easy.high)})`, tolerance: "Wilson 95% interval contains 50%", holds: contains(effort.easy, 0.5) },
  { claim: "Medium uses the full strategy on 75% of its opportunities", measured: `${pct(effort.medium.rate)} of ${effort.medium.n} rolls (${pct(effort.medium.low)} to ${pct(effort.medium.high)})`, tolerance: "Wilson 95% interval contains 75%", holds: contains(effort.medium, 0.75) },
  { claim: "Hard always uses the full strategy", measured: `${effort.hard.k} of ${effort.hard.n} rolls focused`, tolerance: "every roll focused", holds: effort.hard.k === effort.hard.n },
  { claim: "Easy remembers only its two most recently seen cards", measured: `at most ${audit.easy.maxKnown} faces at ${audit.easy.decisions} decisions; ${audit.easy.overTwo} over 2`, tolerance: "0 decisions over 2", holds: audit.easy.overTwo === 0 },
  { claim: "Medium remembers its own revealed cards plus six opponent cards", measured: `at most ${audit.medium.maxOpponentKnown} opponent faces; ${audit.medium.opponentOverSix} decisions over 6; ${audit.medium.ownLost} with an own face lost while in hand`, tolerance: "0 decisions over 6 and 0 own faces lost", holds: audit.medium.opponentOverSix === 0 && audit.medium.ownLost === 0 },
  { claim: "Hard retains every legitimately observed face", measured: `${audit.hard.tableLost} of ${audit.hard.decisions} decisions with a remembered face lost while still on the table (at most ${audit.hard.maxKnown} faces)`, tolerance: "0 decisions", holds: audit.hard.tableLost === 0 },
  { claim: "Easy misses sticks", measured: LEVELS.map((l) => `${l} ${pct(stickMiss[l].rate)} of ${stickMiss[l].n}`).join(", "), tolerance: "missed share easy > medium > hard", holds: ordered(LEVELS.map((l) => stickMiss[l].rate)) },
  { claim: "Easy skips useful powers", measured: LEVELS.map((l) => `${l} ${pct(powerMiss[l].rate)} of ${powerMiss[l].n}`).join(", "), tolerance: "skipped share easy > medium > hard", holds: ordered(LEVELS.map((l) => powerMiss[l].rate)) },
  { claim: "Easy sometimes keeps a mediocre draw without checking what it replaces", measured: LEVELS.map((l) => `${l} ${audit[l].lapseKeeps}`).join(", "), tolerance: "easy at least 1", holds: audit.easy.lapseKeeps > 0 },
  ...DECISION_TYPES.map((type) => ({
    claim: `Easy reacts slowest and hard fastest: ${type}`,
    measured: LEVELS.map((l) => `${l} ${delay[type][l].meanMs === null ? "not observed" : `${(delay[type][l].meanMs! / 1000).toFixed(2)} s (${delay[type][l].n})`}`).join(", "),
    tolerance: "mean planned delay easy > medium > hard", holds: ordered(LEVELS.map((l) => delay[type][l].meanMs)),
  })),
  { claim: "Missed opportunities stay missed on repeated planning passes", measured: `${LEVELS.reduce((s, l) => s + audit[l].effortChanged, 0)} rolls changed`, tolerance: "0", holds: LEVELS.every((l) => audit[l].effortChanged === 0) },
  { claim: "Bots only stick remembered matches", measured: `${LEVELS.reduce((s, l) => s + audit[l].stickTargetsNotRemembered, 0)} planned sticks on an unremembered card or another rank`, tolerance: "0", holds: LEVELS.every((l) => audit[l].stickTargetsNotRemembered === 0) },
  { claim: "Every call passes the same belief gate", measured: `${calls.filter((c) => !c.passesGate).length} of ${calls.length} calls refused by gate_v1`, tolerance: "0", holds: calls.every((c) => c.passesGate) },
];

writeCsv(`${OUT}/checks.csv`, ["claim", "measured", "tolerance", "holds"], checks.map((c) => [c.claim, c.measured, c.tolerance, c.holds]));
writeCsv(`${OUT}/levels.csv`, ["level", "effort_rolls", "effort_focused", "effort_changed", "decisions", "max_known", "max_opponent_known", "over_two", "opponent_over_six", "own_lost", "table_lost", "sticks_wanted", "sticks_missed", "stick_targets_not_remembered", "powers_wanted", "powers_skipped", "lapse_keeps", ...DECISION_TYPES.flatMap((t) => [`${t}_n`, `${t}_mean_ms`])],
  LEVELS.map((l) => { const a = audit[l]; return [l, a.effortRolls, a.effortFocused, a.effortChanged, a.decisions, a.maxKnown, a.maxOpponentKnown, a.overTwo, a.opponentOverSix, a.ownLost, a.tableLost, a.sticksWanted, a.sticksMissed, a.stickTargetsNotRemembered, a.powersWanted, a.powersSkipped, a.lapseKeeps, ...DECISION_TYPES.flatMap((t) => [a.delays[t].n, a.delays[t].n ? a.delays[t].sum / a.delays[t].n : null])]; }));
writeCsv(`${OUT}/calls.csv`, callColumns, calls.map(callRow));
writeJson(`${OUT}/summary.json`, {
  question: "Do the frozen bots behave as the docs say? (H14; audits the shipped bots and never blocks the switch)",
  seeds: SEEDS, rounds: results.length, matchups: matchups.map((m) => m.id),
  counting: "Each opportunity once: an effort roll by its opportunity tag, a stick by the top card, a power by its turn, a delay by its intent.",
  perLevel: audit, effort, stickMiss, powerMiss, delay, checks,
  holds: checks.every((c) => c.holds),
});
for (const c of checks) console.log(`${c.holds ? "holds   " : "REFUTED "} ${c.claim}: ${c.measured}`);
wallTime("npm run audit:levels", started);
