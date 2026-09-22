"use client";

import type { Card } from "@/lib/game/types";
import type { Positions } from "@/lib/client/positions";
import { FaceCard } from "./cards";

export function Piles({
  deckCount,
  discardTop,
  discardCount,
  canDraw,
  onDraw,
  hideDiscard,
  positions,
}: {
  deckCount: number;
  discardTop: Card | null;
  discardCount: number;
  canDraw: boolean;
  onDraw: () => void;
  hideDiscard: boolean;
  positions: Positions;
}) {
  return (
    <section className="col-span-2 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-panel bg-surface px-4 pt-4 pb-5 hairline md:col-span-4 xl:col-span-1 xl:flex-col xl:items-start xl:justify-start xl:gap-4" aria-label="Deck and discard pile">
      <header>
        <h3 className="t-headline">Table</h3>
        <p className="t-footnote mt-0.5 text-ink-3">Deck and pile</p>
      </header>
      <div className="flex items-start gap-4">
        <div className="flex flex-col items-center gap-2">
          {/* One flat card back, the same weight as any other card on the table. */}
          <button
            type="button"
            ref={positions.register("deck") as (el: HTMLButtonElement | null) => void}
            disabled={!canDraw}
            onClick={onDraw}
            className={[
              "press relative h-[var(--tile-h)] w-[var(--tile-w)] rounded-[var(--tile-r)] transition-[transform,box-shadow] duration-200 ease-out",
              canDraw ? "cursor-pointer hover:-translate-y-1.5" : "cursor-default",
            ].join(" ")}
            aria-label={canDraw ? "Draw a card" : "Deck"}
          >
            {deckCount > 0 ? (
              <span aria-hidden className={`card-back absolute inset-0 rounded-[var(--tile-r)] ${canDraw ? "ring-turn" : ""}`} />
            ) : (
              <span aria-hidden className="absolute inset-0 rounded-[var(--tile-r)] border-[1.5px] border-dashed border-white/20" />
            )}
          </button>
          <span className="t-footnote tnum text-ink-3">{deckCount === 0 ? "Deck empty" : `${deckCount} in deck`}</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div ref={positions.register("discard")} className="h-[var(--tile-h)] w-[var(--tile-w)]">
            {discardTop && !hideDiscard ? (
              <FaceCard key={discardTop.id} card={discardTop} size="lg" className="animate-settle" />
            ) : discardTop ? null : (
              <div className="flex h-full w-full items-center justify-center rounded-[var(--tile-r)] border-[1.5px] border-dashed border-white/20">
                <span className="t-footnote text-center text-ink-3">Nothing played yet</span>
              </div>
            )}
          </div>
          <span className="t-footnote tnum text-ink-3">{discardCount ? `${discardCount} played` : "Pile"}</span>
        </div>
      </div>
    </section>
  );
}
