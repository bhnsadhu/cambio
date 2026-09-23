import { cardValue } from "./cards";
import type { GameState, Player } from "./types";

const DECK_VALUES = [
  ...Array.from({ length: 4 }, () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10]).flat(),
  -1, -1, 0, 0, 0, 0,
];

/** Only legitimately observed faces enter the belief model. */
export function unseenValues(state: GameState, bot: Player): number[] {
  const pool = DECK_VALUES.slice();
  if (bot.difficulty !== "hard") return pool;
  for (const id of new Set([...state.discard, ...(state.botKnown[bot.id] ?? [])])) {
    const card = state.cards[id];
    if (!card) continue;
    const index = pool.indexOf(cardValue(card));
    if (index >= 0) pool.splice(index, 1);
  }
  return pool.length ? pool : DECK_VALUES.slice();
}

function weight(state: GameState, bot: Player, id: string, value: number): number {
  if (bot.difficulty !== "hard") return 1;
  // A keep/push is evidence of intent, not proof of a face. Even a high kept
  // card or a low pushed card retains probability, so opponents can bluff.
  const clue = state.botHints?.[id];
  if (clue === "kept") return value <= 3 ? 3 : value <= 6 ? 1.5 : 0.65;
  if (clue === "pushed") return value >= 7 ? 3 : value >= 4 ? 1.3 : 0.6;
  return 1;
}

export function expectedCard(state: GameState, bot: Player, id: string, pool = unseenValues(state, bot)): number {
  if ((state.botKnown[bot.id] ?? []).includes(id) && state.cards[id]) return cardValue(state.cards[id]);
  let total = 0, weights = 0;
  for (const value of pool) {
    const w = weight(state, bot, id, value);
    total += value * w;
    weights += w;
  }
  return total / weights;
}

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
 * unobserved hands. All tiers use the same cautious decision rule; memory and
 * inference determine how accurately each tier assesses its situation.
 * Opponents get one final draw and their best improving replacement before
 * we compare scores. This deliberately budgets for their last-turn recovery.
 */
export function assessCambio(state: GameState, botId: string): CambioAssessment {
  const bot = state.players.find((p) => p.id === botId)!;
  const known = new Set(state.botKnown[bot.id] ?? []);
  const pool = unseenValues(state, bot);
  const hands = state.players.map((p) => p.hand.filter((id): id is string => !!id));
  const me = state.players.indexOf(bot);
  const sums = state.players.map(() => 0);
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
      let cursor = random() * available.reduce((sum, value) => sum + weight(state, bot, id, value), 0);
      let index = available.length - 1;
      for (let i = 0; i < available.length; i++) {
        cursor -= weight(state, bot, id, available[i]);
        if (cursor <= 0) { index = i; break; }
      }
      const value = available[index];
      if (bot.difficulty === "hard" && available === remaining) remaining.splice(index, 1);
      return value;
    };
    const values = hands.map((hand) => hand.map((id) => known.has(id) && state.cards[id] ? cardValue(state.cards[id]) : take(id)));
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
  return {
    call: state.phase === "playing" && state.turnsTaken >= state.players.length &&
      winChance >= 0.64 && nearWinChance >= 0.8 && ownEstimate <= strongestOpponent,
    ownEstimate, strongestOpponent, winChance, nearWinChance,
    unknownOwn: hands[me].filter((id) => !known.has(id)).length,
  };
}
