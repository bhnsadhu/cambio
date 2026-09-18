"use client";

import type { Card } from "@/lib/game/types";
import { isRed, SUIT_SYMBOL } from "@/lib/game/cards";

const SIZES = {
  sm: { w: "w-9", h: "h-[52px]", rank: "text-[13px]", suit: "text-[12px]", pad: "p-1.5" },
  md: { w: "w-14", h: "h-20", rank: "text-[17px]", suit: "text-[15px]", pad: "p-2" },
  lg: { w: "w-[var(--tile-w)]", h: "h-[var(--tile-h)]", rank: "text-[24px]", suit: "text-[20px]", pad: "p-2.5" },
} as const;

/** A face-up card. The only place a card value is ever drawn on screen. */
export function FaceCard({ card, size = "md", className = "" }: { card: Card; size?: keyof typeof SIZES; className?: string }) {
  const s = SIZES[size];
  const red = isRed(card.suit);
  const color = red ? "text-red" : "text-ink";
  if (card.rank === "JOKER") {
    return (
      <div className={`relative ${s.w} ${s.h} ${s.pad} flex flex-col justify-between rounded-[10px] bg-card hairline ${className}`}>
        <span className={`${s.rank} font-semibold leading-none tracking-[-0.02em] text-ink`}>J</span>
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">Joker</span>
      </div>
    );
  }
  return (
    <div className={`relative ${s.w} ${s.h} ${s.pad} flex flex-col justify-between rounded-[10px] bg-card hairline ${color} ${className}`}>
      <span className={`${s.rank} tnum font-semibold leading-none tracking-[-0.02em]`}>{card.rank}</span>
      <span className={`${s.suit} self-end leading-none`}>{card.suit ? SUIT_SYMBOL[card.suit] : ""}</span>
    </div>
  );
}

export interface TileProps {
  empty?: boolean;
  selectable?: boolean;
  selected?: boolean;
  cue?: string;
  onClick?: () => void;
  size?: "md" | "lg";
}

/** A face-down card tile (or an empty slot). Never shows a value. */
export function CardTile({ empty, selectable, selected, cue, onClick, size = "md" }: TileProps) {
  const dims = size === "lg" ? "w-[var(--tile-w)] h-[var(--tile-h)]" : "w-16 h-[88px]";
  if (empty) {
    return <div className={`${dims} rounded-[10px] border-[1.5px] border-dashed border-line-strong/80`} aria-label="empty slot" />;
  }
  const interactive = selectable && onClick;
  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={onClick}
      className={[
        "group relative rounded-[10px] card-back overflow-hidden transition-[transform,box-shadow] duration-150",
        dims,
        interactive ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_6px_18px_-8px_rgba(0,0,0,0.45)]" : "cursor-default",
        selected ? "ring-accent -translate-y-0.5" : "",
      ].join(" ")}
      aria-label={cue ? `${cue} this card` : "face-down card"}
    >
      {interactive && cue ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 translate-y-full bg-bg/95 py-1 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-ink transition-transform duration-150 group-hover:translate-y-0">
          {cue}
        </span>
      ) : null}
    </button>
  );
}
