"use client";

import type { PlayerView } from "@/lib/game/types";
import { FaceCard } from "./cards";
import { Button } from "./ui";
import { OPENING_PEEK_MS, PEEK_REVEAL_MS } from "@/lib/game/engine";

/**
 * Names what you are allowed to see and counts down. The tiles themselves
 * turn over for the same window; when this closes, everything is face down.
 */
export function RevealBanner({
  view,
  now,
  busy,
  hint,
  onKingDecide,
}: {
  view: PlayerView;
  now: number;
  busy: boolean;
  hint: string | null;
  onKingDecide: (swap: boolean) => void;
}) {
  const reveals = view.private?.reveals ?? [];
  if (!reveals.length) return null;
  const names = new Map(view.public.players.map((p) => [p.id, p.name]));
  const ownerOf = (cardId: string) => view.public.players.find((p) => p.hand.includes(cardId));

  return (
    <div className="flex justify-center px-6">
      <div className="flex max-w-[720px] flex-col gap-3">
        {reveals.map((r) => {
          const total = r.kind === "opening" ? OPENING_PEEK_MS : PEEK_REVEAL_MS;
          const left = Math.max(0, r.until - now);
          const isKing = r.kind === "kingLook";
          const pct = isKing ? null : Math.min(100, (left / total) * 100);
          const title =
            r.kind === "opening" ? "Your bottom two cards" :
            r.kind === "peekOwn" ? "One of your cards" :
            r.kind === "peekOther" ? `${names.get(ownerOf(r.cardIds[0])?.id ?? "") ?? "Their"}'s card` :
            "Two cards. Your call.";
          const kingPending = isKing && view.public.pendingPower?.playerId === view.private?.playerId && view.public.pendingPower?.lookedDone;
          return (
            <div key={r.id} className="animate-rise rounded-panel bg-ink px-5 py-4 text-bg shadow-float">
              <div className="flex items-center gap-5">
                <div className="min-w-[170px]">
                  <p className="t-caption text-bg/60">{title}</p>
                  <p className="t-callout mt-1 text-bg/85">
                    {isKing ? "Swap them, or leave them." : (
                      <>Face down again in <span className="tnum font-semibold text-bg">{(left / 1000).toFixed(1)}s</span></>
                    )}
                  </p>
                  {hint ? <p className="t-footnote mt-2 max-w-[220px] text-bg/60">{hint}</p> : null}
                </div>
                <div className="flex items-center gap-3">
                  {r.cards.map((c, i) => (
                    <div key={c.id} className="flex flex-col items-center gap-1.5">
                      <FaceCard card={c} size="md" className="animate-flip-in" />
                      {isKing ? (
                        <span className="t-footnote text-bg/70">{ownerOf(r.cardIds[i])?.id === view.private?.playerId ? "Yours" : names.get(ownerOf(r.cardIds[i])?.id ?? "")}</span>
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
