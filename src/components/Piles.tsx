"use client";

import type { Card } from "@/lib/game/types";
import { FaceCard } from "./cards";

export function Piles({
  deckCount,
  discardTop,
  discardCount,
  canDraw,
  onDraw,
}: {
  deckCount: number;
  discardTop: Card | null;
  discardCount: number;
  canDraw: boolean;
  onDraw: () => void;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-panel bg-surface px-4 pt-4 pb-5 hairline" aria-label="deck and discard pile">
      <header>
        <h3 className="text-[15px] font-medium">Table</h3>
        <p className="mt-0.5 text-[12px] text-ink-3">Deck and discard</p>
      </header>
      <div className="flex items-start gap-4">
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            disabled={!canDraw}
            onClick={onDraw}
            className={[
              "relative h-[var(--tile-h)] w-[var(--tile-w)] rounded-[10px] card-back transition-[transform,box-shadow] duration-150",
              canDraw ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-10px_rgba(0,0,0,0.5)] ring-turn" : "cursor-default",
            ].join(" ")}
            aria-label={canDraw ? "draw a card" : "deck"}
          >
            {canDraw ? (
              <span className="absolute inset-x-0 bottom-2 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-bg/90">Draw</span>
            ) : null}
          </button>
          <span className="tnum text-[12px] text-ink-3">{deckCount} left</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          {discardTop ? (
            <FaceCard key={discardTop.id} card={discardTop} size="lg" className="animate-pop" />
          ) : (
            <div className="h-[var(--tile-h)] w-[var(--tile-w)] rounded-[10px] border-[1.5px] border-dashed border-line-strong/80" />
          )}
          <span className="tnum text-[12px] text-ink-3">{discardCount ? `${discardCount} discarded` : "Empty pile"}</span>
        </div>
      </div>
    </section>
  );
}
