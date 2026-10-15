/**
 * The shared tactical evaluator: what a seat believes each card and hand is
 * worth, and how a move changes the table, from its own observation only.
 * The frozen strategy and the model features both read it.
 */
import { cardValue, powerOf } from "./cards";
import { expectedCard } from "./bot-knowledge";
import type { BotObservation } from "./bot-observation";
import { cardCount } from "./engine";
import type { Card, Player } from "./types";

/** Whose eyes the evaluator looks through: a seat and its unseen card pool. */
export interface Mind {
  bot: Player;
  pool: number[];
}

export function knows(state: BotObservation, bot: Player, cardId: string): boolean {
  return !!state.cards[cardId] && (state.botKnown[bot.id] ?? []).includes(cardId);
}

export interface Slot { cardId: string; card: Card | null; value: number | null }

export function ownSlots(state: BotObservation, bot: Player): Slot[] {
  return bot.hand
    .filter((id): id is string => !!id)
    .map((id) => {
      const known = knows(state, bot, id);
      const card = known ? state.cards[id]! : null;
      return { cardId: id, card, value: card ? cardValue(card) : null };
    });
}

export function opponentsOf(state: BotObservation, bot: Player): Player[] {
  return state.players.filter((p) => p.id !== bot.id && cardCount(p) > 0);
}

/** What this bot believes another hand is worth, from the cards it has seen of it. */
export function estimateOther(state: BotObservation, brain: Mind, other: Player): number {
  let total = 0;
  for (const id of other.hand) {
    if (!id) continue;
    total += expectedCard(state, brain.bot, id, brain.pool);
  }
  return total;
}

export interface TacticalSlot { id: string; owner: string; value: number; known: boolean }

export function tacticalSlots(state: BotObservation, brain: Mind): TacticalSlot[] {
  return state.players.flatMap((p) => p.hand.filter((id): id is string => !!id).map((id) => ({
    id, owner: p.id, value: expectedCard(state, brain.bot, id, brain.pool), known: knows(state, brain.bot, id),
  })));
}

/** Value a move against the entire table, not simply the opponent with fewest cards. */
export function tacticalGain(state: BotObservation, brain: Mind, changes: Map<string, number>): number {
  const before = state.players.filter((p) => p.id !== brain.bot.id).map((p) => estimateOther(state, brain, p));
  const after = state.players.filter((p) => p.id !== brain.bot.id).map((p, index) => before[index] + (changes.get(p.id) ?? 0));
  const bestChange = Math.min(...after) - Math.min(...before);
  const fieldChange = after.reduce((sum, value, index) => sum + value - before[index], 0);
  return -(changes.get(brain.bot.id) ?? 0) + 0.85 * bestChange + 0.12 * fieldChange;
}

export function tradeGain(state: BotObservation, brain: Mind, a: TacticalSlot, b: TacticalSlot): number {
  return tacticalGain(state, brain, new Map([[a.owner, b.value - a.value], [b.owner, a.value - b.value]]));
}

export function bestTrade(state: BotObservation, brain: Mind, look: boolean) {
  const slots = tacticalSlots(state, brain);
  let best: { a: TacticalSlot; b: TacticalSlot; gain: number } | null = null;
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    const a = slots[i], b = slots[j];
    if (a.owner === b.owner) continue;
    const raw = tradeGain(state, brain, a, b);
    // Looking first adds option value: a bad surprise can be declined. Prefer
    // information about our unknown cards, then the closest opponent's.
    const mineUnknown = [a, b].filter((slot) => slot.owner === brain.bot.id && !slot.known).length;
    const unknown = Number(!a.known) + Number(!b.known);
    const gain = look ? Math.max(0, raw) + mineUnknown * 1.5 + unknown * 0.5 : raw;
    if (!best || gain > best.gain) best = { a, b, gain };
  }
  return best;
}

export function powerGain(state: BotObservation, brain: Mind, card: Card): number {
  switch (powerOf(card)) {
    case "peekOwn": return ownSlots(state, brain.bot).some((slot) => slot.value === null) ? (state.phase === "final" ? 0.4 : 1.7) : 0;
    case "peekOther": return tacticalSlots(state, brain).some((slot) => slot.owner !== brain.bot.id && !slot.known) ? (state.phase === "final" ? 0.3 : 1.2) : 0;
    case "blindSwap": return Math.max(0, bestTrade(state, brain, false)?.gain ?? 0);
    case "kingLook": return Math.max(0, bestTrade(state, brain, true)?.gain ?? 0);
    default: return 0;
  }
}

/** A known discard can set up our sticks or hand an opponent an easy shed. */
export function discardGain(state: BotObservation, brain: Mind, card: Card, slots: TacticalSlot[]): number {
  let own = 0;
  const changes = new Map<string, number>();
  for (const slot of slots) {
    if (!slot.known || state.cards[slot.id]?.rank !== card.rank || slot.value < 0) continue;
    if (slot.owner === brain.bot.id) own += slot.value + 1.4;
    else changes.set(slot.owner, (changes.get(slot.owner) ?? 0) - slot.value);
  }
  // Opponents may not remember the match. Account for that risk without
  // reading their private memory or assuming they always find the stick.
  return own + 0.5 * tacticalGain(state, brain, changes);
}
