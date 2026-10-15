/**
 * What a seat believes about cards it has not seen: the unseen pool after
 * card counting, and each card's expected value after inference from public
 * keeps and pushes. Only legitimately observed faces enter.
 */
import { cardValue } from "./cards";
import type { BotObservation } from "./bot-observation";
import type { Player } from "./types";

const DECK_VALUES = [
  ...Array.from({ length: 4 }, () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10]).flat(),
  -1, -1, 0, 0, 0, 0,
];

/** Only legitimately observed faces enter the belief model. */
export function unseenValues(state: Pick<BotObservation, "cards" | "discard" | "botKnown">, bot: Player): number[] {
  const pool = DECK_VALUES.slice();
  // Evaluation only: without counting, every unseen card comes from a full deck.
  if (bot.strategy?.counting === false) return pool;
  for (const id of new Set([...state.discard, ...(state.botKnown[bot.id] ?? [])])) {
    const card = state.cards[id];
    if (!card) continue;
    const index = pool.indexOf(cardValue(card));
    if (index >= 0) pool.splice(index, 1);
  }
  return pool.length ? pool : DECK_VALUES.slice();
}

export function weight(state: Pick<BotObservation, "botHints">, id: string, value: number, inference = true): number {
  if (!inference) return 1;
  return clueWeight(state.botHints?.[id], value);
}

/** How much a card's public clue, if any, favors one possible value. */
export function clueWeight(clue: "kept" | "pushed" | undefined, value: number): number {
  // A keep/push is evidence of intent, not proof of a face. Even a high kept
  // card or a low pushed card retains probability, so opponents can bluff.
  if (clue === "kept") return value <= 3 ? 3 : value <= 6 ? 1.5 : 0.65;
  if (clue === "pushed") return value >= 7 ? 3 : value >= 4 ? 1.3 : 0.6;
  return 1;
}

export function expectedCard(state: BotObservation, bot: Player, id: string, pool = unseenValues(state, bot)): number {
  if ((state.botKnown[bot.id] ?? []).includes(id) && state.cards[id]) return cardValue(state.cards[id]);
  let total = 0, weights = 0;
  const inference = bot.strategy?.inference !== false;
  for (const value of pool) {
    const w = weight(state, id, value, inference);
    total += value * w;
    weights += w;
  }
  return total / weights;
}
