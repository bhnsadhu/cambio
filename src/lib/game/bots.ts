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

import { cardValue } from "./cards";
import { assessObservedCambio } from "./bot-beliefs";
import { expectedCard, unseenValues } from "./bot-knowledge";
import { bestTrade, discardGain, estimateOther, opponentsOf, ownSlots, powerGain, tacticalGain, tacticalSlots, tradeGain, type Mind, type Slot } from "./bot-tactics";
export { assessCambio } from "./bot-beliefs";
import { observeBot, type BotObservation } from "./bot-observation";
import { decisionCandidates, type DecisionKind } from "./bot-features";
import { predict } from "./bot-models";
import { ACTION_MODELS, actionModelShareOf, actionPolicyOf, actionTopKOf } from "./bot-policies";
import { canStick, TURN_TIMEOUT_MS } from "./engine";
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
 * Observe only: what a planning pass did, for the level audit and the speed
 * measurement. Nothing a bot decides depends on whether an observer is
 * attached; bot-policies.test.ts plays the same rounds with and without one.
 */
export interface BotObserver {
  /** Every effort roll: the opportunity's tag and whether the bot was focused. */
  effort?(event: { botId: string; level: BotDifficulty; tag: string; focused: boolean }): void;
  /** At each decision: the faces the bot remembers, its own cards, and every card in a hand. */
  memory?(event: { botId: string; level: BotDifficulty; known: string[]; own: string[]; table: string[] }): void;
  /** A stick opportunity: whether the full strategy would stick, whether the bot tried, and whether its target is a remembered match. */
  stick?(event: { botId: string; level: BotDifficulty; topId: string; wanted: boolean; tried: boolean; rememberedMatch: boolean | null }): void;
  /** The first choice of a power: whether the full strategy would use it, and whether the bot skipped it. */
  power?(event: { botId: string; level: BotDifficulty; intent: string; wanted: boolean; skipped: boolean }): void;
  /** An unfocused bot keeping a draw without checking what it replaces. */
  lapseKeep?(event: { botId: string; level: BotDifficulty; cardId: string }): void;
  /** Every planned action and its human paced delay. */
  plan?(event: { botId: string; level: BotDifficulty; intent: string; action: Action; delayMs: number }): void;
  /** Time spent on one decision made by a learned action model. */
  modelDecision?(event: { level: BotDifficulty; kind: DecisionKind; ms: number }): void;
}

/**
 * One bot's frame of mind for a single planning pass: how hard it plays, what
 * it thinks a card it has never seen is worth, and a deterministic coin.
 */
interface Brain extends Mind {
  diff: BotDifficulty;
  roll: (tag: string) => number;
  focused: (tag: string) => boolean;
  /** What a focused bot does, by its action policy. */
  rules: ActionRules;
  observer?: BotObserver;
}

/**
 * The choices a focused bot makes. Lapses, effort rolls and memory belong to
 * the level, not to the policy, so every policy keeps them.
 */
interface ActionRules {
  drawn: (state: BotObservation, brain: Brain, drawn: Card) => Action;
  power: (state: BotObservation, brain: Brain) => Action;
  /** Which remembered match to stick on the top card, if any. */
  stick: (state: BotObservation, brain: Brain, top: Card) => string | null;
  give: (state: BotObservation, brain: Brain, slots: Slot[]) => string;
}

function brainFor(state: BotObservation, bot: Player, jitter: Jitter, observer?: BotObserver): Brain {
  const diff = bot.difficulty ?? "medium";
  const pool = unseenValues(state, bot);
  const roll = (tag: string) => jitter(`${bot.id}:roll:${state.round}:${tag}`);
  // One stable roll per opportunity: polling the same position must not
  // turn a missed opportunity into repeated chances to notice it.
  const focused = (tag: string) => diff === "hard" || roll(`skill:${tag}`) < BOT_SKILL[diff];
  return {
    bot,
    diff,
    pool,
    roll,
    focused: observer?.effort ? (tag: string) => {
      const result = focused(tag);
      observer.effort!({ botId: bot.id, level: diff, tag, focused: result });
      return result;
    } : focused,
    rules: actionRulesFor(bot),
    observer,
  };
}

export function planBots(state: GameState, now: number, jitter: Jitter, observer?: BotObserver): BotPlan[] {
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

  // Observations for each seat are reported once every seat has planned.
  const reports: (() => void)[] = [];
  for (const seat of bots) {
    const observed = observeBot(state, seat.id);
    const bot = observed.players.find((p) => p.id === seat.id)!;
    const brain = brainFor(observed, bot, jitter, observer);
    const pace = PACE[brain.diff];
    const planned = plans.length;
    if (observer) {
      // Runs after this seat's planning, whichever way it returns below.
      // Later seats push their own plans after this one, so keep this seat's only.
      reports.push(() => observeDecision(observed, bot, brain.diff, plans.slice(planned).filter((plan) => plan.playerId === bot.id), observer));
    }

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
      if (observer?.stick) observeStick(observed, bot, jitter, target, observer);
    }
    const pp = observed.pendingPower;
    if (pp && pp.playerId === bot.id) {
      const action = resolvePower(observed, brain);
      const intent = `${bot.id}:power:${pp.kind}:${pp.looked ? "decide" : "look"}:${observed.turnsTaken}`;
      plans.push({ playerId: bot.id, action, delayMs: ms(2600, 3800, jitter(intent), pace), intent });
      if (observer?.power && !pp.looked) {
        const wanted = strategicPower(observed, quietBrain(observed, bot, jitter)).type !== "skipPower";
        observer.power({ botId: bot.id, level: brain.diff, intent, wanted, skipped: action.type === "skipPower" });
      }
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
  for (const report of reports) report();
  return plans;
}

/** A brain with the same rolls that plays rules_v1 and reports nothing: what the full strategy would do. */
function quietBrain(state: BotObservation, bot: Player, jitter: Jitter): Brain {
  return { ...brainFor(state, bot, jitter), rules: RULES_V1 };
}

function observeDecision(state: BotObservation, bot: Player, level: BotDifficulty, own: BotPlan[], observer: BotObserver) {
  if (!own.length) return;
  const drawn = state.turn?.playerId === bot.id ? state.turn.drawnCardId : null;
  observer.memory?.({
    botId: bot.id, level,
    known: [...(state.botKnown[bot.id] ?? [])],
    own: [...bot.hand.filter((id): id is string => !!id), ...(drawn ? [drawn] : [])],
    table: state.players.flatMap((p) => p.hand.filter((id): id is string => !!id)),
  });
  for (const plan of own) observer.plan?.({ botId: bot.id, level, intent: plan.intent, action: plan.action, delayMs: plan.delayMs });
}

function observeStick(state: BotObservation, bot: Player, jitter: Jitter, target: string | null, observer: BotObserver) {
  const top = state.cards[state.discard[state.discard.length - 1]];
  if (!top || state.botMissedTop?.[bot.id] === top.id) return;
  const wanted = strategicStick(state, quietBrain(state, bot, jitter), top) !== null;
  const rememberedMatch = target ? (state.botKnown[bot.id] ?? []).includes(target) && state.cards[target]?.rank === top.rank : null;
  observer.stick!({ botId: bot.id, level: bot.difficulty ?? "medium", topId: top.id, wanted, tried: target !== null, rememberedMatch });
}

function decideDrawn(state: BotObservation, brain: Brain, drawn: Card): Action {
  if (brain.focused(`decide:${drawn.id}`)) return brain.rules.drawn(state, brain, drawn);
  // A lapse is an actual weaker decision, not merely a longer animation.
  // Sometimes keep a mediocre draw without checking what it replaces;
  // otherwise discard it and miss a useful replacement or attack.
  const slots = ownSlots(state, brain.bot);
  if (cardValue(drawn) <= 9 && brain.roll(`keep:${drawn.id}`) < 0.5) {
    const target = slots[Math.floor(brain.roll(`slot:${drawn.id}`) * slots.length)];
    if (target) {
      brain.observer?.lapseKeep?.({ botId: brain.bot.id, level: brain.diff, cardId: drawn.id });
      return { type: "swap", cardId: target.cardId };
    }
  }
  return { type: "place" };
}

function resolvePower(state: BotObservation, brain: Brain): Action {
  const pp = state.pendingPower!;
  const decision = pp.looked ? `decide:${pp.looked.a}:${pp.looked.b}` : "look";
  if (brain.focused(`power:${pp.kind}:${decision}:${state.turnsTaken}`)) return brain.rules.power(state, brain);
  return pp.looked ? { type: "kingDecide", swap: false } : { type: "skipPower" };
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

  if (state.botMissedTop?.[bot.id] === top.id) return null;
  if (!brain.focused(`stick:${top.id}`)) return null;
  return brain.rules.stick(state, brain, top);
}

function strategicStick(state: BotObservation, brain: Brain, top: Card): string | null {
  const bot = brain.bot;
  const known = state.botKnown[bot.id] ?? [];
  const matches = (id: string | null): boolean => !!id && known.includes(id) && state.cards[id]?.rank === top.rank;

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
  return brain.rules.give(state, brain, slots);
}

function strategicGive(state: BotObservation, brain: Brain, slots: Slot[]): string {
  return slots.sort((a, b) => expectedCard(state, brain.bot, b.cardId, brain.pool) - expectedCard(state, brain.bot, a.cardId, brain.pool))[0].cardId;
}

/**
 * What rules_v1 does at a decision when the seat is focused, whatever the
 * seat's own policy. Model features compare every candidate against it.
 */
export function rulesV1Choice(state: BotObservation, botId: string, kind: DecisionKind): Action | null {
  const bot = state.players.find((p) => p.id === botId)!;
  const brain: Brain = { ...brainFor(state, bot, () => 0), rules: RULES_V1 };
  switch (kind) {
    case "decide": return strategicDrawn(state, brain, state.cards[state.turn!.drawnCardId!]!);
    case "stick": {
      const top = state.cards[state.discard[state.discard.length - 1]];
      const target = top ? strategicStick(state, brain, top) : null;
      return target ? { type: "stick", cardId: target } : null;
    }
    case "give": return { type: "give", cardId: strategicGive(state, brain, ownSlots(state, bot)) };
    default: return strategicPower(state, brain);
  }
}

/** rules_v1: the hand written tactical evaluator above, unchanged since the evaluation began. */
const RULES_V1: ActionRules = { drawn: strategicDrawn, power: strategicPower, stick: strategicStick, give: strategicGive };

/**
 * model_v1: the level's action model re-ranks the candidates the frozen
 * evaluator lists, from the same observation. Decisions the model was not
 * shown to improve on validation keep rules_v1.
 */
const MODEL_V1: ActionRules = {
  drawn: (state, brain) => modelChoice(state, brain, "decide")!,
  power: (state, brain) => {
    const pp = state.pendingPower!;
    return modelChoice(state, brain, pp.kind === "kingLook" ? (pp.looked ? "kingDecide" : "kingLook") : pp.kind)!;
  },
  stick: (state, brain) => {
    const action = modelChoice(state, brain, "stick");
    return action?.type === "stick" ? action.cardId : null;
  },
  give: (state, brain, slots) => {
    const action = modelChoice(state, brain, "give");
    return action?.type === "give" ? action.cardId : strategicGive(state, brain, slots);
  },
};

function modelChoice(state: BotObservation, brain: Brain, kind: DecisionKind): Action | null {
  const started = brain.observer?.modelDecision ? performance.now() : 0;
  const rule = rulesV1Choice(state, brain.bot.id, kind);
  const { kinds, model } = ACTION_MODELS[brain.diff];
  if (!kinds.includes(kind)) return rule;
  // A level made less sharp on purpose keeps the rule on a share of its decisions, with one stable roll per decision.
  const share = actionModelShareOf(brain.diff, brain.bot.strategy);
  if (share < 1 && brain.roll(`model-share:${kind}:${state.turnsTaken}:${state.discard.length}`) >= share) return rule;
  const ranked = decisionCandidates(state, brain.bot.id, kind, rule).candidates
    .map((candidate, index) => ({ candidate, index, value: predict(model, candidate.features) }))
    .sort((a, b) => b.value - a.value || a.index - b.index);
  // Or picks among its top few, again with one stable roll per decision.
  const k = Math.min(actionTopKOf(brain.diff, brain.bot.strategy), ranked.length);
  const pick = k > 1 ? ranked[Math.floor(brain.roll(`model:${kind}:${state.turnsTaken}:${state.discard.length}`) * k)] : ranked[0];
  brain.observer?.modelDecision?.({ level: brain.diff, kind, ms: performance.now() - started });
  return pick.candidate.action;
}

function actionRulesFor(bot: Player): ActionRules {
  switch (actionPolicyOf(bot.difficulty ?? "medium", bot.strategy)) {
    case "rules_v1": return RULES_V1;
    case "model_v1": return MODEL_V1;
  }
}

/** A human-like delay in the given window, stretched or cut by difficulty. */
function ms(min: number, max: number, unit: number, pace: number): number {
  return Math.round((min + (max - min) * unit) * pace);
}
