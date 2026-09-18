"use client";

import type { PlayerView } from "@/lib/game/types";
import { FaceCard } from "./cards";
import { Button } from "./ui";
import { OPENING_PEEK_MS, PEEK_REVEAL_MS } from "@/lib/game/engine";

/**
 * The only way a card value ever reaches the screen: a floating callout that
 * names the card(s), counts down, and leaves nothing behind.
 */
export function RevealBanner({
  view,
  now,
  busy,
  onKingDecide,
}: {
  view: PlayerView;
  now: number;
  busy: boolean;
  onKingDecide: (swap: boolean) => void;
}) {
  const reveals = view.private?.reveals ?? [];
  if (!reveals.length) return null;
  const names = new Map(view.public.players.map((p) => [p.id, p.name]));
  const ownerOf = (cardId: string) => view.public.players.find((p) => p.hand.includes(cardId));

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-30 flex justify-center px-6">
      <div className="pointer-events-auto flex max-w-[720px] flex-col gap-3">
        {reveals.map((r) => {
          const total = r.kind === "opening" ? OPENING_PEEK_MS : PEEK_REVEAL_MS;
          const left = Math.max(0, r.until - now);
          const pct = r.kind === "kingLook" ? null : Math.min(100, (left / total) * 100);
          const title =
            r.kind === "opening" ? "Your bottom two cards" :
            r.kind === "peekOwn" ? "One of your cards" :
            r.kind === "peekOther" ? `${names.get(ownerOf(r.cardIds[0])?.id ?? "") ?? "Their"}'s card` :
            "Two cards, your call";
          const isKing = r.kind === "kingLook";
          const kingPending = isKing && view.public.pendingPower?.playerId === view.private?.playerId && view.public.pendingPower?.lookedDone;
          return (
            <div key={r.id} className="animate-rise rounded-panel bg-ink px-5 py-4 text-bg shadow-[0_18px_50px_-20px_rgba(0,0,0,0.5)]">
              <div className="flex items-center gap-5">
                <div className="min-w-[150px]">
                  <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-bg/60">{title}</p>
                  <p className="mt-1 text-[14px] text-bg/85">
                    {isKing ? "Swap them, or leave them where they are." : "Memorise it — it disappears in"}
                    {!isKing ? <span className="tnum ml-1 font-semibold text-bg">{(left / 1000).toFixed(1)}s</span> : null}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {r.cards.map((c, i) => (
                    <div key={c.id} className="flex flex-col items-center gap-1.5">
                      <FaceCard card={c} size="lg" className="animate-pop" />
                      {isKing ? (
                        <span className="text-[11px] text-bg/70">{ownerOf(r.cardIds[i])?.id === view.private?.playerId ? "Yours" : names.get(ownerOf(r.cardIds[i])?.id ?? "")}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
                {kingPending ? (
                  <div className="flex flex-col gap-2 pl-2">
                    <Button variant="accent" size="sm" disabled={busy} onClick={() => onKingDecide(true)}>Swap them</Button>
                    <Button variant="ghost" size="sm" className="text-bg/80 hover:bg-white/10 hover:text-bg" disabled={busy} onClick={() => onKingDecide(false)}>Leave them</Button>
                  </div>
                ) : null}
              </div>
              {pct !== null ? (
                <div className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-white/15">
                  <div className="h-full rounded-full bg-bg/90 transition-[width] duration-100 ease-linear" style={{ width: `${pct}%` }} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
