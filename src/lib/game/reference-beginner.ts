/**
 * The beginner: a reference player for the evaluation harness only, never
 * seated at a live table. Written to the rule pre-registered for H10 to H15
 * in docs/experiments/bot-evaluation.md.
 *
 * It keeps only its two opening peeks: it knows the two cards it saw at the
 * start and, after swapping a drawn card into one of those slots, the card
 * it put there; a known card that leaves its hand is forgotten. It draws from
 * the deck, swaps a drawn card into the slot holding its highest known card
 * when the drawn card is lower and otherwise discards it, never sticks, skips
 * every power, and calls Cambio only when its known cards total at most
 * BEGINNER_CALL_TOTAL, after one full lap of turns.
 *
 * It reads only its own hand's positions, the faces it knows, and the card it
 * has just drawn.
 */
import type { BotPlan } from "./bots";
import { cardValue } from "./cards";
import type { Action, GameState } from "./types";

export const BEGINNER_CALL_TOTAL = 2;

export interface ReferencePlayer {
  playerId: string;
  plan: (state: GameState) => BotPlan[];
}

export function beginner(playerId: string, opening: string[]): ReferencePlayer {
  let known = new Set(opening);
  let pending: { drawn: string; replaced: string } | null = null;

  const plan = (state: GameState): BotPlan[] => {
    const me = state.players.find((p) => p.id === playerId)!;
    const hand = me.hand.filter((id): id is string => !!id);
    if (pending) {
      if (hand.includes(pending.drawn)) {
        known.delete(pending.replaced);
        known.add(pending.drawn);
        pending = null;
      } else if (state.turn?.drawnCardId !== pending.drawn) pending = null;
    }
    known = new Set([...known].filter((id) => hand.includes(id)));

    const plans: BotPlan[] = [];
    const push = (action: Action, intent: string) => plans.push({ playerId, action, delayMs: 1000, intent: `${playerId}:${intent}` });
    if (state.paused) return plans;
    if (state.phase === "ready") {
      if (!state.readyIds.includes(playerId)) push({ type: "ready" }, `ready:${state.round}`);
      return plans;
    }
    if (state.phase !== "playing" && state.phase !== "final") return plans;

    const give = state.pendingGives.find((g) => g.from === playerId);
    if (give) {
      const cardId = hand.find((id) => !known.has(id)) ?? hand[0];
      if (cardId) push({ type: "give", cardId }, `give:${give.to}:${state.turnsTaken}`);
      return plans;
    }
    const pp = state.pendingPower;
    if (pp && pp.playerId === playerId) {
      push({ type: "skipPower" }, `power:${pp.kind}:${state.turnsTaken}`);
      return plans;
    }
    const turn = state.turn;
    if (!turn || turn.playerId !== playerId) return plans;
    if (turn.stage === "draw") {
      const total = [...known].reduce((sum, id) => sum + cardValue(state.cards[id]), 0);
      const ready = state.phase === "playing" && state.turnsTaken >= state.players.length;
      if (ready && total <= BEGINNER_CALL_TOTAL) push({ type: "callCambio" }, `cambio:${state.turnsTaken}`);
      else push({ type: "draw" }, `draw:${state.turnsTaken}`);
    } else if (turn.stage === "decide" && turn.drawnCardId) {
      const drawn = state.cards[turn.drawnCardId];
      const highest = [...known].sort((a, b) => cardValue(state.cards[b]) - cardValue(state.cards[a]))[0];
      if (highest && cardValue(drawn) < cardValue(state.cards[highest])) {
        pending = { drawn: drawn.id, replaced: highest };
        push({ type: "swap", cardId: highest }, `decide:${drawn.id}`);
      } else push({ type: "place" }, `decide:${drawn.id}`);
    }
    return plans;
  };
  return { playerId, plan };
}
