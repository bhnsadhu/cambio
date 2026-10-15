import { cardValue } from "./cards";
import { clueWeight, unseenValues } from "./bot-knowledge";
import { observeBot, type BotObservation } from "./bot-observation";
import { callPolicyOf } from "./bot-policies";
import type { GameState } from "./types";

export { expectedCard, unseenValues } from "./bot-knowledge";

export interface CambioAssessment {
  call: boolean;
  ownEstimate: number;
  strongestOpponent: number;
  winChance: number;
  nearWinChance: number;
  unknownOwn: number;
}

/**
 * A deterministic belief rollout, never an inspection of the undealt deck or
 * unobserved hands. All tiers share the full counting and inference model;
 * their memory and attention determine how often they make use of it.
 * Opponents get one final draw and their best improving replacement before
 * we compare scores. This deliberately budgets for their last-turn recovery.
 */
export function assessCambio(state: GameState, botId: string): CambioAssessment {
  // The reducer rechecks calls too; it must use exactly the same restricted
  // information as the planner, even though it owns the full server state.
  return assessObservedCambio(observeBot(state, botId), botId);
}

export function assessObservedCambio(state: BotObservation, botId: string): CambioAssessment {
  const bot = state.players.find((p) => p.id === botId)!;
  const known = new Set(state.botKnown[bot.id] ?? []);
  const pool = unseenValues(state, bot);
  const inference = bot.strategy?.inference !== false;
  const hands = state.players.map((p) => p.hand.filter((id): id is string => !!id));
  const me = state.players.indexOf(bot);
  const sums = state.players.map(() => 0);
  // Remembered faces are the same in every sample, so read them once.
  const knownValues = new Map<string, number>();
  for (const id of hands.flat()) if (known.has(id) && state.cards[id]) knownValues.set(id, cardValue(state.cards[id]));
  const samples = 192;
  let wins = 0, near = 0;
  // Fixed stratification avoids a fresh random hunch on each server replan.
  let seed = 0x6d2b79f5;
  const random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  for (let sample = 0; sample < samples; sample++) {
    const remaining = pool.slice();
    const take = (id: string) => {
      const available = remaining.length ? remaining : pool;
      // The same weights, summed in the same order, with the clue looked up once.
      const clue = inference ? state.botHints?.[id] : undefined;
      let total = 0;
      for (const value of available) total += clueWeight(clue, value);
      let cursor = random() * total;
      let index = available.length - 1;
      for (let i = 0; i < available.length; i++) {
        cursor -= clueWeight(clue, available[i]);
        if (cursor <= 0) { index = i; break; }
      }
      const value = available[index];
      if (available === remaining) remaining.splice(index, 1);
      return value;
    };
    const values = hands.map((hand) => hand.map((id) => knownValues.get(id) ?? take(id)));
    const totals = values.map((hand, index) => {
      const total = hand.reduce((sum, value) => sum + value, 0);
      if (index === me || !hand.length) return total;
      return total - Math.max(0, Math.max(...hand) - take("final-draw"));
    });
    totals.forEach((total, index) => { sums[index] += total; });
    const best = Math.min(...totals.filter((_, index) => index !== me));
    if (totals[me] <= best) wins++;
    if (totals[me] <= best + 1) near++;
  }
  const ownEstimate = sums[me] / samples;
  const strongestOpponent = Math.min(...sums.filter((_, index) => index !== me).map((sum) => sum / samples));
  const winChance = wins / samples, nearWinChance = near / samples;
  let believed: boolean;
  switch (callPolicyOf(bot.strategy)) {
    case "gate_v1":
      // Evaluation only: with the gate off, an estimated lead alone is enough.
      believed = bot.strategy?.callGate === false || (winChance >= 0.64 && nearWinChance >= 0.8);
      break;
  }
  return {
    call: state.phase === "playing" && state.turnsTaken >= state.players.length &&
      believed && ownEstimate <= strongestOpponent,
    ownEstimate, strongestOpponent, winChance, nearWinChance,
    unknownOwn: hands[me].filter((id) => !known.has(id)).length,
  };
}
