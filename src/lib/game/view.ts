/**
 * Projections of the secret `GameState` into what clients may see.
 *
 * The public view contains no card values except the face-up top of the
 * discard pile and the fully revealed hands at scoring time. Private views add
 * the requesting player's drawn card and their unexpired reveals.
 */

import { TURN_TIMEOUT_MS } from "./engine";
import type { GameState, PlayerView, PrivateView, PublicView } from "./types";

export function projectPublic(state: GameState, version: number, now: number): PublicView {
  const top = state.discard.length ? state.cards[state.discard[state.discard.length - 1]] : null;
  return {
    code: state.code,
    version,
    hostId: state.hostId,
    phase: state.phase,
    round: state.round,
    players: state.players.map((p) => ({
      id: p.id,
      seat: p.seat,
      name: p.name,
      isBot: p.isBot,
      isHost: p.isHost,
      hand: p.hand.slice(),
      cardCount: p.hand.filter((c) => c !== null).length,
    })),
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    discardTop: top ? { ...top } : null,
    turn: state.turn ? { playerId: state.turn.playerId, stage: state.turn.stage, startedAt: state.turn.startedAt } : null,
    turnDeadline: state.turn && !state.players.find((p) => p.id === state.turn!.playerId)?.isBot ? state.turn.startedAt + TURN_TIMEOUT_MS : null,
    pendingPower: state.pendingPower
      ? { playerId: state.pendingPower.playerId, kind: state.pendingPower.kind, lookedDone: !!state.pendingPower.looked }
      : null,
    pendingGives: state.pendingGives.map((g) => ({ from: g.from, to: g.to })),
    cambio: state.cambio ? { callerId: state.cambio.callerId, reason: state.cambio.reason, remaining: state.cambio.remaining.slice() } : null,
    openingPeekUntil: state.openingPeekUntil,
    results: state.phase === "scoring" || state.results.length ? structuredClone(state.results) : [],
    log: state.log.slice(-25),
    serverNow: now,
  };
}

export function projectPrivate(state: GameState, playerId: string, now: number): PrivateView | null {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return null;
  const drawn = state.turn && state.turn.playerId === playerId && state.turn.drawnCardId
    ? state.cards[state.turn.drawnCardId]
    : null;
  return {
    playerId,
    drawnCard: drawn ? { ...drawn } : null,
    reveals: state.reveals
      .filter((r) => r.toPlayerId === playerId && r.until > now)
      .map((r) => ({ ...r, cardIds: r.cardIds.slice(), cards: r.cardIds.map((id) => ({ ...state.cards[id] })) })),
  };
}

export function projectFor(state: GameState, version: number, playerId: string | null, now: number): PlayerView {
  return {
    public: projectPublic(state, version, now),
    private: playerId ? projectPrivate(state, playerId, now) : null,
  };
}
