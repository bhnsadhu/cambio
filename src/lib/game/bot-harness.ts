/**
 * Seeded bot versus bot rounds, shared by the strength tests and the bot
 * evaluation (`npm run results`). Pure and deterministic: the seed decides
 * the deck, the ids, and every bot's intent randomness.
 *
 * Every seat is a bot. Intent clocks persist across moves, as they do in the
 * runner, and every action waits the same second after its intent first
 * appears, so a level's faster reactions never decide a result; only its
 * decisions do. After every action the harness checks that all 54 cards are
 * still accounted for, once each, and an unfinished round is an error.
 */
import { assessCambio, planBots, type BotObserver, type BotPlan, type Jitter } from "./bots";
import type { CambioAssessment } from "./bot-beliefs";
import { applyAction, createGame, type EngineCtx } from "./engine";
import { beginner, type ReferencePlayer } from "./reference-beginner";
import { makeCtx } from "./testkit";
import type { BotDifficulty, BotStrategy, GameState } from "./types";

/** Intent-local randomness makes a replay stable without coupling it to planner iteration order. */
export function jitterFor(seed: number): Jitter {
  return (intent: string) => {
    let hash = 2166136261 ^ seed;
    for (const character of intent) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
    return hash / 2 ** 32;
  };
}

export interface SeatSpec {
  difficulty: BotDifficulty;
  /** Abilities removed for an ablation; omitted means the shipped strategy. */
  strategy?: BotStrategy;
  /**
   * Evaluation only: the seat is played by the beginner reference player
   * instead of a bot. The engine treats it as a human seat; its difficulty
   * is ignored.
   */
  beginner?: boolean;
}

export interface RoundOptions {
  /** Observe only: told what every bot's planning pass did. */
  observer?: BotObserver;
}

/** Bot calls only; a reference player's call is in the round's result. */
export interface CallRecord {
  playerId: string;
  seat: number;
  turnsTaken: number;
  /** The caller's own assessment at the moment it called. */
  belief: CambioAssessment;
}

export interface PlayedRound {
  state: GameState;
  steps: number;
  calls: CallRecord[];
}

const MAX_STEPS = 1500;

/** Play one complete round. `seats[i]` plays seat i; seat 0 hosts and leads. */
export function playRound(seed: number, seats: (BotDifficulty | SeatSpec)[], onStep?: (state: GameState) => void, options: RoundOptions = {}): PlayedRound {
  const specs = seats.map((seat) => typeof seat === "string" ? { difficulty: seat } : seat);
  const levels = specs.map((spec) => spec.difficulty);
  const ctx = makeCtx(seed);
  const initial = createGame(`STRENGTH${seed}`, "Host", ctx);
  let state = initial.state;
  state.players[0].isBot = true;
  state.players[0].difficulty = levels[0];
  state.botDifficulty = levels.slice();
  state = applyAction(state, { actionId: `start-${seed}`, playerId: initial.hostId, action: { type: "start" } }, ctx).state;
  for (const player of state.players) {
    const strategy = specs[player.seat]?.strategy;
    if (!strategy) continue;
    player.strategy = { ...strategy };
    // With every seat a bot, the start action already opened the peek, and
    // each bot has remembered exactly its two opening cards. Capping that
    // single observation now is what the engine would have done at the time.
    const known = state.botKnown[player.id] ?? [];
    if (known.length > 2) throw new Error(`seed ${seed}: seat ${player.seat} saw more than its opening cards before setup`);
    if (strategy.memory !== undefined) state.botKnown[player.id] = known.slice(Math.max(0, known.length - strategy.memory));
  }
  const references: ReferencePlayer[] = [];
  for (const player of state.players) {
    if (!specs[player.seat]?.beginner) continue;
    // The seat saw its two opening cards as a bot; from here it is a human
    // seat that remembers them itself.
    references.push(beginner(player.id, state.botKnown[player.id] ?? []));
    player.isBot = false;
    delete player.difficulty;
    delete player.strategy;
    delete state.botKnown[player.id];
  }
  const { state: finished, steps, calls } = playOut(state, ctx, {
    jitter: jitterFor(seed),
    label: `seed ${seed}`,
    actionId: (step) => `strength-${seed}-${step}`,
    onStep,
    observer: options.observer,
    references,
  });
  if (finished.phase !== "scoring") throw new Error(`seed ${seed} and levels ${levels.join("/")} did not finish after ${steps} legal actions`);
  if (finished.results.length !== 1) throw new Error(`seed ${seed}: expected one scored round, found ${finished.results.length}`);
  return { state: finished, steps, calls };
}

export type RoundCtx = EngineCtx & { tick: (ms: number) => void };

export interface PlayOutOptions {
  jitter: Jitter;
  /** Names the round in error messages. */
  label: string;
  /** A unique id for each applied action. */
  actionId: (step: number) => string;
  onStep?: (state: GameState) => void;
  observer?: BotObserver;
  /** Seats played by a reference player rather than a bot. */
  references?: ReferencePlayer[];
}

/**
 * Plays bots from any live state until the round scores, or until the step
 * limit. A copied state can be played forward this way to see where an
 * action leads; the caller checks that the round finished.
 */
export function playOut(start: GameState, ctx: RoundCtx, options: PlayOutOptions): PlayedRound {
  const { jitter, label, actionId, onStep, observer, references = [] } = options;
  let state = start;
  const waiting = new Map<string, number>();
  const calls: CallRecord[] = [];
  let steps = 0;
  for (; state.phase !== "scoring" && steps < MAX_STEPS; steps++) {
    const plans: BotPlan[] = planBots(state, ctx.now, jitter, observer);
    for (const reference of references) plans.push(...reference.plan(state));
    if (!plans.length) throw new Error(`${label}: no move in ${state.phase}`);
    for (const intent of waiting.keys()) if (!plans.some((plan) => plan.intent === intent)) waiting.delete(intent);
    const scheduled = plans.map((plan) => {
      if (!waiting.has(plan.intent)) waiting.set(plan.intent, ctx.now);
      const isDeadline = plan.action.type === "advance" || plan.action.type === "timeout";
      return { ...plan, due: isDeadline ? ctx.now + plan.delayMs : waiting.get(plan.intent)! + 1000 };
    }).sort((a, b) => a.due - b.due);
    const plan = scheduled[0];
    const caller = plan.action.type === "callCambio" ? state.players.find((seat) => seat.id === plan.playerId)! : null;
    if (caller?.isBot) {
      calls.push({ playerId: caller.id, seat: caller.seat, turnsTaken: state.turnsTaken, belief: assessCambio(state, caller.id) });
    }
    ctx.tick(Math.max(700, plan.due - ctx.now + 1));
    const result = applyAction(state, { actionId: actionId(steps), playerId: plan.playerId, action: plan.action }, ctx);
    state = result.state;
    waiting.delete(plan.intent);
    checkCards(state, `${label}, step ${steps}`);
    onStep?.(state);
  }
  return { state, steps, calls };
}

/** No card is created, lost, or duplicated, and the registry holds exactly the live cards. */
export function checkCards(state: GameState, where: string) {
  const cards = [
    ...state.deck,
    ...state.discard,
    ...state.players.flatMap((player) => player.hand.filter((id): id is string => id !== null)),
    ...(state.turn?.drawnCardId ? [state.turn.drawnCardId] : []),
  ];
  if (cards.length !== 54) throw new Error(`${where}: card conservation, ${cards.length} cards`);
  if (new Set(cards).size !== 54) throw new Error(`${where}: duplicate card`);
  const registry = Object.keys(state.cards).sort();
  const live = cards.slice().sort();
  if (registry.length !== live.length || registry.some((id, index) => id !== live[index])) throw new Error(`${where}: card registry differs from the table`);
}
