/**
 * One seeded round of frozen bots, with every sampled decision point valued
 * by rollouts. See ml/README.md for the schema and how the labels are made.
 *
 * Features come only from the deciding seat's observation. Labels come from
 * true outcomes: the true state is copied, the action is taken, the undealt
 * deck (which no seat has seen) is shuffled, and the frozen bots play the
 * rest of the round. Every candidate at a point sees the same shuffles and
 * the same bot randomness, so their values differ only by the action.
 */
import { jitterFor, playOut, playRound, type RoundCtx } from "../../src/lib/game/bot-harness";
import { assessObservedCambio } from "../../src/lib/game/bot-beliefs";
import { callFeatures, decisionCandidates, decisionKind, stickTop, type DecisionKind } from "../../src/lib/game/bot-features";
import { observeBot } from "../../src/lib/game/bot-observation";
import { rulesV1Choice } from "../../src/lib/game/bots";
import { shuffle } from "../../src/lib/game/cards";
import { applyAction, canStick } from "../../src/lib/game/engine";
import { seededRng } from "../../src/lib/game/testkit";
import type { Action, BotDifficulty, GameState } from "../../src/lib/game/types";

export const ROLLOUTS = { action: 4, call: 8, draw: 2 } as const;
/** The share of each kind of decision point that is valued. Every other point is skipped. */
export const SAMPLE: Record<"call" | DecisionKind, number> = {
  call: 0.35, decide: 0.3, peekOwn: 1, peekOther: 1, blindSwap: 1, kingLook: 1, kingDecide: 1, stick: 0.5, give: 1,
};

export interface Outcome { share: number[]; margin: number[] }

export interface CallRow {
  type: "call";
  seed: number; lineup: BotDifficulty[]; point: number; seat: number; level: BotDifficulty; turnsTaken: number;
  features: number[];
  gate: { winChance: number; nearWinChance: number; call: boolean };
  call: Outcome;
  draw: Outcome;
}

export interface ActionRow {
  type: "action";
  seed: number; lineup: BotDifficulty[]; point: number; seat: number; level: BotDifficulty; turnsTaken: number;
  kind: DecisionKind;
  legal: number;
  candidates: { action: Action | null; rule: boolean; features: number[]; outcome: Outcome }[];
}

export type Row = CallRow | ActionRow;

const LEVELS: BotDifficulty[] = ["easy", "medium", "hard"];

/** Every level sits at every table, with one level doubled, in a seeded order. */
export function lineupFor(seed: number): BotDifficulty[] {
  return shuffle([...LEVELS, LEVELS[seed % 3]], seededRng(seed ^ 0x5bd1e995));
}

function hash(...parts: number[]): number {
  let h = 2166136261;
  for (const part of parts) h = Math.imul(h ^ (part >>> 0), 16777619) >>> 0;
  return h || 1;
}

interface Point { state: GameState; botId: string; kind: "call" | DecisionKind }

/** The first moment each seat faces each decision during a frozen round. */
function findPoints(seed: number, lineup: BotDifficulty[]): Point[] {
  const points: Point[] = [];
  const seen = new Set<string>();
  playRound(seed, lineup, (state) => {
    if (state.phase !== "playing" && state.phase !== "final") return;
    let snapshot: GameState | null = null;
    const take = (key: string, botId: string, kind: Point["kind"]) => {
      if (seen.has(key)) return;
      seen.add(key);
      snapshot ??= structuredClone(state);
      points.push({ state: snapshot, botId, kind });
    };
    for (const bot of state.players) {
      const t = state.turn;
      if (t?.playerId === bot.id && t.stage === "draw" && state.phase === "playing" && state.turnsTaken >= state.players.length) {
        take(`call:${bot.id}:${state.turnsTaken}`, bot.id, "call");
      }
      const observed = observeBot(state, bot.id);
      const kind = decisionKind(observed, bot.id);
      if (kind) {
        const looked = state.pendingPower?.looked ? `${state.pendingPower.looked.a}:${state.pendingPower.looked.b}` : "";
        take(`${kind}:${bot.id}:${state.turnsTaken}:${looked}:${state.pendingGives.length}`, bot.id, kind);
      }
      const top = canStick(state, bot.id) ? stickTop(observed, bot.id) : null;
      if (top && state.botMissedTop?.[bot.id] !== top.id) take(`stick:${bot.id}:${top.id}`, bot.id, "stick");
    }
  });
  return points;
}

/** Copy the true state, take the action, shuffle the unseen deck, and let the frozen bots finish. */
function rollout(start: GameState, botId: string, action: Action | null, key: number, r: number): { share: number; margin: number } {
  const state = structuredClone(start);
  const rng = seededRng(hash(key, r, 1));
  state.deck = shuffle(state.deck, rng);
  let n = 0;
  const ctx: RoundCtx = { now: state.updatedAt, rng, newId: () => `roll${r}n${++n}`, tick(ms: number) { ctx.now += ms; } };
  ctx.tick(1000);
  const actor = state.players.find((p) => p.id === botId)!;
  let next: GameState;
  if (action === null) {
    // Choosing not to stick this top card, exactly as a bot that has decided against it.
    (state.botMissedTop ??= {})[botId] = state.discard[state.discard.length - 1];
    next = state;
  } else if (action.type === "callCambio") {
    // The gate may refuse this call; the data needs its outcome anyway.
    actor.isBot = false;
    next = applyAction(state, { actionId: `roll-${r}-call`, playerId: botId, action }, ctx).state;
    next.players.find((p) => p.id === botId)!.isBot = true;
  } else {
    next = applyAction(state, { actionId: `roll-${r}-first`, playerId: botId, action }, ctx).state;
  }
  const played = playOut(next, ctx, { jitter: jitterFor(hash(key, r, 2)), label: `rollout ${key}:${r}`, actionId: (step) => `roll-${r}-${step}` });
  if (played.state.phase !== "scoring") throw new Error(`rollout ${key}:${r} did not finish`);
  const result = played.state.results[0];
  const own = result.scores.find((score) => score.playerId === botId)!.score;
  const best = Math.min(...result.scores.filter((score) => score.playerId !== botId).map((score) => score.score));
  return { share: result.winnerIds.includes(botId) ? 1 / result.winnerIds.length : 0, margin: best - own };
}

function outcome(start: GameState, botId: string, action: Action | null, key: number, rollouts: number): Outcome {
  const share: number[] = [], margin: number[] = [];
  for (let r = 0; r < rollouts; r++) {
    const one = rollout(start, botId, action, key, r);
    share.push(one.share);
    margin.push(one.margin);
  }
  return { share, margin };
}

export function collectSeed(seed: number): Row[] {
  const lineup = lineupFor(seed);
  const pick = seededRng(hash(seed, 7));
  const rows: Row[] = [];
  findPoints(seed, lineup).forEach((point, index) => {
    if (pick() >= SAMPLE[point.kind]) return;
    const player = point.state.players.find((p) => p.id === point.botId)!;
    const base = { seed, lineup, point: index, seat: player.seat, level: player.difficulty!, turnsTaken: point.state.turnsTaken };
    const key = hash(seed, index);
    const observed = observeBot(point.state, point.botId);
    if (point.kind === "call") {
      const belief = assessObservedCambio(observed, point.botId);
      rows.push({
        type: "call", ...base,
        features: callFeatures(observed, point.botId, belief),
        gate: { winChance: belief.winChance, nearWinChance: belief.nearWinChance, call: belief.call },
        call: outcome(point.state, point.botId, { type: "callCambio" }, key, ROLLOUTS.call),
        draw: outcome(point.state, point.botId, { type: "draw" }, key, ROLLOUTS.draw),
      });
      return;
    }
    const decision = decisionCandidates(observed, point.botId, point.kind, rulesV1Choice(observed, point.botId, point.kind));
    rows.push({
      type: "action", ...base, kind: point.kind, legal: decision.legal,
      candidates: decision.candidates.map((candidate) => ({
        ...candidate,
        outcome: outcome(point.state, point.botId, candidate.action, key, ROLLOUTS.action),
      })),
    });
  });
  return rows;
}
