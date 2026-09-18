/**
 * Deterministic helpers for engine tests: seeded RNG, sequential ids, and a
 * way to build a table in a chosen state.
 */
import { applyAction, createGame, joinGame, type EngineCtx } from "./engine";
import type { Action, Card, GameState, Rank, Suit } from "./types";

export function seededRng(seed = 1): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    // xorshift32
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 0) / 4294967296;
  };
}

export function makeCtx(seed = 1, now = 1_000_000): EngineCtx & { tick: (ms: number) => void } {
  let n = 0;
  const ctx = {
    now,
    rng: seededRng(seed),
    newId: () => `id${(++n).toString(36).padStart(4, "0")}`,
    tick(ms: number) { ctx.now += ms; },
  };
  return ctx;
}

let actionSeq = 0;
export function act(state: GameState, playerId: string, action: Action, ctx: EngineCtx): GameState {
  return applyAction(state, { actionId: `a${++actionSeq}`, playerId, action }, ctx).state;
}

/** Host + `humans - 1` extra humans; the rest of the seats become bots on start. */
export function table(ctx: EngineCtx, humans = 4) {
  const { state: s0, hostId } = createGame("TEST1", "Host", ctx);
  let state = s0;
  const ids = [hostId];
  for (let i = 1; i < humans; i++) {
    const r = joinGame(state, `P${i + 1}`, ctx);
    state = r.state;
    ids.push(r.playerId);
  }
  return { state, ids, hostId };
}

/** Starts the round and advances past the opening peek. */
export function started(ctx: ReturnType<typeof makeCtx>, humans = 4) {
  const t = table(ctx, humans);
  let state = act(t.state, t.hostId, { type: "start" }, ctx);
  ctx.tick(10_001);
  state = act(state, t.hostId, { type: "advance" }, ctx);
  return { ...t, state };
}

export const card = (id: string, rank: Rank, suit: Suit | null = "S"): Card => ({ id, rank, suit });

/** Overwrite a player's hand and the card registry with chosen cards (test rigging). */
export function rig(state: GameState, playerId: string, cards: Card[]): GameState {
  const s = structuredClone(state);
  const p = s.players.find((x) => x.id === playerId)!;
  for (const old of p.hand) if (old) delete s.cards[old];
  p.hand = [null, null, null, null];
  cards.forEach((c, i) => { s.cards[c.id] = c; p.hand[i] = c.id; });
  return s;
}

/** Put chosen cards on top of the deck (last = top). */
export function rigDeck(state: GameState, cards: Card[]): GameState {
  const s = structuredClone(state);
  for (const c of cards) { s.cards[c.id] = c; s.deck.push(c.id); }
  return s;
}

export function player(state: GameState, id: string) {
  return state.players.find((p) => p.id === id)!;
}
