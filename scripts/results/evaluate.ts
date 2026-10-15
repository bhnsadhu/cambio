/**
 * The bot evaluation described in docs/experiments/bot-evaluation.md:
 * matchups, ablations and controls over two seed sets, played by the shared
 * seeded harness, then summarized with 95% intervals across seeds.
 */
import { playRound, type SeatSpec } from "../../src/lib/game/bot-harness";
import type { BotDifficulty, BotStrategy } from "../../src/lib/game/types";
import { mean, tInterval, wilson, type Interval } from "./stats";

export interface SideDef { label: string; difficulty: BotDifficulty; strategy?: BotStrategy }
export interface MatchupDef {
  id: string;
  group: "levels" | "ablations" | "controls";
  title: string;
  a: SideDef;
  b: SideDef;
  /** 2 plays every seed with the seating reversed; controls use 1. */
  seatings: 1 | 2;
  /** What side A plays like, for chart labels. */
  note: string;
}

const level = (difficulty: BotDifficulty): SideDef => ({ label: difficulty, difficulty });
const hardWithout = (label: string, strategy: BotStrategy): SideDef => ({ label, difficulty: "hard", strategy });

export const SEED_SETS = [
  { name: "A", from: 1, count: 200 },
  { name: "B", from: 10001, count: 200 },
] as const;

export const MATCHUPS: MatchupDef[] = [
  { id: "hard_vs_medium", group: "levels", title: "Hard vs medium", a: level("hard"), b: level("medium"), seatings: 2, note: "share won by hard" },
  { id: "medium_vs_easy", group: "levels", title: "Medium vs easy", a: level("medium"), b: level("easy"), seatings: 2, note: "share won by medium" },
  { id: "hard_vs_easy", group: "levels", title: "Hard vs easy", a: level("hard"), b: level("easy"), seatings: 2, note: "share won by hard" },
  { id: "memory2_vs_hard", group: "ablations", title: "Memory of two cards", a: hardWithout("hard, memory 2", { memory: 2 }), b: level("hard"), seatings: 2, note: "remembers only its two latest cards" },
  { id: "no_counting_vs_hard", group: "ablations", title: "No card counting", a: hardWithout("hard, no counting", { counting: false }), b: level("hard"), seatings: 2, note: "treats every unseen card as a full deck draw" },
  { id: "no_inference_vs_hard", group: "ablations", title: "No inference from keeps", a: hardWithout("hard, no inference", { inference: false }), b: level("hard"), seatings: 2, note: "ignores opponents keeping or pushing a draw" },
  { id: "no_gate_vs_hard", group: "ablations", title: "No Cambio gate", a: hardWithout("hard, no gate", { callGate: false }), b: level("hard"), seatings: 2, note: "calls on any estimated lead" },
  { id: "easy_self", group: "controls", title: "Easy copies", a: level("easy"), b: level("easy"), seatings: 1, note: "share won by seats 1 and 3" },
  { id: "medium_self", group: "controls", title: "Medium copies", a: level("medium"), b: level("medium"), seatings: 1, note: "share won by seats 1 and 3" },
  { id: "hard_self", group: "controls", title: "Hard copies", a: level("hard"), b: level("hard"), seatings: 1, note: "share won by seats 1 and 3" },
];

export interface Task { matchup: string; set: string; seed: number; seating: 1 | 2 }

export interface RoundRow {
  matchup: string; set: string; seed: number; seating: number;
  /** Seats are numbered 1 to 4. Seating 1 puts side A at seats 1 and 3. */
  shares: number[]; scores: number[]; sides: ("a" | "b")[];
  shareA: number; scoreA: number; scoreB: number;
  winners: number; steps: number; ended: "called" | "zero"; callerSeat: number | null;
}

export interface CallRow {
  matchup: string; set: string; seed: number; seating: number;
  seat: number; side: "a" | "b"; variant: string; difficulty: BotDifficulty; gate: boolean;
  turnsTaken: number; winBelief: number; nearWinBelief: number; ownEstimate: number; strongestOpponent: number; unknownOwn: number;
  won: boolean; tied: boolean; callerScore: number; bestOtherScore: number;
}

export function tasks(): Task[] {
  const list: Task[] = [];
  for (const matchup of MATCHUPS) for (const set of SEED_SETS) for (let seed = set.from; seed < set.from + set.count; seed++) {
    for (let seating = 1; seating <= matchup.seatings; seating++) list.push({ matchup: matchup.id, set: set.name, seed, seating: seating as 1 | 2 });
  }
  return list;
}

export function playTask(task: Task): { round: RoundRow; calls: CallRow[] } {
  const matchup = MATCHUPS.find((m) => m.id === task.matchup)!;
  const sides: ("a" | "b")[] = task.seating === 1 ? ["a", "b", "a", "b"] : ["b", "a", "b", "a"];
  const specs: SeatSpec[] = sides.map((side) => {
    const def = matchup[side];
    return def.strategy ? { difficulty: def.difficulty, strategy: def.strategy } : { difficulty: def.difficulty };
  });
  const { state, steps, calls } = playRound(task.seed, specs);
  const result = state.results[0];
  const bySeat = state.players.slice().sort((p, q) => p.seat - q.seat);
  const shares = bySeat.map((p) => result.winnerIds.includes(p.id) ? 1 / result.winnerIds.length : 0);
  const scores = bySeat.map((p) => result.scores.find((score) => score.playerId === p.id)!.score);
  const sideMean = (side: "a" | "b", values: number[]) => mean(values.filter((_, seat) => sides[seat] === side));
  const round: RoundRow = {
    ...task, shares, scores, sides,
    shareA: shares.reduce((sum, share, seat) => sum + (sides[seat] === "a" ? share : 0), 0),
    scoreA: sideMean("a", scores), scoreB: sideMean("b", scores),
    winners: result.winnerIds.length, steps,
    ended: calls.length ? "called" : "zero",
    callerSeat: calls.length ? calls[0].seat + 1 : null,
  };
  const callRows = calls.map((call): CallRow => {
    const side = sides[call.seat];
    const def = matchup[side];
    const callerScore = scores[call.seat];
    return {
      ...task, seat: call.seat + 1, side, variant: def.label, difficulty: def.difficulty, gate: def.strategy?.callGate !== false,
      turnsTaken: call.turnsTaken, winBelief: call.belief.winChance, nearWinBelief: call.belief.nearWinChance,
      ownEstimate: call.belief.ownEstimate, strongestOpponent: call.belief.strongestOpponent, unknownOwn: call.belief.unknownOwn,
      won: result.winnerIds.includes(call.playerId), tied: result.winnerIds.includes(call.playerId) && result.winnerIds.length > 1,
      callerScore, bestOtherScore: Math.min(...scores.filter((_, seat) => seat !== call.seat)),
    };
  });
  return { round, calls: callRows };
}

export interface MatchupSummary {
  id: string; group: MatchupDef["group"]; title: string; note: string; sideA: string; sideB: string;
  rounds: number; seeds: number;
  /** Side A's win share; B's is one minus it. */
  shareA: Interval;
  shareABySet: Record<string, Interval>;
  meanScoreA: Interval; meanScoreB: Interval; scoreGap: Interval;
  /** Reversed matchups: A's share seated first minus seated second, per seed. */
  seatOrder: Interval | null;
  callsA: number; callsB: number; callWinRateA: number | null; callWinRateB: number | null;
}

export function summarize(rounds: RoundRow[], calls: CallRow[]): MatchupSummary[] {
  return MATCHUPS.map((matchup) => {
    const own = rounds.filter((round) => round.matchup === matchup.id);
    const seedKey = (round: RoundRow) => `${round.set}:${round.seed}`;
    const perSeed = new Map<string, RoundRow[]>();
    for (const round of own) perSeed.set(seedKey(round), [...(perSeed.get(seedKey(round)) ?? []), round]);
    const groups = [...perSeed.values()];
    const avg = (pick: (round: RoundRow) => number) => groups.map((group) => mean(group.map(pick)));
    const shareA = tInterval(avg((round) => round.shareA));
    const shareABySet = Object.fromEntries(SEED_SETS.map((set) => [set.name,
      tInterval(groups.filter((group) => group[0].set === set.name).map((group) => mean(group.map((round) => round.shareA))))]));
    const seatOrder = matchup.seatings === 2 ? tInterval(groups.map((group) =>
      group.find((round) => round.seating === 1)!.shareA - group.find((round) => round.seating === 2)!.shareA)) : null;
    const ownCalls = calls.filter((call) => call.matchup === matchup.id);
    const rate = (side: "a" | "b") => {
      const list = ownCalls.filter((call) => call.side === side);
      return list.length ? list.filter((call) => call.won).length / list.length : null;
    };
    return {
      id: matchup.id, group: matchup.group, title: matchup.title, note: matchup.note, sideA: matchup.a.label, sideB: matchup.b.label,
      rounds: own.length, seeds: groups.length,
      shareA, shareABySet,
      meanScoreA: tInterval(avg((round) => round.scoreA)), meanScoreB: tInterval(avg((round) => round.scoreB)),
      scoreGap: tInterval(avg((round) => round.scoreA - round.scoreB)),
      seatOrder,
      callsA: ownCalls.filter((call) => call.side === "a").length, callsB: ownCalls.filter((call) => call.side === "b").length,
      callWinRateA: rate("a"), callWinRateB: rate("b"),
    };
  });
}

export interface CalibrationBin { gate: "on" | "off"; from: number; to: number; calls: number; wins: number; meanBelief: number | null; rate: number | null; low: number | null; high: number | null; tooSmall: boolean }

export const MIN_BIN = 30;

export function calibrate(calls: CallRow[]): CalibrationBin[] {
  const bins: CalibrationBin[] = [];
  for (const gate of ["on", "off"] as const) {
    for (let index = 0; index < 10; index++) {
      const from = index / 10, to = (index + 1) / 10;
      const inBin = calls.filter((call) => call.gate === (gate === "on") && call.winBelief >= from && (call.winBelief < to || (index === 9 && call.winBelief <= 1)));
      const wins = inBin.filter((call) => call.won).length;
      const interval = wilson(wins, inBin.length);
      bins.push({
        gate, from, to, calls: inBin.length, wins,
        meanBelief: inBin.length ? mean(inBin.map((call) => call.winBelief)) : null,
        rate: inBin.length ? interval.rate : null, low: inBin.length ? interval.low : null, high: inBin.length ? interval.high : null,
        tooSmall: inBin.length < MIN_BIN,
      });
    }
  }
  return bins;
}

/** The original benchmark: seeds 1 to 24 and 101 to 124, both seatings, tallied by level. */
export function benchmark(): { matchup: string; seeds: string; level: BotDifficulty; winShare: number; meanScore: number }[] {
  const rows: { matchup: string; seeds: string; level: BotDifficulty; winShare: number; meanScore: number }[] = [];
  for (const [first, second] of [["hard", "medium"], ["medium", "easy"]] as [BotDifficulty, BotDifficulty][]) {
    const tally = { [first]: { share: 0, score: 0, seats: 0 }, [second]: { share: 0, score: 0, seats: 0 } } as Record<BotDifficulty, { share: number; score: number; seats: number }>;
    for (const from of [1, 101]) for (const levels of [[first, second, first, second], [second, first, second, first]]) {
      for (let seed = from; seed < from + 24; seed++) {
        const { state } = playRound(seed, levels);
        const result = state.results[0];
        for (const player of state.players) {
          const t = tally[player.difficulty!];
          if (result.winnerIds.includes(player.id)) t.share += 1 / result.winnerIds.length;
          t.score += result.scores.find((score) => score.playerId === player.id)!.score;
          t.seats++;
        }
      }
    }
    for (const lvl of [first, second]) rows.push({ matchup: `${first}_vs_${second}`, seeds: "1 to 24 and 101 to 124", level: lvl, winShare: tally[lvl].share, meanScore: tally[lvl].score / tally[lvl].seats });
  }
  return rows;
}
