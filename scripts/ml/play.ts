/**
 * Matchups between learned and frozen bots, played by the same seeded
 * harness, side layout and reversed seatings as npm run results. Shared by
 * the validation tuning (scripts/ml/tune.ts) and the single test run
 * (scripts/ml/evaluate.ts).
 */
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { playRound, type SeatSpec } from "../../src/lib/game/bot-harness";
import type { BotDifficulty, BotStrategy } from "../../src/lib/game/types";
import { mean, tInterval, type Interval } from "../results/stats";

export interface Side { label: string; difficulty: BotDifficulty; strategy: BotStrategy }
export interface Matchup { id: string; a: Side; b: Side }
export interface SeedSet { name: string; from: number; count: number }
export interface Task { matchup: Matchup; set: string; seed: number; seating: 1 | 2 }

export const FROZEN: BotStrategy = { callPolicy: "gate_v1", actionPolicy: "rules_v1" };
export const CONFIGS: Record<"C" | "A" | "CA", BotStrategy> = {
  C: { callPolicy: "model_v1", actionPolicy: "rules_v1" },
  A: { callPolicy: "gate_v1", actionPolicy: "model_v1" },
  CA: { callPolicy: "model_v1", actionPolicy: "model_v1" },
};

export const side = (difficulty: BotDifficulty, config: keyof typeof CONFIGS | "frozen", extra: BotStrategy = {}): Side => ({
  label: config === "frozen" ? difficulty : `${difficulty} ${config}`,
  difficulty,
  strategy: { ...(config === "frozen" ? FROZEN : CONFIGS[config]), ...extra },
});

export interface CallRow {
  matchup: string; set: string; seed: number; seating: number; seat: number; side: "a" | "b";
  difficulty: BotDifficulty; policy: "gate_v1" | "model_v1";
  /** A seat on both frozen policies. */
  frozen: boolean;
  /** The probability the policy stated: the gate's win belief, or the model's chance. */
  stated: number; gateBelief: number; won: boolean;
}

export interface RoundRow { matchup: string; set: string; seed: number; seating: number; shareA: number; scoreA: number; scoreB: number }

export function playTask(task: Task): { round: RoundRow; calls: CallRow[] } {
  const sides: ("a" | "b")[] = task.seating === 1 ? ["a", "b", "a", "b"] : ["b", "a", "b", "a"];
  const specs: SeatSpec[] = sides.map((s) => ({ difficulty: task.matchup[s].difficulty, strategy: { ...task.matchup[s].strategy } }));
  const { state, calls } = playRound(task.seed, specs);
  const result = state.results[0];
  const bySeat = state.players.slice().sort((p, q) => p.seat - q.seat);
  const shares = bySeat.map((p) => result.winnerIds.includes(p.id) ? 1 / result.winnerIds.length : 0);
  const scores = bySeat.map((p) => result.scores.find((score) => score.playerId === p.id)!.score);
  const sideMean = (s: "a" | "b") => mean(scores.filter((_, seat) => sides[seat] === s));
  return {
    round: {
      matchup: task.matchup.id, set: task.set, seed: task.seed, seating: task.seating,
      shareA: shares.reduce((sum, share, seat) => sum + (sides[seat] === "a" ? share : 0), 0),
      scoreA: sideMean("a"), scoreB: sideMean("b"),
    },
    calls: calls.map((call) => {
      const s = sides[call.seat];
      const policy = task.matchup[s].strategy.callPolicy ?? "gate_v1";
      return {
        matchup: task.matchup.id, set: task.set, seed: task.seed, seating: task.seating, seat: call.seat + 1, side: s,
        difficulty: task.matchup[s].difficulty, policy,
        frozen: policy === "gate_v1" && (task.matchup[s].strategy.actionPolicy ?? "rules_v1") === "rules_v1",
        stated: policy === "model_v1" ? call.belief.modelChance! : call.belief.winChance,
        gateBelief: call.belief.winChance,
        won: result.winnerIds.includes(call.playerId),
      };
    }),
  };
}

export function tasksFor(matchups: Matchup[], sets: SeedSet[]): Task[] {
  const tasks: Task[] = [];
  for (const matchup of matchups) for (const set of sets) for (let seed = set.from; seed < set.from + set.count; seed++) {
    for (const seating of [1, 2] as const) tasks.push({ matchup, set: set.name, seed, seating });
  }
  return tasks;
}

/** Plays every task on all cores and returns rounds and calls in a fixed order. */
export async function runTasks(tasks: Task[], log = true): Promise<{ rounds: RoundRow[]; calls: CallRow[] }> {
  const rounds: RoundRow[] = [];
  const calls: CallRow[] = [];
  const workerCount = Number(process.env.ML_WORKERS) || Math.max(1, availableParallelism());
  const queue = tasks.slice();
  const started = performance.now();
  await new Promise<void>((resolve, reject) => {
    let active = workerCount;
    for (let index = 0; index < workerCount; index++) {
      const worker = new Worker(new URL("./play-worker.ts", import.meta.url));
      const next = () => {
        const task = queue.shift();
        if (task) { worker.postMessage(task); return; }
        void worker.terminate();
        if (--active === 0) resolve();
      };
      worker.on("message", (reply: { ok: true; round: RoundRow; calls: CallRow[] } | { ok: false; error: string }) => {
        if (!reply.ok) { reject(new Error(reply.error)); return; }
        rounds.push(reply.round);
        calls.push(...reply.calls);
        if (log && rounds.length % 2000 === 0) console.log(`  ${rounds.length} of ${tasks.length} rounds, ${((performance.now() - started) / 1000).toFixed(0)} seconds`);
        next();
      });
      worker.on("error", reject);
      next();
    }
  });
  const key = (row: { matchup: string; set: string; seed: number; seating: number }) => `${row.matchup}|${row.set}|${String(row.seed).padStart(8, "0")}|${row.seating}`;
  rounds.sort((x, y) => key(x).localeCompare(key(y)));
  calls.sort((x, y) => key(x).localeCompare(key(y)) || x.seat - y.seat);
  return { rounds, calls };
}

/** Side A's win share with the same per seed t interval as H1 to H4. */
export function shareInterval(rounds: RoundRow[], matchup: string): Interval {
  const perSeed = new Map<string, number[]>();
  for (const round of rounds.filter((r) => r.matchup === matchup)) {
    const key = `${round.set}:${round.seed}`;
    perSeed.set(key, [...(perSeed.get(key) ?? []), round.shareA]);
  }
  return tInterval([...perSeed.values()].map(mean));
}

export function scoreInterval(rounds: RoundRow[], matchup: string, pick: (round: RoundRow) => number): Interval {
  const perSeed = new Map<string, number[]>();
  for (const round of rounds.filter((r) => r.matchup === matchup)) {
    const key = `${round.set}:${round.seed}`;
    perSeed.set(key, [...(perSeed.get(key) ?? []), pick(round)]);
  }
  return tInterval([...perSeed.values()].map(mean));
}

/** Expected calibration error over ten equal width bins, weighted by each bin's share of calls. */
export function ece(calls: { stated: number; won: boolean }[]): number {
  const bins = Array.from({ length: 10 }, () => ({ n: 0, stated: 0, won: 0 }));
  for (const call of calls) {
    const bin = bins[Math.min(9, Math.floor(call.stated * 10))];
    bin.n++; bin.stated += call.stated; bin.won += call.won ? 1 : 0;
  }
  return bins.reduce((sum, bin) => sum + (bin.n ? bin.n / calls.length * Math.abs(bin.stated / bin.n - bin.won / bin.n) : 0), 0);
}
