"use client";

import type { PlayerView } from "@/lib/game/types";
import { useClock } from "@/lib/client/useClock";
import { FaceCard } from "./cards";
import { Notification } from "./Notification";
import { OPENING_PEEK_MS, PEEK_REVEAL_MS } from "@/lib/game/engine";

/**
 * Names what you are allowed to see and counts down. The tiles themselves
 * turn over for the same window; when this closes, everything is face down.
 */
export function RevealBanner({
  view,
  skew,
  hint,
}: {
  view: PlayerView;
  skew: number;
  hint: string | null;
}) {
  const hasReveals = (view.private?.reveals.length ?? 0) > 0;
  // A paused table stops this countdown where it stood.
  const frozen = view.public.paused ? view.public.pausedAt : null;
  const tick = useClock(100, hasReveals && frozen === null);
  const now = frozen ?? tick + skew;
  if (!hasReveals || (frozen === null && tick === 0)) return null;
  // Drop a reveal a beat before its deadline so the callout never lingers at zero.
  const reveals = (view.private?.reveals ?? []).filter((r) => r.kind === "kingLook" || r.until - now > 150);
  if (!reveals.length) return null;
  const names = new Map(view.public.players.map((p) => [p.id, p.name]));
  const ownerOf = (cardId: string) => view.public.players.find((p) => p.hand.includes(cardId));

  return (
    <>
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
          return (
            <Notification key={r.id} title={title} label="Card reveal" priority={0} announce={false}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1 basis-[140px]">
                  <p>
                    {isKing ? "Swap them, or leave them." : (
                      <>Face down again in <span className="tnum font-medium text-accent">{(left / 1000).toFixed(1)}s</span></>
                    )}
                  </p>
                  {hint ? <p className="mt-1.5 text-[11px] text-ink-3">{hint}</p> : null}
                </div>
                <div className="flex max-w-full items-start justify-center gap-3">
                  {r.cards.map((c, i) => (
                    <div key={c.id} className="flex w-[58px] min-w-0 flex-col items-center gap-1.5">
                      <FaceCard card={c} size="sm" />
                      {isKing ? (
                        <span className="t-footnote w-full text-center text-ink-3 [overflow-wrap:anywhere]">{ownerOf(r.cardIds[i])?.id === view.private?.playerId ? "Yours" : names.get(ownerOf(r.cardIds[i])?.id ?? "")}</span>
                      ) : null}
                    </div>
                  ))}
                </div>

              </div>
              {pct !== null ? (
                <div className="mt-3 h-0.5 w-full overflow-hidden rounded-full bg-white/10" aria-hidden>
                  <div className="h-full rounded-full bg-accent transition-[width] duration-100 ease-linear" style={{ width: `${pct}%` }} />
                </div>
              ) : null}
            </Notification>
          );
        })}
    </>
  );
}
