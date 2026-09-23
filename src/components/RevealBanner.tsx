"use client";

import type { PlayerView } from "@/lib/game/types";
import { useClock } from "@/lib/client/useClock";
import { FaceCard } from "./cards";
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
    <div className="flex w-full justify-center sm:px-6">
      <div className="flex w-full max-w-[720px] flex-col gap-3">
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
            <div key={r.id} className="animate-rise rounded-panel bg-surface-2 px-5 py-4 text-ink shadow-float">
              <div className="flex flex-wrap items-center justify-center gap-4 sm:justify-start sm:gap-5">
                <div className="min-w-0 flex-1 basis-[170px]">
                  <p className="t-caption text-ink-3">{title}</p>
                  <p className="t-callout mt-1 text-ink-2">
                    {isKing ? "Swap them, or leave them." : (
                      <>Face down again in <span className="tnum font-medium text-accent">{(left / 1000).toFixed(1)}s</span></>
                    )}
                  </p>
                  {hint ? <p className="t-footnote mt-2 max-w-[220px] text-ink-3">{hint}</p> : null}
                </div>
                <div className="flex items-center gap-3">
                  {r.cards.map((c, i) => (
                    <div key={c.id} className="flex flex-col items-center gap-1.5">
                      <FaceCard card={c} size="md" className="animate-flip-in" />
                      {isKing ? (
                        <span className="t-footnote text-ink-3">{ownerOf(r.cardIds[i])?.id === view.private?.playerId ? "Yours" : names.get(ownerOf(r.cardIds[i])?.id ?? "")}</span>
                      ) : null}
                    </div>
                  ))}
                </div>

              </div>
              {pct !== null ? (
                <div className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-accent transition-[width] duration-100 ease-linear" style={{ width: `${pct}%` }} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
