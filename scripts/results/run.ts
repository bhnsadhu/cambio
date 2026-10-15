/**
 * npm run results: regenerate every bot evaluation output from scratch.
 *
 *   results/rounds.csv       one row per round played
 *   results/calls.csv        one row per actual Cambio call
 *   results/matchups.csv     win share, scores and seat order per matchup, with 95% intervals
 *   results/calibration.csv  observed win rate of calls by belief bin
 *   results/benchmark.csv    the original seeded benchmark, which must reproduce first
 *   results/summary.json     all of the above summaries, plus the hypothesis checks
 *   docs/images/*.svg        the charts
 *
 * Everything is deterministic: the same code gives byte identical files.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { calibrate, MATCHUPS, MIN_BIN, SEED_SETS, summarize, tasks, type CallRow, type RoundRow, type Task } from "./evaluate";
import { renderCharts } from "./charts";
import { wilson } from "./stats";

const started = performance.now();
const RESULTS = "results";
const IMAGES = "docs/images";
const CHARTS = ["win-share.svg", "ablations.svg", "calibration.svg"];
const EXPECTED_BENCHMARK: Record<string, number> = { "hard_vs_medium:hard": 64.5, "hard_vs_medium:medium": 31.5, "medium_vs_easy:medium": 82.5, "medium_vs_easy:easy": 13.5 };

type Reply =
  | { ok: true; kind: "task"; round: RoundRow; calls: CallRow[] }
  | { ok: true; kind: "benchmark"; rows: BenchmarkRow[] }
  | { ok: false; error: string; message: unknown };
interface BenchmarkRow { matchup: string; seeds: string; level: string; winShare: number; meanScore: number }

rmSync(RESULTS, { recursive: true, force: true });
for (const chart of CHARTS) rmSync(`${IMAGES}/${chart}`, { force: true });
mkdirSync(RESULTS, { recursive: true });
mkdirSync(IMAGES, { recursive: true });

const queue: Task[] = tasks();
const total = queue.length;
const rounds: RoundRow[] = [];
const calls: CallRow[] = [];
let benchmarkRows: BenchmarkRow[] | null = null;
const workerCount = Number(process.env.RESULTS_WORKERS) || Math.max(1, Math.min(availableParallelism() - 1, 8));
console.log(`Playing ${total} rounds and the 192 round benchmark on ${workerCount} workers.`);

await new Promise<void>((resolve, reject) => {
  let active = workerCount;
  let benchmarkSent = false;
  for (let index = 0; index < workerCount; index++) {
    const worker = new Worker(new URL("./worker.ts", import.meta.url));
    const next = () => {
      if (!benchmarkSent) { benchmarkSent = true; worker.postMessage({ kind: "benchmark" }); return; }
      const task = queue.shift();
      if (task) { worker.postMessage({ kind: "task", task }); return; }
      void worker.terminate();
      if (--active === 0) resolve();
    };
    worker.on("message", (reply: Reply) => {
      if (!reply.ok) { reject(new Error(`A round failed: ${JSON.stringify(reply.message)}\n${reply.error}`)); return; }
      if (reply.kind === "benchmark") benchmarkRows = reply.rows;
      else {
        rounds.push(reply.round);
        calls.push(...reply.calls);
        if (rounds.length % 1000 === 0) console.log(`  ${rounds.length} of ${total} rounds`);
      }
      next();
    });
    worker.on("error", reject);
    next();
  }
});

// The ablation options must leave default play unchanged. If the original
// benchmark does not reproduce, nothing below can be trusted, so stop.
const benchmark = benchmarkRows! as BenchmarkRow[];
const mismatch = benchmark.filter((row) => EXPECTED_BENCHMARK[`${row.matchup}:${row.level}`] !== row.winShare);
writeCsv(`${RESULTS}/benchmark.csv`, ["matchup", "seeds", "level", "win_share", "mean_score"], benchmark.map((row) => [row.matchup, row.seeds, row.level, row.winShare, row.meanScore]));
if (mismatch.length) {
  console.error(`The original benchmark did not reproduce: ${JSON.stringify(mismatch)}. Stopping before the evaluation.`);
  process.exit(1);
}

const order = new Map(MATCHUPS.map((matchup, index) => [matchup.id, index]));
const key = (row: { matchup: string; set: string; seed: number; seating: number }) => [order.get(row.matchup)!, row.set, row.seed, row.seating] as const;
const compare = (a: ReturnType<typeof key>, b: ReturnType<typeof key>) => a[0] - b[0] || a[1].localeCompare(b[1]) || a[2] - b[2] || a[3] - b[3];
rounds.sort((a, b) => compare(key(a), key(b)));
calls.sort((a, b) => compare(key(a), key(b)) || a.seat - b.seat);

writeCsv(`${RESULTS}/rounds.csv`,
  ["matchup", "set", "seed", "seating", "side_a_seats", "share_a", "score_a", "score_b", "seat1_share", "seat2_share", "seat3_share", "seat4_share", "seat1_score", "seat2_score", "seat3_score", "seat4_score", "winners", "steps", "ended", "caller_seat"],
  rounds.map((r) => [r.matchup, r.set, r.seed, r.seating, r.seating === 1 ? "1 and 3" : "2 and 4", r.shareA, r.scoreA, r.scoreB, ...r.shares, ...r.scores, r.winners, r.steps, r.ended, r.callerSeat ?? ""]));
writeCsv(`${RESULTS}/calls.csv`,
  ["matchup", "set", "seed", "seating", "seat", "side", "variant", "difficulty", "gate", "turns_taken", "win_belief", "near_win_belief", "own_estimate", "strongest_opponent", "unknown_own", "won", "tied", "caller_score", "best_other_score"],
  calls.map((c) => [c.matchup, c.set, c.seed, c.seating, c.seat, c.side, c.variant, c.difficulty, c.gate ? "on" : "off", c.turnsTaken, c.winBelief, c.nearWinBelief, c.ownEstimate, c.strongestOpponent, c.unknownOwn, c.won ? 1 : 0, c.tied ? 1 : 0, c.callerScore, c.bestOtherScore]));

const matchups = summarize(rounds, calls);
const calibration = calibrate(calls);
const ci = (i: { mean: number; low: number; high: number }) => [i.mean, i.low, i.high];
writeCsv(`${RESULTS}/matchups.csv`,
  ["id", "group", "title", "side_a", "side_b", "rounds", "seeds", "share_a", "share_a_low", "share_a_high",
    ...SEED_SETS.flatMap((set) => [`share_a_set_${set.name}`, `share_a_set_${set.name}_low`, `share_a_set_${set.name}_high`]),
    "mean_score_a", "mean_score_a_low", "mean_score_a_high", "mean_score_b", "mean_score_b_low", "mean_score_b_high",
    "score_gap", "score_gap_low", "score_gap_high", "seat_order", "seat_order_low", "seat_order_high",
    "calls_a", "calls_b", "call_win_rate_a", "call_win_rate_b"],
  matchups.map((m) => [m.id, m.group, m.title, m.sideA, m.sideB, m.rounds, m.seeds, ...ci(m.shareA),
    ...SEED_SETS.flatMap((set) => ci(m.shareABySet[set.name])),
    ...ci(m.meanScoreA), ...ci(m.meanScoreB), ...ci(m.scoreGap), ...(m.seatOrder ? ci(m.seatOrder) : ["", "", ""]),
    m.callsA, m.callsB, m.callWinRateA ?? "", m.callWinRateB ?? ""]));
writeCsv(`${RESULTS}/calibration.csv`,
  ["gate", "belief_from", "belief_to", "calls", "wins", "mean_belief", "observed_win_rate", "rate_low", "rate_high", "too_small"],
  calibration.map((b) => [b.gate, b.from, b.to, b.calls, b.wins, b.meanBelief ?? "", b.rate ?? "", b.low ?? "", b.high ?? "", b.tooSmall ? 1 : 0]));

// The hypothesis checks, exactly as docs/experiments/bot-evaluation.md words them.
const byId = Object.fromEntries(matchups.map((m) => [m.id, m]));
const excludesHalf = (i: { low: number; high: number }) => i.low > 0.5 || i.high < 0.5;
const gated = calls.filter((c) => c.gate);
const gatedRate = wilson(gated.filter((c) => c.won).length, gated.length);
const hypotheses = {
  h1: {
    rule: "Refuted if the 95% interval for either matchup includes an even split.",
    hard_vs_medium: byId.hard_vs_medium.shareA, medium_vs_easy: byId.medium_vs_easy.shareA,
    supported: byId.hard_vs_medium.shareA.low > 0.5 && byId.medium_vs_easy.shareA.low > 0.5,
  },
  h2: {
    rule: "Refuted if the win rate of bot calls falls below the 64% belief threshold the gate requires.",
    calls: gated.length, wins: gated.filter((c) => c.won).length, winRate: gatedRate.rate, low: gatedRate.low, high: gatedRate.high,
    meanBelief: gated.reduce((sum, c) => sum + c.winBelief, 0) / gated.length,
    supported: gatedRate.rate >= 0.64,
  },
  h3: {
    rule: "Refuted for an ability if removing it does not change win share outside its 95% interval.",
    abilities: Object.fromEntries(matchups.filter((m) => m.group === "ablations").map((m) => [m.id, {
      shareA: m.shareA, changed: excludesHalf(m.shareA), weaker: m.shareA.high < 0.5, stronger: m.shareA.low > 0.5,
    }])),
  },
  h4: {
    rule: "Refuted if a bot playing copies of itself deviates from an even split outside its interval, or if results change with seat order.",
    selfPlay: Object.fromEntries(matchups.filter((m) => m.group === "controls").map((m) => [m.id, { shareA: m.shareA, deviates: excludesHalf(m.shareA) }])),
    seatOrder: Object.fromEntries(matchups.filter((m) => m.seatOrder).map((m) => [m.id, { difference: m.seatOrder!, changes: m.seatOrder!.low > 0 || m.seatOrder!.high < 0 }])),
  },
};

const summary = {
  question: "Can bots that only see what a human could see play at three clearly different skill levels, and can their Cambio calls be trusted?",
  method: {
    harness: "src/lib/game/bot-harness.ts, the seeded bot versus bot round shared with bot-strength.test.ts",
    seedSets: SEED_SETS,
    seatings: "Side A at seats 1 and 3, then reversed to seats 2 and 4. Controls use one seating.",
    winShare: "A round's win is split equally among tied winners; the two sides' shares add to one.",
    interval: "Per seed, average over its seatings. The 95% interval is the mean across seeds plus or minus the t critical value (0.975, n minus 1 degrees of freedom) times the standard deviation across seeds over the square root of n. Calibration bins use the Wilson score interval.",
    minimumBin: MIN_BIN,
  },
  totals: { rounds: rounds.length, calls: calls.length, gatedCalls: gated.length, ungatedCalls: calls.length - gated.length },
  benchmark, matchups, calibration, hypotheses,
};
writeFileSync(`${RESULTS}/summary.json`, `${JSON.stringify(summary, (_, value) => typeof value === "number" ? round6(value) : value, 2)}\n`);

renderCharts(IMAGES, matchups, calibration);

const seconds = (performance.now() - started) / 1000;
console.log(`Wrote ${RESULTS}/ (${rounds.length} rounds, ${calls.length} Cambio calls) and ${CHARTS.length} charts in ${IMAGES}/.`);
console.log(`npm run results took ${seconds.toFixed(1)} seconds.`);

function round6(value: number) { return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : value; }

function writeCsv(path: string, header: string[], rows: (string | number)[][]) {
  const cell = (value: string | number) => {
    const text = typeof value === "number" ? String(round6(value)) : value;
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  writeFileSync(path, [header, ...rows].map((row) => row.map(cell).join(",")).join("\n") + "\n");
}
