/**
 * House bots: Camryn, Camron and Cami.
 *
 * Bots play from knowledge, never from the hidden state as a whole: they only
 * "know" cards they have legitimately seen (their opening peek, cards they drew
 * and kept, peeks and king looks). Knowledge is tracked by card id in
 * `state.botKnown`, which mirrors how a human tracks a physical card that
 * moves around the table.
 *
 * `planBots` is pure: it lists every action a bot would like to take right
 * now, each with a human-like delay. The runner decides when to fire them.
 */

import { cardValue, powerOf } from "./cards";
import { canStick, cardCount, TURN_TIMEOUT_MS } from "./engine";
import type { Action, Card, GameState, Player } from "./types";

export interface BotPlan {
  playerId: string;
  action: Action;
  delayMs: number;
  /** stable key so a runner can recognize "the same intent" across re-plans */
  intent: string;
}

/** Average value of an unknown card in a 54-card Cambio deck. */
const UNKNOWN_VALUE = 5.5;

export type Jitter = (intent: string) => number; // [0,1)

export function planBots(state: GameState, now: number, jitter: Jitter): BotPlan[] {
  const plans: BotPlan[] = [];
  // A paused table has nothing for a bot to do: they already agreed to the
  // pause when it was asked for, and they cannot play until it is lifted.
  if (state.paused) return plans;
  const bots = state.players.filter((p) => p.isBot);

  // Anyone may advance the opening peek once its window has closed.
  if (state.phase === "peek" && state.openingPeekUntil !== null) {
    const actor = bots[0] ?? state.players[0];
    const intent = `advance:${state.round}`;
    plans.push({ playerId: actor.id, action: { type: "advance" }, delayMs: Math.max(0, state.openingPeekUntil - now), intent });
    return plans;
  }
  if (state.phase !== "playing" && state.phase !== "final") return plans;

  // Idle humans: the table does not wait forever. Any seat may report it.
  const reporter = bots[0] ?? state.players[0];
  let due: number | null = null;
  const t = state.turn;
  if (t && !state.players.find((p) => p.id === t.playerId)?.isBot) due = t.startedAt + TURN_TIMEOUT_MS;
  for (const g of state.pendingGives) {
    const from = state.players.find((p) => p.id === g.from);
    if (from && !from.isBot && g.since !== undefined) due = due === null ? g.since + TURN_TIMEOUT_MS : Math.min(due, g.since + TURN_TIMEOUT_MS);
  }
  if (due !== null) {
    plans.push({ playerId: reporter.id, action: { type: "timeout" }, delayMs: Math.max(0, due - now), intent: `timeout:${due}` });
  }

  for (const bot of bots) {
    // 1. Owed cards after a correct stick of someone else's card.
    const give = state.pendingGives.find((g) => g.from === bot.id);
    if (give) {
      const cardId = pickGive(state, bot);
      if (cardId) {
        const intent = `${bot.id}:give:${give.to}:${state.turnsTaken}`;
        plans.push({ playerId: bot.id, action: { type: "give", cardId }, delayMs: ms(1500, 2200, jitter(intent)), intent });
      }
      continue;
    }

    // 2. A pending power to resolve.
    const pp = state.pendingPower;
    if (pp && pp.playerId === bot.id) {
      const action = resolvePower(state, bot);
      const intent = `${bot.id}:power:${pp.kind}:${pp.looked ? "decide" : "look"}:${state.turnsTaken}`;
      plans.push({ playerId: bot.id, action, delayMs: ms(1900, 2800, jitter(intent)), intent });
      continue;
    }

    // 3. Sticks: react to the top of the discard from knowledge.
    if (canStick(state, bot.id)) {
      const target = pickStick(state, bot);
      if (target) {
        const intent = `${bot.id}:stick:${target}`;
        plans.push({ playerId: bot.id, action: { type: "stick", cardId: target }, delayMs: ms(1300, 2600, jitter(intent)), intent });
      }
    }

    // 4. Own turn.
    const t = state.turn;
    if (t && t.playerId === bot.id) {
      if (t.stage === "draw") {
        if (shouldCallCambio(state, bot)) {
          const intent = `${bot.id}:cambio:${state.turnsTaken}`;
          plans.push({ playerId: bot.id, action: { type: "callCambio" }, delayMs: ms(2100, 3000, jitter(intent)), intent });
        } else {
          const intent = `${bot.id}:draw:${state.turnsTaken}`;
          plans.push({ playerId: bot.id, action: { type: "draw" }, delayMs: ms(1600, 2500, jitter(intent)), intent });
        }
      } else if (t.stage === "decide" && t.drawnCardId) {
        const action = decideDrawn(state, bot, state.cards[t.drawnCardId]);
        const intent = `${bot.id}:decide:${t.drawnCardId}`;
        plans.push({ playerId: bot.id, action, delayMs: ms(2000, 3100, jitter(intent)), intent });
      }
    }
  }
  return plans;
}

/* ------------------------------------------------------------------ */
/* Knowledge helpers                                                   */
/* ------------------------------------------------------------------ */

function knows(state: GameState, bot: Player, cardId: string): boolean {
  return (state.botKnown[bot.id] ?? []).includes(cardId);
}

interface Slot { cardId: string; card: Card | null; value: number | null }

function ownSlots(state: GameState, bot: Player): Slot[] {
  return bot.hand
    .filter((id): id is string => !!id)
    .map((id) => {
      const known = knows(state, bot, id);
      const card = known ? state.cards[id] : null;
      return { cardId: id, card, value: card ? cardValue(card) : null };
    });
}

function worstKnown(slots: Slot[]): Slot | null {
  let worst: Slot | null = null;
  for (const s of slots) if (s.value !== null && (worst === null || s.value > worst.value!)) worst = s;
  return worst;
}

function firstUnknown(slots: Slot[]): Slot | null {
  return slots.find((s) => s.value === null) ?? null;
}

function estimateHand(slots: Slot[]): { total: number; unknown: number } {
  let total = 0;
  let unknown = 0;
  for (const s of slots) {
    if (s.value === null) { total += UNKNOWN_VALUE; unknown += 1; } else total += s.value;
  }
  return { total, unknown };
}

function opponentsOf(state: GameState, bot: Player): Player[] {
  return state.players.filter((p) => p.id !== bot.id && cardCount(p) > 0);
}

/* ------------------------------------------------------------------ */
/* Decisions                                                           */
/* ------------------------------------------------------------------ */

function shouldCallCambio(state: GameState, bot: Player): boolean {
  if (state.phase !== "playing") return false;
  if (state.turnsTaken < 4) return false; // let everyone have a turn first
  const slots = ownSlots(state, bot);
  const { total, unknown } = estimateHand(slots);
  const late = state.turnsTaken >= 16;
  if (unknown === 0) return total <= (late ? 10 : 7);
  if (unknown === 1) return total <= 6;
  return slots.length <= 1 && total <= 5.5;
}

function decideDrawn(state: GameState, bot: Player, drawn: Card): Action {
  const slots = ownSlots(state, bot);
  const v = cardValue(drawn);
  const worst = worstKnown(slots);
  const unknown = firstUnknown(slots);
  const power = powerOf(drawn);

  if (power === "kingLook") {
    // A black king is worth 0: keeping it usually beats the power.
    if (worst && worst.value! >= 3) return { type: "swap", cardId: worst.cardId };
    if (unknown) return { type: "swap", cardId: unknown.cardId };
    return { type: "place" };
  }
  if (power) {
    // 7/8/9/10/J/Q: high-ish cards whose power is the main value. Only keep
    // them when they replace something clearly worse.
    if (worst && worst.value! > v + 1) return { type: "swap", cardId: worst.cardId };
    return { type: "place" };
  }
  if (worst && worst.value! > v) return { type: "swap", cardId: worst.cardId };
  if (unknown && v <= 4) return { type: "swap", cardId: unknown.cardId };
  // Nothing of their own worth improving: a high card can be pushed into the
  // hand of whoever is closest to winning instead of onto the pile.
  if (v >= 9) {
    const dump = dumpTarget(state, bot);
    if (dump) return { type: "swap", cardId: dump };
  }
  return { type: "place" };
}

/** The card of the most dangerous opponent that a high card should replace. */
function dumpTarget(state: GameState, bot: Player): string | null {
  const leader = opponentsOf(state, bot).slice().sort((a, b) => cardCount(a) - cardCount(b))[0];
  if (!leader) return null;
  // A card they have not seen is the one they are least able to plan around;
  // a card the bot knows to be low is the one worth taking away from them.
  let lowest: { id: string; value: number } | null = null;
  for (const id of leader.hand) {
    if (!id || !knows(state, bot, id)) continue;
    const value = cardValue(state.cards[id]);
    if (!lowest || value < lowest.value) lowest = { id, value };
  }
  if (lowest && lowest.value <= 3) return lowest.id;
  return leader.hand.find((id) => id && !knows(state, bot, id)) ?? null;
}

function resolvePower(state: GameState, bot: Player): Action {
  const pp = state.pendingPower!;
  const slots = ownSlots(state, bot);
  const opponents = opponentsOf(state, bot);

  switch (pp.kind) {
    case "peekOwn": {
      const u = firstUnknown(slots);
      return u ? { type: "peekOwn", cardId: u.cardId } : { type: "skipPower" };
    }
    case "peekOther": {
      // Prefer the most dangerous opponent (fewest cards), then an unknown card of theirs.
      const sorted = opponents.slice().sort((a, b) => cardCount(a) - cardCount(b));
      for (const opp of sorted) {
        const target = opp.hand.find((id) => id && !knows(state, bot, id));
        if (target) return { type: "peekOther", cardId: target };
      }
      return { type: "skipPower" };
    }
    case "blindSwap": {
      const worst = worstKnown(slots);
      if (!worst || worst.value! < 7) return { type: "skipPower" };
      // Best case: a card we know to be low in someone else's hand.
      let best: { cardId: string; value: number } | null = null;
      for (const opp of opponents) {
        for (const id of opp.hand) {
          if (!id || !knows(state, bot, id)) continue;
          const val = cardValue(state.cards[id]);
          if (val < worst.value! - 1 && (!best || val < best.value)) best = { cardId: id, value: val };
        }
      }
      if (best) return { type: "blindSwap", cardIdA: worst.cardId, cardIdB: best.cardId };
      // Otherwise dump the high card on the leader for one of their unknowns.
      const leader = opponents.slice().sort((a, b) => cardCount(a) - cardCount(b))[0];
      const target = leader?.hand.find((id) => id && !knows(state, bot, id)) ?? leader?.hand.find((id) => id);
      if (target) return { type: "blindSwap", cardIdA: worst.cardId, cardIdB: target };
      return { type: "skipPower" };
    }
    case "kingLook": {
      if (pp.looked) {
        const a = state.cards[pp.looked.a];
        const b = state.cards[pp.looked.b];
        const aMine = bot.hand.includes(pp.looked.a);
        const bMine = bot.hand.includes(pp.looked.b);
        if (aMine && !bMine) return { type: "kingDecide", swap: cardValue(a) > cardValue(b) };
        if (bMine && !aMine) return { type: "kingDecide", swap: cardValue(b) > cardValue(a) };
        return { type: "kingDecide", swap: false };
      }
      // Look at my most suspicious card and an opponent's most promising one.
      const mine = firstUnknown(slots) ?? worstKnown(slots);
      const oppCandidates: { id: string; score: number }[] = [];
      for (const opp of opponents) {
        for (const id of opp.hand) {
          if (!id) continue;
          const known = knows(state, bot, id);
          const score = known ? cardValue(state.cards[id]) : UNKNOWN_VALUE;
          oppCandidates.push({ id, score });
        }
      }
      oppCandidates.sort((x, y) => x.score - y.score);
      const other = oppCandidates[0];
      if (mine && other) return { type: "kingLook", cardIdA: mine.cardId, cardIdB: other.id };
      // No own cards: look at two different opponents' cards.
      const byOwner = new Map<string, string>();
      for (const opp of opponents) { const id = opp.hand.find((x) => x); if (id) byOwner.set(opp.id, id); }
      const ids = [...byOwner.values()];
      if (ids.length >= 2) return { type: "kingLook", cardIdA: ids[0], cardIdB: ids[1] };
      return { type: "skipPower" };
    }
  }
}

function pickStick(state: GameState, bot: Player): string | null {
  const top = state.cards[state.discard[state.discard.length - 1]];
  const known = state.botKnown[bot.id] ?? [];
  // Own cards first (no card owed), then anyone else's.
  for (const id of bot.hand) if (id && known.includes(id) && state.cards[id].rank === top.rank) return id;
  for (const p of state.players) {
    if (p.id === bot.id) continue;
    for (const id of p.hand) if (id && known.includes(id) && state.cards[id].rank === top.rank) return id;
  }
  return null;
}

function pickGive(state: GameState, bot: Player): string | null {
  const slots = ownSlots(state, bot);
  if (!slots.length) return null;
  const worst = worstKnown(slots);
  if (worst && worst.value! >= 4) return worst.cardId;
  const unknown = firstUnknown(slots);
  if (unknown) return unknown.cardId;
  return worst ? worst.cardId : slots[0].cardId;
}

function ms(min: number, max: number, unit: number): number {
  return Math.round(min + (max - min) * unit);
}
