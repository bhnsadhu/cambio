/**
 * Model inputs, built only from one seat's observation. Every number here is
 * something that seat could work out at the table: its remembered faces
 * (capped by its level's memory), the face up pile, public positions, and
 * public keeps and pushes, through the same counting and inference the
 * frozen strategy uses. Nothing reads the deck or a face the seat has not
 * seen, so a level's model never knows more than the level does.
 *
 * Candidates are the legal choices at a decision point, scored first by the
 * frozen tactical evaluator. A model only re-ranks them.
 */
import { cardValue } from "./cards";
import type { CambioAssessment } from "./bot-beliefs";
import { expectedCard, unseenValues } from "./bot-knowledge";
import type { BotObservation } from "./bot-observation";
import { discardGain, estimateOther, knows, ownSlots, powerGain, tacticalGain, tacticalSlots, tradeGain, type Mind, type TacticalSlot } from "./bot-tactics";
import type { Action, Card, Player } from "./types";

const OPPONENTS = 3;
const opponentFeatures = (n: number) => [`opp${n}_estimate`, `opp${n}_cards`, `opp${n}_known`, `opp${n}_kept`, `opp${n}_pushed`];

export const CONTEXT_FEATURES: string[] = [
  "laps", "final", "own_cards", "own_unknown", "own_known_sum", "own_estimate", "pool_mean", "pool_size", "deck_size", "discard_size", "lead",
  ...Array.from({ length: OPPONENTS }, (_, index) => opponentFeatures(index + 1)).flat(),
];

export const CALL_FEATURES: string[] = [...CONTEXT_FEATURES, "win_belief", "near_win_belief", "belief_own", "belief_opponent", "belief_gap"];

export const DECISION_KINDS = ["decide", "peekOwn", "peekOther", "blindSwap", "kingLook", "kingDecide", "stick", "give"] as const;
export type DecisionKind = typeof DECISION_KINDS[number];

export const ACTION_FEATURES: string[] = [
  ...CONTEXT_FEATURES,
  ...DECISION_KINDS.map((kind) => `kind_${kind}`),
  "passive", "rule_choice", "rule_score", "rule_margin", "drawn_value", "drawn_power",
  "own_delta", "best_opp_delta", "field_delta", "reveals_own",
  "target_known", "target_value", "target_own", "target_leader",
  "second_known", "second_value", "second_own", "second_leader",
];

/** At most this many candidates are valued per decision: the passive choice, the rule's choice, then the best scored. */
export const MAX_CANDIDATES = 8;

export function mindOf(state: BotObservation, botId: string): Mind {
  const bot = state.players.find((p) => p.id === botId)!;
  return { bot, pool: unseenValues(state, bot) };
}

/** Everything a seat knows about the round as a whole, from its own point of view. */
export function contextFeatures(state: BotObservation, mind: Mind): number[] {
  const { bot } = mind;
  const own = ownSlots(state, bot);
  const known = own.filter((slot) => slot.value !== null);
  const ownEstimate = own.reduce((sum, slot) => sum + expectedCard(state, bot, slot.cardId, mind.pool), 0);
  const inHands = state.players.reduce((sum, p) => sum + p.hand.filter((id) => id !== null).length, 0);
  // A drawn card in someone's hand is public knowledge, even when its face is not.
  const held = state.turn?.stage === "decide" ? 1 : 0;
  const others = state.players.filter((p) => p.id !== bot.id)
    .map((p) => ({ p, estimate: estimateOther(state, mind, p) }))
    .sort((a, b) => a.estimate - b.estimate || a.p.seat - b.p.seat);
  const lead = others.length ? others[0].estimate - ownEstimate : 0;
  const opponents: number[] = [];
  for (let index = 0; index < OPPONENTS; index++) {
    const other = others[index];
    if (!other) { opponents.push(0, 0, 0, 0, 0); continue; }
    const cards = other.p.hand.filter((id): id is string => id !== null);
    opponents.push(
      other.estimate, cards.length,
      cards.filter((id) => knows(state, bot, id)).length,
      cards.filter((id) => state.botHints?.[id] === "kept").length,
      cards.filter((id) => state.botHints?.[id] === "pushed").length,
    );
  }
  return [
    state.turnsTaken / state.players.length, state.phase === "final" ? 1 : 0,
    own.length, own.length - known.length, known.reduce((sum, slot) => sum + slot.value!, 0), ownEstimate,
    mind.pool.reduce((sum, value) => sum + value, 0) / mind.pool.length, mind.pool.length,
    54 - state.discard.length - inHands - held, state.discard.length, lead,
    ...opponents,
  ];
}

/** The call model's inputs: the context plus the gate's own belief rollout. */
export function callFeatures(state: BotObservation, botId: string, belief: Omit<CambioAssessment, "call">): number[] {
  return [
    ...contextFeatures(state, mindOf(state, botId)),
    belief.winChance, belief.nearWinChance, belief.ownEstimate, belief.strongestOpponent, belief.strongestOpponent - belief.ownEstimate,
  ];
}

export interface Candidate {
  /** null is the choice not to stick. */
  action: Action | null;
  features: number[];
  /** The frozen rule would choose this. */
  rule: boolean;
}

export interface Decision {
  kind: DecisionKind;
  /** How many legal choices there were before pruning. */
  legal: number;
  candidates: Candidate[];
}

interface Option {
  action: Action | null;
  score: number;
  passive?: boolean;
  changes?: Map<string, number>;
  targets?: TacticalSlot[];
  reveals?: number;
}

/** Which decision, if any, this seat faces right now, apart from sticking. */
export function decisionKind(state: BotObservation, botId: string): DecisionKind | null {
  if (state.pendingGives.some((give) => give.from === botId)) return "give";
  const pp = state.pendingPower;
  if (pp && pp.playerId === botId) return pp.kind === "kingLook" ? (pp.looked ? "kingDecide" : "kingLook") : pp.kind;
  if (state.turn?.playerId === botId && state.turn.stage === "decide" && state.turn.drawnCardId) return "decide";
  return null;
}

/**
 * The candidates at a decision, each with its features. `ruleAction` is what
 * the frozen rule would do here when focused; it is always kept as a
 * candidate, as is the passive choice (place, skip, leave, or no stick,
 * which is a null action).
 */
export function decisionCandidates(state: BotObservation, botId: string, kind: DecisionKind, ruleAction: Action | null): Decision {
  const mind = mindOf(state, botId);
  const options = optionsFor(state, mind, kind);
  const ruleKey = actionKey(ruleAction);
  const isRule = (option: Option) => actionKey(option.action) === ruleKey;
  const ranked = options.map((option, index) => ({ option, index })).sort((a, b) => b.option.score - a.option.score || a.index - b.index);
  const kept = new Set<number>();
  for (const { option, index } of ranked) if (option.passive || isRule(option)) kept.add(index);
  for (const { index } of ranked) { if (kept.size >= MAX_CANDIDATES) break; kept.add(index); }
  const chosen = options.filter((_, index) => kept.has(index));
  const best = Math.max(...options.map((option) => option.score));
  const context = contextFeatures(state, mind);
  const leader = leaderOf(state, mind);
  const drawn = kind === "decide" ? state.cards[state.turn!.drawnCardId!]! : null;
  const drawnPower = drawn ? powerGain(state, mind, drawn) : 0;
  const before = othersBefore(state, mind);
  return {
    kind,
    legal: options.length,
    candidates: chosen.map((option) => {
      const changes = option.changes ?? new Map<string, number>();
      const after = before.map(({ id, estimate }) => estimate + (changes.get(id) ?? 0));
      const target = (slot: TacticalSlot | undefined) => slot
        ? [slot.known ? 1 : 0, slot.value, slot.owner === mind.bot.id ? 1 : 0, slot.owner === leader ? 1 : 0]
        : [0, 0, 0, 0];
      return {
        action: option.action,
        rule: isRule(option),
        features: [
          ...context,
          ...DECISION_KINDS.map((k) => k === kind ? 1 : 0),
          option.passive ? 1 : 0, isRule(option) ? 1 : 0, option.score, option.score - best,
          drawn ? cardValue(drawn) : 0, drawnPower,
          changes.get(mind.bot.id) ?? 0,
          before.length ? Math.min(...after) - Math.min(...before.map((other) => other.estimate)) : 0,
          after.reduce((sum, value, index) => sum + value - before[index].estimate, 0),
          option.reveals ?? 0,
          ...target(option.targets?.[0]), ...target(option.targets?.[1]),
        ],
      };
    }),
  };
}

/** A stable identity for an action, to compare a candidate with the rule's choice. */
export function actionKey(action: Action | null): string {
  if (!action) return "none";
  switch (action.type) {
    case "swap": case "peekOwn": case "peekOther": case "stick": case "give": return `${action.type}:${action.cardId}`;
    case "blindSwap": case "kingLook": return `${action.type}:${[action.cardIdA, action.cardIdB].sort().join(":")}`;
    case "kingDecide": return `kingDecide:${action.swap}`;
    default: return action.type;
  }
}

function othersBefore(state: BotObservation, mind: Mind) {
  return state.players.filter((p) => p.id !== mind.bot.id).map((p) => ({ id: p.id, estimate: estimateOther(state, mind, p) }));
}

function leaderOf(state: BotObservation, mind: Mind): string | null {
  const others = othersBefore(state, mind);
  if (!others.length) return null;
  return others.reduce((best, other) => other.estimate < best.estimate ? other : best).id;
}

function handOf(state: BotObservation, id: string): Player {
  return state.players.find((p) => p.id === id)!;
}

/**
 * Every legal choice at the decision, scored the way the frozen evaluator
 * scores it. The scores are inputs to the model, not the model's answer.
 */
function optionsFor(state: BotObservation, mind: Mind, kind: DecisionKind): Option[] {
  const me = mind.bot.id;
  const slots = tacticalSlots(state, mind);
  const pairs = () => {
    const list: [TacticalSlot, TacticalSlot][] = [];
    for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
      if (slots[i].owner !== slots[j].owner) list.push([slots[i], slots[j]]);
    }
    return list;
  };
  const tradeChanges = (a: TacticalSlot, b: TacticalSlot) => new Map([[a.owner, b.value - a.value], [b.owner, a.value - b.value]]);
  switch (kind) {
    case "decide": {
      const drawn = state.cards[state.turn!.drawnCardId!]!;
      const v = cardValue(drawn);
      const options: Option[] = [{ action: { type: "place" }, passive: true, score: powerGain(state, mind, drawn) + discardGain(state, mind, drawn, slots) }];
      for (const slot of slots) {
        const changes = new Map([[slot.owner, v - slot.value]]);
        let score = tacticalGain(state, mind, changes);
        if (slot.known) score += discardGain(state, mind, state.cards[slot.id]!, slots.filter((other) => other.id !== slot.id));
        if (slot.owner === me && !slot.known) score += 0.45;
        if (slot.owner !== me && !slot.known) score -= 0.4;
        options.push({ action: { type: "swap", cardId: slot.id }, score, changes, targets: [slot], reveals: slot.owner === me && !slot.known ? 1 : 0 });
      }
      return options;
    }
    case "peekOwn":
      return [
        { action: { type: "skipPower" }, passive: true, score: 0 },
        ...slots.filter((slot) => slot.owner === me && !slot.known).map((slot): Option => ({ action: { type: "peekOwn", cardId: slot.id }, score: slot.value, targets: [slot], reveals: 1 })),
      ];
    case "peekOther":
      return [
        { action: { type: "skipPower" }, passive: true, score: -40 },
        ...slots.filter((slot) => slot.owner !== me && !slot.known).map((slot): Option => ({
          action: { type: "peekOther", cardId: slot.id },
          score: -(estimateOther(state, mind, handOf(state, slot.owner)) + slot.value * 0.5),
          targets: [slot],
        })),
      ];
    case "blindSwap":
      return [
        { action: { type: "skipPower" }, passive: true, score: 0.5 },
        ...pairs().map(([a, b]): Option => ({
          action: { type: "blindSwap", cardIdA: a.id, cardIdB: b.id }, score: tradeGain(state, mind, a, b), changes: tradeChanges(a, b), targets: [a, b],
        })),
      ];
    case "kingLook":
      return [
        { action: { type: "skipPower" }, passive: true, score: 0 },
        ...pairs().map(([a, b]): Option => {
          const mineUnknown = [a, b].filter((slot) => slot.owner === me && !slot.known).length;
          const unknown = Number(!a.known) + Number(!b.known);
          return {
            action: { type: "kingLook", cardIdA: a.id, cardIdB: b.id },
            score: Math.max(0, tradeGain(state, mind, a, b)) + mineUnknown * 1.5 + unknown * 0.5,
            changes: tradeChanges(a, b), targets: [a, b], reveals: mineUnknown,
          };
        }),
      ];
    case "kingDecide": {
      const looked = state.pendingPower!.looked!;
      const a = slots.find((slot) => slot.id === looked.a);
      const b = slots.find((slot) => slot.id === looked.b);
      const leave: Option = { action: { type: "kingDecide", swap: false }, passive: true, score: 0.1 };
      if (!a || !b) return [leave, { action: { type: "kingDecide", swap: true }, score: 0 }];
      return [leave, { action: { type: "kingDecide", swap: true }, score: tradeGain(state, mind, a, b), changes: tradeChanges(a, b), targets: [a, b] }];
    }
    case "stick": {
      const top = state.cards[state.discard[state.discard.length - 1]]!;
      const own = ownSlots(state, mind.bot);
      const give = own.length ? own.reduce((best, slot) => expectedCard(state, mind.bot, slot.cardId, mind.pool) > expectedCard(state, mind.bot, best.cardId, mind.pool) ? slot : best) : null;
      const giveValue = give ? expectedCard(state, mind.bot, give.cardId, mind.pool) : 0;
      const options: Option[] = [{ action: null, passive: true, score: 0 }];
      for (const slot of slots) {
        if (!slot.known || state.cards[slot.id]?.rank !== top.rank) continue;
        if (slot.owner === me) {
          options.push({ action: { type: "stick", cardId: slot.id }, score: slot.value + 1, changes: new Map([[me, -slot.value]]), targets: [slot] });
        } else {
          const changes = new Map([[me, -giveValue], [slot.owner, giveValue - slot.value]]);
          options.push({ action: { type: "stick", cardId: slot.id }, score: tacticalGain(state, mind, changes), changes, targets: [slot] });
        }
      }
      return options;
    }
    case "give":
      return slots.filter((slot) => slot.owner === me).map((slot): Option => ({
        action: { type: "give", cardId: slot.id }, score: slot.value, changes: new Map([[me, -slot.value]]), targets: [slot],
      }));
  }
}

/** The face a stick decision is about: the top of the pile, when this seat remembers a match for it. */
export function stickTop(state: BotObservation, botId: string): Card | null {
  const top = state.cards[state.discard[state.discard.length - 1]];
  if (!top) return null;
  const known = state.botKnown[botId] ?? [];
  const matches = state.players.some((p) => p.hand.some((id) => !!id && known.includes(id) && state.cards[id]?.rank === top.rank));
  return matches ? top : null;
}
