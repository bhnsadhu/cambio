import type { Card, PlayerView } from "@/lib/game/types";
import type { LocKey } from "./positions";

/**
 * Card motion is derived, never scripted: the difference between two public
 * views says which physical cards moved where. Card ids are stable, so a
 * stuck card, a blind swap or a handed over card all become flights from the
 * slot they left to the slot they landed in. This works identically for
 * bots, other humans and yourself, and needs nothing from the server.
 */

export interface FlightSpec {
  id: string;
  from: LocKey;
  to: LocKey;
  /** face up in flight (only when the value is public: landing on the pile) */
  face: Card | null;
  delay: number;
  duration: number;
}

/**
 * A card takes long enough to cross the table that the eye can follow it from
 * the hand it left to the hand it landed in. The deal is slower still, and its
 * sixteen cards are staggered to fit inside the engine's `DEAL_MS` window with
 * a beat to spare for the round trip.
 */
export const FLIGHT_MS = 460;
export const DEAL_MS = 380;
export const DEAL_STAGGER_MS = 90;

function locate(view: PlayerView): Map<string, LocKey> {
  const m = new Map<string, LocKey>();
  for (const p of view.public.players) {
    p.hand.forEach((id, i) => { if (id) m.set(id, `slot:${p.id}:${i}`); });
  }
  if (view.public.discardTop) m.set(view.public.discardTop.id, "discard");
  if (view.private?.drawnCard) m.set(view.private.drawnCard.id, "drawn");
  return m;
}

export function diffFlights(prev: PlayerView, next: PlayerView, me: string | null): FlightSpec[] {
  const P = prev.public;
  const N = next.public;
  const v = N.version;
  const specs: FlightSpec[] = [];

  const dealt = N.phase === "peek" && (P.phase !== "peek" || N.round !== P.round);
  if (dealt) {
    let k = 0;
    for (let i = 0; i < 4; i++) {
      for (const p of N.players) {
        const id = p.hand[i];
        if (!id) continue;
        specs.push({ id: `${v}:${id}`, from: "deck", to: `slot:${p.id}:${i}`, face: null, delay: k++ * DEAL_STAGGER_MS, duration: DEAL_MS });
      }
    }
    return specs;
  }
  if (N.phase === "lobby" || N.phase === "scoring") return specs;

  const prevLoc = locate(prev);
  const nextLoc = locate(next);
  const holder = P.turn && P.turn.stage === "decide" ? P.turn.playerId : null;
  const holderKey: LocKey | null = holder ? (holder === me ? "drawn" : `held:${holder}`) : null;

  for (const [id, to] of nextLoc) {
    const from = prevLoc.get(id);
    if (from === to) continue;
    let origin: LocKey | null = from ?? null;
    if (!origin) {
      if (to === "drawn") origin = "deck";
      else if (to === "discard") origin = holderKey;
      else if (to.startsWith("slot:")) {
        const owner = to.split(":")[1];
        origin = holder === owner && holderKey ? holderKey : "deck";
      }
    }
    if (!origin) continue;
    specs.push({ id: `${v}:${id}`, from: origin, to, face: to === "discard" ? N.discardTop : null, delay: 0, duration: FLIGHT_MS });
  }

  // Someone else drew: a face down card travels from the deck to their hand.
  const t = N.turn;
  const wasHolding = P.turn && t && P.turn.playerId === t.playerId && P.turn.stage === "decide";
  if (t && t.stage === "decide" && t.playerId !== me && !wasHolding) {
    specs.push({ id: `${v}:held:${t.playerId}`, from: "deck", to: `held:${t.playerId}`, face: null, delay: 0, duration: FLIGHT_MS });
  }
  return specs;
}
