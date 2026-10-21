/**
 * Shared by the fresh seed scripts: the pre-registered seed sets, the 40
 * minute runtime estimate (timed on validation seeds before any fresh seed
 * is played), and per matchup summaries.
 */
import { runPool, workerCount } from "./pool";
import { scoreInterval, shareInterval, tasksFor, type CallRow, type Matchup, type RoundRow, type SeedSet, type Task, type TaskResult } from "./play";

export const WORKER = new URL("./worker.ts", import.meta.url);
export const FRESH: SeedSet[] = [{ name: "T1", from: 520001, count: 200 }, { name: "T2", from: 530001, count: 200 }];
const LIMIT_SECONDS = 40 * 60;

/** Times three validation seeds of every matchup and picks 800 or, past 40 minutes, 400 rounds per matchup. */
export async function chooseSeedSets(matchups: Matchup[]) {
  const started = performance.now();
  await runPool<Task, TaskResult>(WORKER, tasksFor(matchups, [{ name: "estimate", from: 200101, count: 3 }]));
  const perSeed = (performance.now() - started) / 1000 / 3;
  const estimateSeconds = perSeed * 400;
  const fallback = estimateSeconds > LIMIT_SECONDS;
  const sets = fallback ? FRESH.slice(0, 1) : FRESH;
  console.log(`${matchups.length} matchups on ${workerCount()} workers: estimated ${(estimateSeconds / 60).toFixed(1)} minutes for 800 rounds each, so ${fallback ? "400 rounds per matchup (seeds 520001 to 520200 only)" : "800 rounds per matchup"}.`);
  return { sets, estimateSeconds, fallback };
}

export async function play(tasks: Task[]) {
  const results = await runPool<Task, TaskResult>(WORKER, tasks, (done, total) => { if (done % 1000 === 0) console.log(`  ${done} of ${total} rounds`); });
  return { results, rounds: results.map((r) => r.round), calls: results.flatMap((r) => r.calls) };
}

export function summarize(matchups: Matchup[], rounds: RoundRow[], calls: CallRow[], sets: SeedSet[]) {
  return matchups.map((m) => {
    const own = rounds.filter((r) => r.matchup === m.id);
    return {
      id: m.id, sideA: m.a.label, sideB: m.b.label, rounds: own.length,
      shareA: shareInterval(rounds, m.id),
      shareABySet: Object.fromEntries(sets.map((set) => [set.name, shareInterval(own.filter((r) => r.set === set.name), m.id)])),
      meanScoreA: scoreInterval(rounds, m.id, (r) => r.scoreA), meanScoreB: scoreInterval(rounds, m.id, (r) => r.scoreB),
      botCalls: calls.filter((c) => c.matchup === m.id).length,
      callsRefusedByGate: calls.filter((c) => c.matchup === m.id && !c.passesGate).length,
    };
  });
}

export type Summary = ReturnType<typeof summarize>[number];

export const roundColumns = ["matchup", "set", "seed", "seating", "share_a", "score_a", "score_b", "steps", "caller_side"];
export const roundRow = (r: RoundRow) => [r.matchup, r.set, r.seed, r.seating, r.shareA, r.scoreA, r.scoreB, r.steps, r.callerSide];
export const callColumns = ["matchup", "set", "seed", "seating", "seat", "side", "difficulty", "win_belief", "near_win_belief", "own_estimate", "strongest_opponent", "passes_gate", "won"];
export const callRow = (c: CallRow) => [c.matchup, c.set, c.seed, c.seating, c.seat, c.side, c.difficulty, c.winChance, c.nearWinChance, c.ownEstimate, c.strongestOpponent, c.passesGate ? 1 : 0, c.won ? 1 : 0];
export const matchupColumns = (sets: SeedSet[]) => ["id", "side_a", "side_b", "rounds", "share_a", "share_a_low", "share_a_high", ...sets.flatMap((s) => [`share_a_set_${s.name}`, `share_a_set_${s.name}_low`, `share_a_set_${s.name}_high`]), "mean_score_a", "mean_score_b", "bot_calls", "calls_refused_by_gate"];
export const matchupRow = (s: Summary, sets: SeedSet[]) => [s.id, s.sideA, s.sideB, s.rounds, s.shareA.mean, s.shareA.low, s.shareA.high, ...sets.flatMap((t) => [s.shareABySet[t.name].mean, s.shareABySet[t.name].low, s.shareABySet[t.name].high]), s.meanScoreA.mean, s.meanScoreB.mean, s.botCalls, s.callsRefusedByGate];
