/**
 * House bots: Cameron, Camila, Cami and Camille.
 *
 * Bots play from knowledge, never from the hidden state as a whole: they only
 * "know" cards they have legitimately seen (their opening peek, cards they drew
 * and kept, peeks and king looks). Knowledge is tracked by card id in
 * `state.botKnown`, which mirrors how a human tracks a physical card that
 * moves around the table.
 *
 * Each seat plays at its own difficulty:
 *   easy   - uses the full strategy on 50% of decisions, with short memory,
 *            missed powers and sticks, and careless replacements otherwise.
 *   medium - uses the full strategy on 75% of decisions, with strong memory.
 *   hard   - always uses the full strategy and remembers every observed face.
 * All three share card counting, opponent inference and tactical evaluation;
 * the percentages describe strategic effort, never a promised win rate.
 *
 * `planBots` is pure: it lists every action a bot would like to take right
 * now, each with a human-like delay. The runner decides when to fire them.
 */

import { cardValue, powerOf } from "./cards";
import { assessObservedCambio, expectedCard, unseenValues } from "./bot-beliefs";
export { assessCambio } from "./bot-beliefs";
import { observeBot, type BotObservation } from "./bot-observation";
import { canStick, cardCount, TURN_TIMEOUT_MS } from "./engine";
import type { Action, BotDifficulty, Card, GameState, Player } from "./types";

export interface BotPlan {
  playerId: string;
  action: Action;
  delayMs: number;
  /** stable key so a runner can recognize "the same intent" across re-plans */
  intent: string;
}

export const BOT_SKILL: Record<BotDifficulty, number> = { easy: 0.5, medium: 0.75, hard: 1 };
/**
 * How long each difficulty takes over a decision, against the house pace.
 * The pace itself (the windows below) is set for a human to actually watch:
 * a beat before a bot moves, and a beat between one bot's move and the next,
 * rather than the table flashing through a whole turn at once.
 */
const PACE: Record<BotDifficulty, number> = { easy: 1.35, medium: 1, hard: 0.7 };

/** How fast a stick comes, by difficulty. Hard still beats a human to it, but not unreadably. */
const STICK_MS: Record<BotDifficulty, [number, number]> = {
  easy: [3200, 5200],
  medium: [2000, 3400],
  hard: [1200, 2100],
};

export type Jitter = (intent: string) => number; // [0,1)

/**
 * One bot's frame of mind for a single planning pass: how hard it plays, what
 * it thinks a card it has never seen is worth, and a deterministic coin.
 */
interface Brain {
  bot: Player;
  diff: BotDifficulty;
  pool: number[];
  roll: (tag: string) => number;
  focused: (tag: string) => boolean;
}

function brainFor(state: BotObservation, bot: Player, jitter: Jitter): Brain {
  const diff = bot.difficulty ?? "medium";
  const pool = unseenValues(state, bot);
  const roll = (tag: string) => jitter(`${bot.id}:roll:${state.round}:${tag}`);
  return {
    bot,
    diff,
    pool,
    roll,
    // One stable roll per opportunity: polling the same position must not
    // turn a missed opportunity into repeated chances to notice it.
    focused: (tag: string) => diff === "hard" || roll(`skill:${tag}`) < BOT_SKILL[diff],
  };
}

export function planBots(state: GameState, now: number, jitter: Jitter): BotPlan[] {
  const plans: BotPlan[] = [];
  // A paused table has nothing for a bot to do: they already agreed to the
  // pause when it was asked for, and they cannot play until it is lifted.
  if (state.paused) return plans;
  const bots = state.players.filter((p) => p.isBot);

  // The ready check that opens a round. Bots are in the moment they are
  // asked; the seat that never answers is carried by the deadline instead of
  // holding the table up for good.
  if (state.phase === "ready") {
    for (const bot of bots) {
      if (state.readyIds.includes(bot.id)) continue;
      plans.push({ playerId: bot.id, action: { type: "ready" }, delayMs: 0, intent: `${bot.id}:ready:${state.round}` });
    }
    if (state.readyDeadline !== null && state.players.some((p) => !state.readyIds.includes(p.id))) {
      const reporter = bots[0] ?? state.players[0];
      plans.push({
        playerId: reporter.id,
        action: { type: "timeout" },
        delayMs: Math.max(0, state.readyDeadline - now),
        intent: `ready-timeout:${state.readyDeadline}`,
      });
    }
    return plans;
  }

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
  // Every final placement gets a sticking window. The runner closes it even
  // at all-human tables, so scoring does not depend on a browser watchdog.
  if (state.phase === "final" && state.stickWindowUntil !== null) {
    due = due === null ? state.stickWindowUntil : Math.min(due, state.stickWindowUntil);
  }
  if (due !== null) {
    plans.push({ playerId: reporter.id, action: { type: "timeout" }, delayMs: Math.max(0, due - now), intent: `timeout:${due}` });
  }

  for (const seat of bots) {
    const observed = observeBot(state, seat.id);
    const bot = observed.players.find((p) => p.id === seat.id)!;
    const brain = brainFor(observed, bot, jitter);
    const pace = PACE[brain.diff];

    // 1. Owed cards after a correct stick of someone else's card.
    const give = observed.pendingGives.find((g) => g.from === bot.id);
    if (give) {
      const cardId = pickGive(observed, brain);
      if (cardId) {
        const intent = `${bot.id}:give:${give.to}:${observed.turnsTaken}`;
        plans.push({ playerId: bot.id, action: { type: "give", cardId }, delayMs: ms(2200, 3200, jitter(intent), pace), intent });
      }
      continue;
    }

    // Sticking remains available while a power is waiting. It does not consume
    // the power, and the next plan resolves it against the remaining cards.
    if (canStick(state, bot.id)) {
      const target = pickStick(observed, brain);
      if (target) {
        const top = observed.discard.at(-1);
        const intent = `${bot.id}:stick:${top}:${target}`;
        const [lo, hi] = STICK_MS[brain.diff];
        plans.push({ playerId: bot.id, action: { type: "stick", cardId: target }, delayMs: ms(lo, hi, jitter(intent), 1), intent });
      }
    }
    const pp = observed.pendingPower;
    if (pp && pp.playerId === bot.id) {
      const action = resolvePower(observed, brain);
      const intent = `${bot.id}:power:${pp.kind}:${pp.looked ? "decide" : "look"}:${observed.turnsTaken}`;
      plans.push({ playerId: bot.id, action, delayMs: ms(2600, 3800, jitter(intent), pace), intent });
      continue;
    }

    // 4. Own turn.
    const t = observed.turn;
    if (t && t.playerId === bot.id) {
      if (t.stage === "draw") {
        // Ending the round always passes the same belief gate; difficulty
        // creates weaker moves, never reckless calls or a refusal to finish.
        if (assessObservedCambio(observed, bot.id).call) {
          const intent = `${bot.id}:cambio:${observed.turnsTaken}`;
          plans.push({ playerId: bot.id, action: { type: "callCambio" }, delayMs: ms(2800, 4000, jitter(intent), pace), intent });
        } else {
          const intent = `${bot.id}:draw:${observed.turnsTaken}`;
          plans.push({ playerId: bot.id, action: { type: "draw" }, delayMs: ms(2200, 3400, jitter(intent), pace), intent });
        }
      } else if (t.stage === "decide" && t.drawnCardId) {
        const action = decideDrawn(observed, brain, observed.cards[t.drawnCardId]!);
        const intent = `${bot.id}:decide:${t.drawnCardId}`;
        plans.push({ playerId: bot.id, action, delayMs: ms(2800, 4200, jitter(intent), pace), intent });
      }
    }
  }
  return plans;
}

/* ------------------------------------------------------------------ */
/* Knowledge helpers                                                   */
/* ------------------------------------------------------------------ */

function knows(state: BotObservation, bot: Player, cardId: string): boolean {
  return !!state.cards[cardId] && (state.botKnown[bot.id] ?? []).includes(cardId);
}

interface Slot { cardId: string; card: Card | null; value: number | null }

function ownSlots(state: BotObservation, bot: Player): Slot[] {
  return bot.hand
    .filter((id): id is string => !!id)
    .map((id) => {
      const known = knows(state, bot, id);
      const card = known ? state.cards[id]! : null;
      return { cardId: id, card, value: card ? cardValue(card) : null };
    });
}

function opponentsOf(state: BotObservation, bot: Player): Player[] {
  return state.players.filter((p) => p.id !== bot.id && cardCount(p) > 0);
}

/** What this bot believes another hand is worth, from the cards it has seen of it. */
function estimateOther(state: BotObservation, brain: Brain, other: Player): number {
  let total = 0;
  for (const id of other.hand) {
    if (!id) continue;
    total += expectedCard(state, brain.bot, id, brain.pool);
  }
  return total;
}

function decideDrawn(state: BotObservation, brain: Brain, drawn: Card): Action {
  if (brain.focused(`decide:${drawn.id}`)) return strategicDrawn(state, brain, drawn);
  // A lapse is an actual weaker decision, not merely a longer animation.
  // Sometimes keep a mediocre draw without checking what it replaces;
  // otherwise discard it and miss a useful replacement or attack.
  const slots = ownSlots(state, brain.bot);
  if (cardValue(drawn) <= 9 && brain.roll(`keep:${drawn.id}`) < 0.5) {
    const target = slots[Math.floor(brain.roll(`slot:${drawn.id}`) * slots.length)];
    if (target) return { type: "swap", cardId: target.cardId };
  }
  return { type: "place" };
}

function resolvePower(state: BotObservation, brain: Brain): Action {
  const pp = state.pendingPower!;
  const decision = pp.looked ? `decide:${pp.looked.a}:${pp.looked.b}` : "look";
  if (brain.focused(`power:${pp.kind}:${decision}:${state.turnsTaken}`)) return strategicPower(state, brain);
  return pp.looked ? { type: "kingDecide", swap: false } : { type: "skipPower" };
}

interface TacticalSlot { id: string; owner: string; value: number; known: boolean }

function tacticalSlots(state: BotObservation, brain: Brain): TacticalSlot[] {
  return state.players.flatMap((p) => p.hand.filter((id): id is string => !!id).map((id) => ({
    id, owner: p.id, value: expectedCard(state, brain.bot, id, brain.pool), known: knows(state, brain.bot, id),
  })));
}

/** Value a move against the entire table, not simply the opponent with fewest cards. */
function tacticalGain(state: BotObservation, brain: Brain, changes: Map<string, number>): number {
  const before = state.players.filter((p) => p.id !== brain.bot.id).map((p) => estimateOther(state, brain, p));
  const after = state.players.filter((p) => p.id !== brain.bot.id).map((p, index) => before[index] + (changes.get(p.id) ?? 0));
  const bestChange = Math.min(...after) - Math.min(...before);
  const fieldChange = after.reduce((sum, value, index) => sum + value - before[index], 0);
  return -(changes.get(brain.bot.id) ?? 0) + 0.85 * bestChange + 0.12 * fieldChange;
}

function tradeGain(state: BotObservation, brain: Brain, a: TacticalSlot, b: TacticalSlot): number {
  return tacticalGain(state, brain, new Map([[a.owner, b.value - a.value], [b.owner, a.value - b.value]]));
}

function bestTrade(state: BotObservation, brain: Brain, look: boolean) {
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

function powerGain(state: BotObservation, brain: Brain, card: Card): number {
  switch (powerOf(card)) {
    case "peekOwn": return ownSlots(state, brain.bot).some((slot) => slot.value === null) ? (state.phase === "final" ? 0.4 : 1.7) : 0;
    case "peekOther": return tacticalSlots(state, brain).some((slot) => slot.owner !== brain.bot.id && !slot.known) ? (state.phase === "final" ? 0.3 : 1.2) : 0;
    case "blindSwap": return Math.max(0, bestTrade(state, brain, false)?.gain ?? 0);
    case "kingLook": return Math.max(0, bestTrade(state, brain, true)?.gain ?? 0);
    default: return 0;
  }
}

/** A known discard can set up our sticks or hand an opponent an easy shed. */
function discardGain(state: BotObservation, brain: Brain, card: Card, slots: TacticalSlot[]): number {
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

function strategicDrawn(state: BotObservation, brain: Brain, drawn: Card): Action {
  const slots = tacticalSlots(state, brain);
  const v = cardValue(drawn);
  // Laying a matching rank can shed multiple remembered cards, which a
  // one-card greedy replacement misses entirely.
  let best = powerGain(state, brain, drawn) + discardGain(state, brain, drawn, slots);
  let action: Action = { type: "place" };
  for (const slot of slots) {
    const delta = v - slot.value;
    let gain = tacticalGain(state, brain, new Map([[slot.owner, delta]]));
    if (slot.known) gain += discardGain(state, brain, state.cards[slot.id]!, slots.filter((other) => other.id !== slot.id));
    // Replacing an unknown own card also makes its new face certain.
    if (slot.owner === brain.bot.id && !slot.known) gain += 0.45;
    // Avoid buying a tiny estimated improvement with a speculative attack.
    if (slot.owner !== brain.bot.id && !slot.known) gain -= 0.4;
    if (gain > best + 0.15) { best = gain; action = { type: "swap", cardId: slot.id }; }
  }
  return action;
}

function strategicPower(state: BotObservation, brain: Brain): Action {
  const pp = state.pendingPower!;
  const slots = tacticalSlots(state, brain);
  switch (pp.kind) {
    case "peekOwn": {
      const target = slots.filter((slot) => slot.owner === brain.bot.id && !slot.known).sort((a, b) => b.value - a.value)[0];
      return target ? { type: "peekOwn", cardId: target.id } : { type: "skipPower" };
    }
    case "peekOther": {
      // Opponents' own keeps are promising swap/stick targets; prioritize the
      // actual estimated leader rather than blindly following hand size.
      const target = slots.filter((slot) => slot.owner !== brain.bot.id && !slot.known).sort((a, b) => {
        const hand = (id: string) => estimateOther(state, brain, state.players.find((p) => p.id === id)!);
        return hand(a.owner) + a.value * 0.5 - hand(b.owner) - b.value * 0.5;
      })[0];
      return target ? { type: "peekOther", cardId: target.id } : { type: "skipPower" };
    }
    case "blindSwap": {
      const trade = bestTrade(state, brain, false);
      return trade && trade.gain > 0.5 ? { type: "blindSwap", cardIdA: trade.a.id, cardIdB: trade.b.id } : { type: "skipPower" };
    }
    case "kingLook": {
      if (pp.looked) {
        const a = slots.find((slot) => slot.id === pp.looked!.a);
        const b = slots.find((slot) => slot.id === pp.looked!.b);
        return { type: "kingDecide", swap: !!a && !!b && tradeGain(state, brain, a, b) > 0.1 };
      }
      const trade = bestTrade(state, brain, true);
      return trade ? { type: "kingLook", cardIdA: trade.a.id, cardIdB: trade.b.id } : { type: "skipPower" };
    }
  }
}

function pickStick(state: BotObservation, brain: Brain): string | null {
  const bot = brain.bot;
  const top = state.cards[state.discard[state.discard.length - 1]];
  if (!top) return null;
  const known = state.botKnown[bot.id] ?? [];
  const matches = (id: string | null): boolean => !!id && known.includes(id) && state.cards[id]?.rank === top.rank;

  if (state.botMissedTop?.[bot.id] === top.id) return null;
  if (!brain.focused(`stick:${top.id}`)) return null;

  // Own cards first: sticking one costs nothing, sticking someone else's
  // costs a card out of this hand (but lets it choose which).
  const own = bot.hand.find((id) => matches(id) && cardValue(state.cards[id!]!) >= 0);
  if (own) return own;
  const others = opponentsOf(state, bot).sort((a, b) => estimateOther(state, brain, a) - estimateOther(state, brain, b));
  for (const p of others) {
    const hit = p.hand.find(matches);
    if (!hit) continue;
    const give = pickGive(state, brain);
    if (!give) continue;
    const value = expectedCard(state, bot, give, brain.pool);
    const gain = tacticalGain(state, brain, new Map([[bot.id, -value], [p.id, value - cardValue(state.cards[hit]!)]]));
    if (gain <= 0) continue;
    return hit;
  }
  return null;
}

function pickGive(state: BotObservation, brain: Brain): string | null {
  const slots = ownSlots(state, brain.bot);
  if (!slots.length) return null;
  const debt = state.pendingGives.find((give) => give.from === brain.bot.id);
  if (!brain.focused(`give:${debt?.to ?? "stick"}:${state.turnsTaken}`)) {
    return slots[Math.floor(brain.roll(`give-slot:${state.turnsTaken}`) * slots.length)].cardId;
  }
  return slots.sort((a, b) => expectedCard(state, brain.bot, b.cardId, brain.pool) - expectedCard(state, brain.bot, a.cardId, brain.pool))[0].cardId;
}

/** A human-like delay in the given window, stretched or cut by difficulty. */
function ms(min: number, max: number, unit: number, pace: number): number {
  return Math.round((min + (max - min) * unit) * pace);
}
