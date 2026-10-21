/**
 * Rounds for the per level go live (H10 to H15 in
 * docs/experiments/bot-evaluation.md): C0 and A* sides, the beginner
 * reference player, observe only instrumentation for the level audit, and
 * the time of each learned action decision. Played by the seeded harness
 * with the same side layout, reversed seatings and intervals as npm run
 * results.
 */
import { playRound, type SeatSpec } from "../../src/lib/game/bot-harness";
import type { BotObserver } from "../../src/lib/game/bots";
import { configStrategy, type PolicyConfig } from "../../src/lib/game/bot-policies";
import type { Action, BotDifficulty, BotStrategy } from "../../src/lib/game/types";
import { mean, tInterval, type Interval } from "../results/stats";

export interface Side { label: string; difficulty: BotDifficulty; strategy?: BotStrategy; beginner?: boolean }
export interface Matchup { id: string; a: Side; b: Side }
export interface SeedSet { name: string; from: number; count: number }
export interface Task { matchup: Matchup; set: string; seed: number; seating: 1 | 2; audit?: boolean; timing?: boolean }

export const LEVELS: BotDifficulty[] = ["easy", "medium", "hard"];

/** A level in C0 or A*, at the given mix per level. */
export function levelSide(difficulty: BotDifficulty, config: PolicyConfig, mix?: Record<BotDifficulty, number>): Side {
  return { label: `${difficulty} ${config}`, difficulty, strategy: configStrategy(config, difficulty, mix) };
}

/** A level on learned actions at one mix, for tuning. */
export function mixSide(difficulty: BotDifficulty, mix: number): Side {
  return { label: `${difficulty} at mix ${mix}`, difficulty, strategy: configStrategy("A*", difficulty, { easy: mix, medium: mix, hard: mix }) };
}

export const BEGINNER: Side = { label: "beginner", difficulty: "easy", beginner: true };

export function tasksFor(matchups: Matchup[], sets: SeedSet[], extra: Partial<Task> = {}): Task[] {
  const tasks: Task[] = [];
  for (const matchup of matchups) for (const set of sets) for (let seed = set.from; seed < set.from + set.count; seed++) {
    for (const seating of [1, 2] as const) tasks.push({ matchup, set: set.name, seed, seating, ...extra });
  }
  return tasks;
}

export interface RoundRow {
  matchup: string; set: string; seed: number; seating: number;
  shareA: number; scoreA: number; scoreB: number; steps: number;
  /** The side whose seat called Cambio, if anyone did. */
  callerSide: "a" | "b" | "";
}

/** Every bot call, checked against gate_v1 at the moment it was made. */
export interface CallRow {
  matchup: string; set: string; seed: number; seating: number; seat: number; side: "a" | "b"; difficulty: BotDifficulty;
  winChance: number; nearWinChance: number; ownEstimate: number; strongestOpponent: number; passesGate: boolean; won: boolean;
}

export const DECISION_TYPES = ["draw", "decide", "power", "stick", "give", "call"] as const;
export type DecisionType = typeof DECISION_TYPES[number];

/** One round's audit counts per level; summed across rounds by the audit script. */
export interface LevelAudit {
  effortRolls: number; effortFocused: number; effortChanged: number;
  decisions: number; maxKnown: number; maxOpponentKnown: number;
  overTwo: number; opponentOverSix: number; ownLost: number; tableLost: number;
  sticksWanted: number; sticksMissed: number; stickTargetsNotRemembered: number;
  powersWanted: number; powersSkipped: number;
  lapseKeeps: number;
  delays: Record<DecisionType, { n: number; sum: number }>;
}

export function emptyAudit(): LevelAudit {
  return {
    effortRolls: 0, effortFocused: 0, effortChanged: 0,
    decisions: 0, maxKnown: 0, maxOpponentKnown: 0, overTwo: 0, opponentOverSix: 0, ownLost: 0, tableLost: 0,
    sticksWanted: 0, sticksMissed: 0, stickTargetsNotRemembered: 0, powersWanted: 0, powersSkipped: 0, lapseKeeps: 0,
    delays: Object.fromEntries(DECISION_TYPES.map((type) => [type, { n: 0, sum: 0 }])) as LevelAudit["delays"],
  };
}

export function addAudit(into: LevelAudit, from: LevelAudit) {
  for (const key of Object.keys(from) as (keyof LevelAudit)[]) {
    if (key === "delays") for (const type of DECISION_TYPES) { into.delays[type].n += from.delays[type].n; into.delays[type].sum += from.delays[type].sum; }
    else if (key === "maxKnown" || key === "maxOpponentKnown") into[key] = Math.max(into[key], from[key]);
    else into[key] += from[key];
  }
}

function decisionType(action: Action): DecisionType | null {
  switch (action.type) {
    case "draw": return "draw";
    case "callCambio": return "call";
    case "swap": case "place": return "decide";
    case "stick": return "stick";
    case "give": return "give";
    case "peekOwn": case "peekOther": case "blindSwap": case "kingLook": case "kingDecide": case "skipPower": return "power";
    default: return null;
  }
}

/** Counts each opportunity once, by the keys pre-registered for H14. */
function auditObserver() {
  const audits: Record<BotDifficulty, LevelAudit> = { easy: emptyAudit(), medium: emptyAudit(), hard: emptyAudit() };
  const efforts = new Map<string, boolean>();
  const sticks = new Map<string, { level: BotDifficulty; wanted: boolean; tried: boolean }>();
  const powers = new Set<string>();
  const delays = new Set<string>();
  const ownSeen = new Map<string, Set<string>>();
  const everKnown = new Map<string, Set<string>>();
  const observer: BotObserver = {
    effort: ({ botId, level, tag, focused }) => {
      const key = `${botId}|${tag}`;
      const seen = efforts.get(key);
      if (seen === undefined) {
        efforts.set(key, focused);
        audits[level].effortRolls++;
        if (focused) audits[level].effortFocused++;
      } else if (seen !== focused) audits[level].effortChanged++;
    },
    memory: ({ botId, level, known, own, table }) => {
      const a = audits[level];
      const knownSet = new Set(known), ownSet = new Set(own), tableSet = new Set(table);
      const opponent = known.filter((id) => !ownSet.has(id));
      a.decisions++;
      a.maxKnown = Math.max(a.maxKnown, known.length);
      a.maxOpponentKnown = Math.max(a.maxOpponentKnown, opponent.length);
      if (known.length > 2) a.overTwo++;
      if (opponent.length > 6) a.opponentOverSix++;
      const mine = ownSeen.get(botId) ?? new Set<string>();
      if ([...mine].some((id) => ownSet.has(id) && !knownSet.has(id))) a.ownLost++;
      for (const id of known) if (ownSet.has(id)) mine.add(id);
      ownSeen.set(botId, mine);
      const ever = everKnown.get(botId) ?? new Set<string>();
      if ([...ever].some((id) => tableSet.has(id) && !knownSet.has(id))) a.tableLost++;
      for (const id of known) ever.add(id);
      everKnown.set(botId, ever);
    },
    stick: ({ botId, level, topId, wanted, tried, rememberedMatch }) => {
      const key = `${botId}|${topId}`;
      const seen = sticks.get(key) ?? { level, wanted: false, tried: false };
      sticks.set(key, { level, wanted: seen.wanted || wanted, tried: seen.tried || tried });
      if (rememberedMatch === false) audits[level].stickTargetsNotRemembered++;
    },
    power: ({ level, intent, wanted, skipped }) => {
      if (powers.has(intent)) return;
      powers.add(intent);
      if (!wanted) return;
      audits[level].powersWanted++;
      if (skipped) audits[level].powersSkipped++;
    },
    lapseKeep: ({ level }) => { audits[level].lapseKeeps++; },
    plan: ({ level, intent, action, delayMs }) => {
      const type = decisionType(action);
      if (!type || delays.has(intent)) return;
      delays.add(intent);
      const d = audits[level].delays[type];
      d.n++; d.sum += delayMs;
    },
  };
  const finish = () => {
    for (const { level, wanted, tried } of sticks.values()) {
      if (!wanted) continue;
      audits[level].sticksWanted++;
      if (!tried) audits[level].sticksMissed++;
    }
    return audits;
  };
  return { observer, finish };
}

export interface TaskResult { round: RoundRow; calls: CallRow[]; audit?: Record<BotDifficulty, LevelAudit>; decisionMs?: Record<BotDifficulty, number[]> }

export function playTask(task: Task): TaskResult {
  const sides: ("a" | "b")[] = task.seating === 1 ? ["a", "b", "a", "b"] : ["b", "a", "b", "a"];
  const specs: SeatSpec[] = sides.map((s) => {
    const side = task.matchup[s];
    return { difficulty: side.difficulty, ...(side.strategy ? { strategy: { ...side.strategy } } : {}), ...(side.beginner ? { beginner: true } : {}) };
  });
  const levelBySeat = specs.map((spec) => spec.difficulty);
  const audit = task.audit ? auditObserver() : null;
  const decisionMs: Record<BotDifficulty, number[]> = { easy: [], medium: [], hard: [] };
  const observer: BotObserver | undefined = audit ? audit.observer
    : task.timing ? { modelDecision: ({ level, ms }) => { decisionMs[level].push(ms); } } : undefined;
  const { state, steps, calls } = playRound(task.seed, specs, undefined, { observer });
  const result = state.results[0];
  const bySeat = state.players.slice().sort((p, q) => p.seat - q.seat);
  const shares = bySeat.map((p) => result.winnerIds.includes(p.id) ? 1 / result.winnerIds.length : 0);
  const scores = bySeat.map((p) => result.scores.find((score) => score.playerId === p.id)!.score);
  const sideMean = (s: "a" | "b") => mean(scores.filter((_, seat) => sides[seat] === s));
  const caller = bySeat.find((p) => p.id === result.callerId);
  return {
    round: {
      matchup: task.matchup.id, set: task.set, seed: task.seed, seating: task.seating,
      shareA: shares.reduce((sum, share, seat) => sum + (sides[seat] === "a" ? share : 0), 0),
      scoreA: sideMean("a"), scoreB: sideMean("b"), steps,
      callerSide: caller ? sides[caller.seat] : "",
    },
    calls: calls.map((call) => ({
      matchup: task.matchup.id, set: task.set, seed: task.seed, seating: task.seating, seat: call.seat + 1, side: sides[call.seat],
      difficulty: levelBySeat[call.seat],
      winChance: call.belief.winChance, nearWinChance: call.belief.nearWinChance, ownEstimate: call.belief.ownEstimate, strongestOpponent: call.belief.strongestOpponent,
      passesGate: call.belief.call && call.belief.winChance >= 0.64 && call.belief.nearWinChance >= 0.8 && call.belief.ownEstimate <= call.belief.strongestOpponent,
      won: result.winnerIds.includes(call.playerId),
    })),
    ...(audit ? { audit: audit.finish() } : {}),
    ...(task.timing ? { decisionMs } : {}),
  };
}

/** Side A's win share with the same per seed t interval as H1 to H9. */
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

export const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
export const fmt = (i: { mean: number; low: number; high: number }) => `${pct(i.mean)} (${pct(i.low)} to ${pct(i.high)})`;
