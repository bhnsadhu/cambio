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
    <section className="flex min-w-0 flex-col gap-4 rounded-panel bg-surface px-4 pt-4 pb-5 hairline" aria-label="deck and discard pile">
      <header>
        <h3 className="t-headline">Table</h3>
        <p className="t-footnote mt-0.5 text-ink-3">Deck and pile</p>
      </header>
      <div className="flex items-start gap-4">
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            ref={positions.register("deck") as (el: HTMLButtonElement | null) => void}
            disabled={!canDraw}
            onClick={onDraw}
            className={[
              "press relative h-[var(--tile-h)] w-[var(--tile-w)] rounded-[var(--tile-r)] card-back transition-[transform,box-shadow] duration-200 ease-out",
              canDraw ? "cursor-pointer hover:-translate-y-1.5 hover:shadow-lift ring-turn" : "cursor-default",
            ].join(" ")}
            aria-label={canDraw ? "draw a card" : "deck"}
          >
            {canDraw ? (
              <span className="absolute inset-x-0 bottom-2 text-center text-[10.5px] font-semibold uppercase tracking-[0.08em] text-bg/90">Draw</span>
            ) : null}
          </button>
          <span className="t-footnote tnum text-ink-3">{deckCount === 0 ? "Deck empty" : `${deckCount} left`}</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div ref={positions.register("discard")} className="h-[var(--tile-h)] w-[var(--tile-w)]">
            {discardTop && !hideDiscard ? (
              <FaceCard key={discardTop.id} card={discardTop} size="lg" className="animate-settle" />
            ) : discardTop ? null : (
              <div className="flex h-full w-full items-center justify-center rounded-[var(--tile-r)] border-[1.5px] border-dashed border-line-strong">
                <span className="t-footnote text-center text-ink-3">Nothing played yet</span>
              </div>
            )}
          </div>
          <span className="t-footnote tnum text-ink-3">{discardCount ? `${discardCount} on the pile` : "Pile"}</span>
        </div>
      </div>
    </section>
  );
}
