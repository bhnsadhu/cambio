/**
 * House bots: Cameron, Camila and Cami.
 *
 * Bots play from knowledge, never from the hidden state as a whole: they only
 * "know" cards they have legitimately seen (their opening peek, cards they drew
 * and kept, peeks and king looks). Knowledge is tracked by card id in
 * `state.botKnown`, which mirrors how a human tracks a physical card that
 * moves around the table.
 *
 * Each seat plays at its own difficulty:
 *   easy   - loose and forgetful. Lets sticks go by, dithers, and will keep a
 *            card it should have dumped. It plays like someone learning.
 *   medium - the house's basic strategy, and what the bots have always played.
 *   hard   - counts what the pile has swallowed to value the cards it has not
 *            seen, weighs its hand against every other hand at the table, and
 *            reacts to the pile faster than a human comfortably can.
 *
 * `planBots` is pure: it lists every action a bot would like to take right
 * now, each with a human-like delay. The runner decides when to fire them.
 */

import { cardValue, powerOf } from "./cards";
import { assessCambio, expectedCard, unseenValues } from "./bot-beliefs";
export { assessCambio } from "./bot-beliefs";
import { canStick, cardCount, TURN_TIMEOUT_MS } from "./engine";
import type { Action, BotDifficulty, Card, GameState, Player } from "./types";

export interface BotPlan {
  playerId: string;
  action: Action;
  delayMs: number;
  /** stable key so a runner can recognize "the same intent" across re-plans */
  intent: string;
}

/** Average value of an unknown card in a 54-card Cambio deck. */


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
  /** the value this bot puts on a card it has not seen */
  unknown: number;
  pool: number[];
  roll: (tag: string) => number;
}

function brainFor(state: GameState, bot: Player, jitter: Jitter): Brain {
  const diff = bot.difficulty ?? "medium";
  const pool = unseenValues(state, bot);
  return {
    bot,
    diff,
    pool,
    // Only a hard bot bothers counting the pile; the others use the deck average.
    unknown: pool.reduce((sum, value) => sum + value, 0) / pool.length,
    roll: (tag: string) => jitter(`${bot.id}:roll:${tag}`),
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

  for (const bot of bots) {
    const brain = brainFor(state, bot, jitter);
    const pace = PACE[brain.diff];

    // 1. Owed cards after a correct stick of someone else's card.
    const give = state.pendingGives.find((g) => g.from === bot.id);
    if (give) {
      const cardId = pickGive(state, brain);
      if (cardId) {
        const intent = `${bot.id}:give:${give.to}:${state.turnsTaken}`;
        plans.push({ playerId: bot.id, action: { type: "give", cardId }, delayMs: ms(2200, 3200, jitter(intent), pace), intent });
      }
      continue;
    }

    // Sticking remains available while a power is waiting. It does not consume
    // the power, and the next plan resolves it against the remaining cards.
    if (canStick(state, bot.id)) {
      const target = pickStick(state, brain);
      if (target) {
        const top = state.discard.at(-1);
        const intent = `${bot.id}:stick:${top}:${target}`;
        const [lo, hi] = STICK_MS[brain.diff];
        plans.push({ playerId: bot.id, action: { type: "stick", cardId: target }, delayMs: ms(lo, hi, jitter(intent), 1), intent });
      }
    }
    const pp = state.pendingPower;
    if (pp && pp.playerId === bot.id) {
      const action = resolvePower(state, brain);
      const intent = `${bot.id}:power:${pp.kind}:${pp.looked ? "decide" : "look"}:${state.turnsTaken}`;
      plans.push({ playerId: bot.id, action, delayMs: ms(2600, 3800, jitter(intent), pace), intent });
      continue;
    }

    // 4. Own turn.
    const t = state.turn;
    if (t && t.playerId === bot.id) {
      if (t.stage === "draw") {
        if (assessCambio(state, bot.id).call) {
          const intent = `${bot.id}:cambio:${state.turnsTaken}`;
          plans.push({ playerId: bot.id, action: { type: "callCambio" }, delayMs: ms(2800, 4000, jitter(intent), pace), intent });
        } else {
          const intent = `${bot.id}:draw:${state.turnsTaken}`;
          plans.push({ playerId: bot.id, action: { type: "draw" }, delayMs: ms(2200, 3400, jitter(intent), pace), intent });
        }
      } else if (t.stage === "decide" && t.drawnCardId) {
        const action = decideDrawn(state, brain, state.cards[t.drawnCardId]);
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

function opponentsOf(state: GameState, bot: Player): Player[] {
  return state.players.filter((p) => p.id !== bot.id && cardCount(p) > 0);
}

/** The opponent closest to winning: fewest cards, then the lowest hand we can see. */
function leaderOf(state: GameState, brain: Brain): Player | null {
  const opponents = opponentsOf(state, brain.bot);
  if (!opponents.length) return null;
  return opponents
    .slice()
    .sort((a, b) => estimateOther(state, brain, a) - estimateOther(state, brain, b) || cardCount(a) - cardCount(b))[0];
}

/** What this bot believes another hand is worth, from the cards it has seen of it. */
function estimateOther(state: GameState, brain: Brain, other: Player): number {
  let total = 0;
  for (const id of other.hand) {
    if (!id) continue;
    total += expectedCard(state, brain.bot, id, brain.pool);
  }
  return total;
}

function decideDrawn(state: GameState, brain: Brain, drawn: Card): Action {
  const slots = ownSlots(state, brain.bot);
  const v = cardValue(drawn);
  const worst = worstKnown(slots);
  const unknown = firstUnknown(slots);
  const power = powerOf(drawn);

  if (brain.diff === "hard") return hardDrawn(state, brain, drawn);

  if (brain.diff === "easy") {
    // Plays the card in front of it: often right, often not, and it does not
    // think about anybody else's hand.
    const r = brain.roll(`decide:${drawn.id}`);
    if (r < 0.3) {
      const any = slots[Math.floor(brain.roll(`slot:${drawn.id}`) * slots.length)];
      if (any && v <= 9) return { type: "swap", cardId: any.cardId };
      return { type: "place" };
    }
    if (power && r < 0.75) return { type: "place" };
    if (worst && worst.value! > v) return { type: "swap", cardId: worst.cardId };
    if (unknown && v <= 3) return { type: "swap", cardId: unknown.cardId };
    return { type: "place" };
  }

  if (power === "kingLook") {
    // A black king is worth 0: keeping it usually beats the power.
    const keepAt = 3;
    if (worst && worst.value! >= keepAt) return { type: "swap", cardId: worst.cardId };
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
  // A card worth less than the table's idea of a mystery is worth taking on.
  const unknownFloor = 4;
  if (unknown && v <= unknownFloor) return { type: "swap", cardId: unknown.cardId };
  // Nothing of their own worth improving: a high card can be pushed into the
  // hand of whoever is closest to winning instead of onto the pile.
  if (v >= 9) {
    const dump = dumpTarget(state, brain);
    if (dump) return { type: "swap", cardId: dump };
  }
  return { type: "place" };
}

/** The card of the most dangerous opponent that a high card should replace. */
function dumpTarget(state: GameState, brain: Brain): string | null {
  const leader = leaderOf(state, brain);
  if (!leader) return null;
  // A card they have not seen is the one they are least able to plan around;
  // a card the bot knows to be low is the one worth taking away from them.
  let lowest: { id: string; value: number } | null = null;
  for (const id of leader.hand) {
    if (!id || !knows(state, brain.bot, id)) continue;
    const value = cardValue(state.cards[id]);
    if (!lowest || value < lowest.value) lowest = { id, value };
  }
  if (lowest && lowest.value <= (brain.diff === "hard" ? 4 : 3)) return lowest.id;
  return leader.hand.find((id) => id && !knows(state, brain.bot, id)) ?? null;
}

function resolvePower(state: GameState, brain: Brain): Action {
  const pp = state.pendingPower!;
  const bot = brain.bot;
  const slots = ownSlots(state, bot);
  const opponents = opponentsOf(state, bot);
  const easy = brain.diff === "easy";
  if (brain.diff === "hard") return hardPower(state, brain);
  if (easy && !pp.looked && brain.roll(`power-effort:${state.turnsTaken}`) < 0.35) return { type: "skipPower" };

  switch (pp.kind) {
    case "peekOwn": {
      const u = firstUnknown(slots);
      if (u) return { type: "peekOwn", cardId: u.cardId };
      // Nothing left to learn about its own hand.
      return easy && slots.length ? { type: "peekOwn", cardId: slots[0].cardId } : { type: "skipPower" };
    }
    case "peekOther": {
      if (easy) {
        // Looks wherever, and sometimes cannot be bothered.
        const all = opponents.flatMap((p) => p.hand.filter((id): id is string => !!id));
        if (!all.length) return { type: "skipPower" };
        return { type: "peekOther", cardId: all[Math.floor(brain.roll(`peek:${state.turnsTaken}`) * all.length)] };
      }
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
      const floor = easy ? 5 : 7;
      if (!worst || worst.value! < floor) return { type: "skipPower" };
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
      const leader = easy ? opponents[0] : leaderOf(state, brain);
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
        // Easy saw both cards and still gets it wrong sometimes.
        const muddle = easy && brain.roll(`king:${pp.looked.a}`) < 0.3;
        if (aMine && !bMine) return { type: "kingDecide", swap: muddle ? cardValue(a) < cardValue(b) : cardValue(a) > cardValue(b) };
        if (bMine && !aMine) return { type: "kingDecide", swap: muddle ? cardValue(b) < cardValue(a) : cardValue(b) > cardValue(a) };
        return { type: "kingDecide", swap: false };
      }
      // Look at my most suspicious card and an opponent's most promising one.
      const mine = firstUnknown(slots) ?? worstKnown(slots);
      const oppCandidates: { id: string; score: number }[] = [];
      for (const opp of opponents) {
        for (const id of opp.hand) {
          if (!id) continue;
          const known = knows(state, bot, id);
          const score = known ? cardValue(state.cards[id]) : brain.unknown;
          oppCandidates.push({ id, score });
        }
      }
      if (easy) {
        // Looks at a pair at random rather than at the pair that matters.
        const shuffleKey = (x: { id: string }) => brain.roll(`king-look:${x.id}`);
        oppCandidates.sort((x, y) => shuffleKey(x) - shuffleKey(y));
      } else {
        oppCandidates.sort((x, y) => x.score - y.score);
      }
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

interface TacticalSlot { id: string; owner: string; value: number; known: boolean }

function tacticalSlots(state: GameState, brain: Brain): TacticalSlot[] {
  return state.players.flatMap((p) => p.hand.filter((id): id is string => !!id).map((id) => ({
    id, owner: p.id, value: expectedCard(state, brain.bot, id, brain.pool), known: knows(state, brain.bot, id),
  })));
}

/** Value a move against the entire table, not simply the opponent with fewest cards. */
function tacticalGain(state: GameState, brain: Brain, changes: Map<string, number>): number {
  const before = state.players.filter((p) => p.id !== brain.bot.id).map((p) => estimateOther(state, brain, p));
  const after = state.players.filter((p) => p.id !== brain.bot.id).map((p, index) => before[index] + (changes.get(p.id) ?? 0));
  const bestChange = Math.min(...after) - Math.min(...before);
  const fieldChange = after.reduce((sum, value, index) => sum + value - before[index], 0);
  return -(changes.get(brain.bot.id) ?? 0) + 0.85 * bestChange + 0.12 * fieldChange;
}

function tradeGain(state: GameState, brain: Brain, a: TacticalSlot, b: TacticalSlot): number {
  return tacticalGain(state, brain, new Map([[a.owner, b.value - a.value], [b.owner, a.value - b.value]]));
}

function bestTrade(state: GameState, brain: Brain, look: boolean) {
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

function powerGain(state: GameState, brain: Brain, card: Card): number {
  switch (powerOf(card)) {
    case "peekOwn": return ownSlots(state, brain.bot).some((slot) => slot.value === null) ? (state.phase === "final" ? 0.4 : 1.7) : 0;
    case "peekOther": return tacticalSlots(state, brain).some((slot) => slot.owner !== brain.bot.id && !slot.known) ? (state.phase === "final" ? 0.3 : 1.2) : 0;
    case "blindSwap": return Math.max(0, bestTrade(state, brain, false)?.gain ?? 0);
    case "kingLook": return Math.max(0, bestTrade(state, brain, true)?.gain ?? 0);
    default: return 0;
  }
}

function hardDrawn(state: GameState, brain: Brain, drawn: Card): Action {
  const slots = tacticalSlots(state, brain);
  const v = cardValue(drawn);
  const ownMatches = slots.filter((slot) => slot.owner === brain.bot.id && slot.known && state.cards[slot.id].rank === drawn.rank && slot.value >= 0);
  // Laying a matching rank can shed multiple remembered cards, which a
  // one-card greedy replacement misses entirely.
  let best = powerGain(state, brain, drawn) + ownMatches.reduce((sum, slot) => sum + slot.value + 1.4, 0);
  let action: Action = { type: "place" };
  for (const slot of slots) {
    const delta = v - slot.value;
    let gain = tacticalGain(state, brain, new Map([[slot.owner, delta]]));
    // Replacing an unknown own card also makes its new face certain.
    if (slot.owner === brain.bot.id && !slot.known) gain += 0.45;
    // Avoid buying a tiny estimated improvement with a speculative attack.
    if (slot.owner !== brain.bot.id && !slot.known) gain -= 0.4;
    if (gain > best + 0.15) { best = gain; action = { type: "swap", cardId: slot.id }; }
  }
  return action;
}

function hardPower(state: GameState, brain: Brain): Action {
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

function pickStick(state: GameState, brain: Brain): string | null {
  const bot = brain.bot;
  const top = state.cards[state.discard[state.discard.length - 1]];
  const known = state.botKnown[bot.id] ?? [];
  const matches = (id: string | null): boolean => !!id && known.includes(id) && state.cards[id].rank === top.rank;

  if (brain.diff === "easy") {
    // Slow on the draw: a match it has seen often goes by unnoticed, and it
    // only really watches its own hand.
    if (state.botMissedTop?.[bot.id] === top.id || brain.roll(`see:${top.id}`) < 0.45) return null;
    const own = bot.hand.find(matches);
    if (own) return own;
    if (brain.roll(`reach:${top.id}`) < 0.4) {
      for (const p of state.players) {
        if (p.id === bot.id) continue;
        const hit = p.hand.find(matches);
        if (hit) return hit;
      }
    }
    // And sometimes it is simply sure, and simply wrong.
    if (brain.roll(`guess:${top.id}`) < 0.08) {
      const blind = bot.hand.filter((id): id is string => !!id && !known.includes(id));
      if (blind.length) return blind[Math.floor(brain.roll(`which:${top.id}`) * blind.length)];
    }
    return null;
  }

  // Own cards first: sticking one costs nothing, sticking someone else's
  // costs a card out of this hand (but lets it choose which).
  const own = bot.hand.find((id) => matches(id) && (brain.diff !== "hard" || cardValue(state.cards[id!]) >= 0 || cardCount(bot) === 1));
  if (own) return own;
  const others = brain.diff === "hard"
    ? opponentsOf(state, bot).slice().sort((a, b) => estimateOther(state, brain, a) - estimateOther(state, brain, b))
    : state.players.filter((p) => p.id !== bot.id);
  for (const p of others) {
    const hit = p.hand.find(matches);
    if (hit) return hit;
  }
  return null;
}

function pickGive(state: GameState, brain: Brain): string | null {
  const slots = ownSlots(state, brain.bot);
  if (!slots.length) return null;
  if (brain.diff === "easy") {
    // Hands over whatever is nearest rather than the card it wants gone.
    const pick = slots[Math.floor(brain.roll(`give:${state.turnsTaken}`) * slots.length)];
    if (pick) return pick.cardId;
  }
  if (brain.diff === "hard") return slots.slice().sort((a, b) => expectedCard(state, brain.bot, b.cardId, brain.pool) - expectedCard(state, brain.bot, a.cardId, brain.pool))[0].cardId;
  const worst = worstKnown(slots);
  if (worst && worst.value! >= 4) return worst.cardId;
  const unknown = firstUnknown(slots);
  if (unknown) return unknown.cardId;
  return worst ? worst.cardId : slots[0].cardId;
}

/** A human-like delay in the given window, stretched or cut by difficulty. */
function ms(min: number, max: number, unit: number, pace: number): number {
  return Math.round((min + (max - min) * unit) * pace);
}
