"use client";

import { useState, type CSSProperties, type Ref } from "react";
import type { Card } from "@/lib/game/types";
import { isRed, SUIT_SYMBOL } from "@/lib/game/cards";

const SIZES = {
  sm: { box: "w-9 h-[51px] rounded-[5px]", rank: "text-[13px]", ten: "text-[12px]", suit: "text-[12px]", mark: "text-[15px]", label: "text-[6.5px]", pad: "p-1.5" },
  md: { box: "w-14 h-20 rounded-[8px]", rank: "text-[17px]", ten: "text-[15.5px]", suit: "text-[15px]", mark: "text-[21px]", label: "text-[8.5px]", pad: "p-2" },
  lg: { box: "w-[var(--tile-w)] h-[var(--tile-h)] rounded-[var(--tile-r)]", rank: "text-[24px]", ten: "text-[21px]", suit: "text-[20px]", mark: "text-[29px]", label: "text-[10.5px]", pad: "p-2.5" },
} as const;

export type CardSize = keyof typeof SIZES;

/**
 * A face up card. The only place a value is ever drawn on screen.
 *
 * Two ranks get their own treatment, because at a glance they were read as
 * something else:
 *   10    two digits set like one, a size down and with the tracking opened
 *         up, so the zero can never be lost against the one.
 *   joker a card of its own color with a star where the rank goes and its
 *         name across the foot. A jack is a black or red J with a suit; a
 *         joker looks nothing like it from across the table.
 */
export function FaceCard({ card, size = "md", className = "", elRef, style }: { card: Card; size?: CardSize; className?: string; elRef?: Ref<HTMLDivElement>; style?: CSSProperties }) {
  const s = SIZES[size];
  const joker = card.rank === "JOKER";
  const ten = card.rank === "10";
  const color = joker ? "text-joker" : isRed(card.suit) ? "text-red" : "text-card-ink";
  return (
    <div
      ref={elRef}
      style={style}
      className={`relative ${s.box} ${s.pad} flex flex-col justify-between ${joker ? "bg-joker-card" : "bg-card"} shadow-card ${color} ${className}`}
    >
      {joker ? (
        <>
          <span className={`${s.mark} font-semibold leading-none`} aria-hidden>★</span>
          <span className={`${s.label} self-start font-bold uppercase leading-none tracking-[0.1em]`}>Joker</span>
        </>
      ) : (
        <>
          <span
            className={[
              ten ? s.ten : s.rank,
              "font-semibold leading-none whitespace-nowrap",
              ten ? "tracking-[0.03em]" : "tnum tracking-[-0.02em]",
            ].join(" ")}
          >
            {card.rank}
          </span>
          <span className={`${s.suit} self-start leading-none`}>{card.suit ? SUIT_SYMBOL[card.suit] : ""}</span>
        </>
      )}
    </div>
  );
}

/** A plain face down card, used by flights and the deck. */
export function CardBack({ size = "lg", className = "", elRef }: { size?: CardSize; className?: string; elRef?: Ref<HTMLDivElement> }) {
  return <div ref={elRef} className={`relative ${SIZES[size].box} card-back ${className}`} />;
}

export interface TileProps {
  empty?: boolean;
  selectable?: boolean;
  selected?: boolean;
  cue?: string;
  onClick?: () => void;
  /** when set, the tile turns over to show this card; when cleared it turns back */
  face?: Card | null;
  /** keeps the slot's space but shows nothing (a card is in flight to it) */
  hidden?: boolean;
  /** this card is part of the move being announced: light it for everyone */
  spotlit?: boolean;
  slotRef?: (el: HTMLElement | null) => void;
}

/**
 * A card tile in a hand. Face down at rest; turns on its axis for a timed
 * reveal; dashed when the slot is empty.
 */
export function CardTile({ empty, selectable, selected, cue, onClick, face, hidden, spotlit, slotRef }: TileProps) {
  // Keep the last face so the value stays readable while the tile turns back.
  // Once turned, the back side is invisible, so a stale face never shows.
  const [shown, setShown] = useState<Card | null>(face ?? null);
  if (face && face !== shown) setShown(face);

  if (empty) {
    return (
      <div
        ref={slotRef}
        className="h-[var(--tile-h)] w-[var(--tile-w)] rounded-[var(--tile-r)] border-[1.5px] border-dashed border-white/20"
        aria-label="empty slot"
      />
    );
  }
  const interactive = !!(selectable && onClick && !face);
  return (
    <button
      type="button"
      ref={slotRef as (el: HTMLButtonElement | null) => void}
      disabled={!interactive}
      onClick={onClick}
      style={hidden ? { visibility: "hidden" } : undefined}
      className={[
        "flip group relative h-[var(--tile-h)] w-[var(--tile-w)] rounded-[var(--tile-r)] transition-[transform,box-shadow] duration-200 ease-out",
        interactive ? "cursor-pointer hover:-translate-y-1.5" : "cursor-default",
        selected ? "-translate-y-1.5" : "",
      ].join(" ")}
      data-face={face ? "up" : "down"}
      aria-label={face ? `revealed ${face.rank}` : cue ? `${cue} this card` : "face down card"}
    >
      {spotlit ? <span aria-hidden className="spotlight pointer-events-none absolute -inset-[3px] z-20" /> : null}
      <span className="flip-inner block">
        <span
          className={[
            "flip-side front card-back block overflow-hidden rounded-[var(--tile-r)] transition-shadow duration-200",
            interactive ? "group-hover:shadow-lift" : "",
            selected ? "ring-accent" : "",
          ].join(" ")}
        >
          {interactive && cue ? (
            <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 translate-y-full bg-card-ink/92 py-1 text-center text-[10.5px] font-semibold uppercase tracking-[0.08em] text-card transition-transform duration-200 ease-out group-hover:translate-y-0">
              {cue}
            </span>
          ) : null}
        </span>
        <span className="flip-side back block">
          {shown ? <FaceCard card={shown} size="lg" className="shadow-lift" /> : null}
        </span>
      </span>
    </button>
  );
}
