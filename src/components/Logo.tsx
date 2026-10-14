"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { Card } from "@/lib/game/types";
import { LOGO, TILE_RADIUS } from "@/lib/logo/mark";
import { EASE_IN_OUT, EASE_OUT, ENTER_MS, FLIP_MS, LOADING_GRACE_MS, STAGGER_MS, prefersReducedMotion, takeIntro } from "@/lib/client/motion";
import { CardBack, FaceCard } from "./cards";

/**
 * Cards are laid out at their real size, so a card back keeps the same
 * stripe as every other card back in the app, at any size. Only the ace's
 * face is drawn at table size and scaled, so its rank and suit keep their
 * proportions. Every mode draws this same tree; an animation only ever runs
 * on top of it and leaves it untouched when done.
 */
const FACE_REF = 66;
/** Card width below which the card back's stripe is drawn as its average tone. */
const FLAT_BELOW = 12;
const ACE: Card = { id: "logo-ace", rank: "A", suit: "S" };

function metrics(size: number) {
  const u = size / 100;
  const w = LOGO.width * u;
  const h = LOGO.height * u;
  // A ring of page black keeps overlapping cards apart; never thinner than a hairline.
  const ring = Math.max(0.75, (LOGO.gap / 2) * u);
  return {
    u, w, h,
    vars: { "--tile-w": `${w}px`, "--tile-h": `${h}px`, "--tile-r": `${LOGO.radius * u}px` } as CSSProperties,
    card: { boxShadow: `0 0 0 ${ring}px var(--color-bg), var(--shadow-card)` } as CSSProperties,
    face: {
      "--tile-w": `${FACE_REF}px`, "--tile-h": `${FACE_REF * (LOGO.height / LOGO.width)}px`, "--tile-r": `${FACE_REF * (LOGO.radius / LOGO.width)}px`,
      width: FACE_REF, height: FACE_REF * (LOGO.height / LOGO.width), transform: `scale(${w / FACE_REF})`,
    } as CSSProperties,
    faceRing: { boxShadow: `0 0 0 ${ring * (FACE_REF / w)}px var(--color-bg), var(--shadow-card)` } as CSSProperties,
  };
}

/** Loading: one cycle deals the arc card by card, holds it, then clears. */
const LOOP_STAGGER = 75;
const LOOP_HOLD = 520;
const LOOP_MS = (LOGO.cards.length - 1) * LOOP_STAGGER + ENTER_MS + LOOP_HOLD + ENTER_MS;

export type LogoMode = "static" | "animated" | "loading";

/**
 * The Cambio mark: eight card backs dealt into a C, the ace of spades face up
 * on top.
 *   static    the final frame, and all there is wherever the mark is small or
 *             sits beside text.
 *   animated  deals the cards from the center into the arc, then turns the ace.
 *             With `intro`, it plays once per browser session; a click replays.
 *   loading   a quiet, repeating deal for waits; hidden until `visible`.
 * Reduced motion always gets the final frame.
 */
export function Logo({ size, mode = "static", tile = false, decorative = false, intro, visible = true, className = "" }: {
  size: number;
  mode?: LogoMode;
  /** Draw the near black rounded tile behind the mark, as the icons do. */
  tile?: boolean;
  /** Beside the word Cambio, the mark is decoration and must not be read twice. */
  decorative?: boolean;
  /** Session key for a one time intro. */
  intro?: string;
  visible?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const running = useRef<Animation[]>([]);
  // Decided once per mounted logo, so a remount in development still plays it.
  const claimed = useRef<boolean | null>(null);
  const [generation, setGeneration] = useState(0);
  const m = metrics(size);
  const u = m.u;

  const stop = useCallback(() => {
    for (const a of running.current) a.cancel();
    running.current = [];
  }, []);

  const deal = useCallback(() => {
    const root = ref.current;
    if (!root || typeof root.animate !== "function") return;
    stop();
    const cards = root.querySelectorAll<HTMLElement>("[data-logo-card]");
    cards.forEach((el, i) => {
      const c = LOGO.cards[i];
      const dx = (LOGO.deck.x - c.x) * u;
      const dy = (LOGO.deck.y - c.y) * u;
      running.current.push(el.animate([
        { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(0.9)`, opacity: 0 },
        { opacity: 1, offset: 0.35 },
        { transform: `translate(0px, 0px) rotate(${c.rotate}deg) scale(1)`, opacity: 1 },
      ], { duration: ENTER_MS, delay: i * STAGGER_MS, easing: EASE_OUT, fill: "backwards" }));
    });
    // The ace arrives face down like the rest, then turns the way a table card does.
    const flip = root.querySelector<HTMLElement>("[data-logo-flip]");
    if (flip) {
      running.current.push(flip.animate([{ transform: "rotateY(0deg)" }, { transform: "rotateY(180deg)" }], {
        duration: FLIP_MS, delay: (cards.length - 1) * STAGGER_MS + ENTER_MS, easing: EASE_IN_OUT, fill: "backwards",
      }));
    }
    // Once dealt, release the animations and paint fresh cards. The browser
    // rasterizes nodes it has animated slightly differently, and the final
    // frame must match the static logo pixel for pixel.
    const dealt = running.current;
    void Promise.all(dealt.map((a) => a.finished)).then(() => {
      if (running.current !== dealt) return;
      stop();
      setGeneration((g) => g + 1);
    }, () => {});
  }, [stop, u]);

  const loop = useCallback(() => {
    const root = ref.current;
    if (!root || typeof root.animate !== "function") return;
    stop();
    const fadeAt = 1 - ENTER_MS / LOOP_MS;
    root.querySelectorAll<HTMLElement>("[data-logo-card]").forEach((el, i) => {
      const c = LOGO.cards[i];
      const dx = (LOGO.deck.x - c.x) * u * 0.3;
      const dy = (LOGO.deck.y - c.y) * u * 0.3;
      const from = `translate(${dx}px, ${dy}px) rotate(${c.rotate}deg)`;
      const at = `translate(0px, 0px) rotate(${c.rotate}deg)`;
      const start = (i * LOOP_STAGGER) / LOOP_MS;
      const land = (i * LOOP_STAGGER + ENTER_MS) / LOOP_MS;
      running.current.push(el.animate([
        { transform: from, opacity: 0, offset: 0 },
        { transform: from, opacity: 0, offset: start, easing: EASE_OUT },
        { transform: at, opacity: 1, offset: land },
        { transform: at, opacity: 1, offset: fadeAt, easing: EASE_OUT },
        { transform: at, opacity: 0, offset: 1 },
      ], { duration: LOOP_MS, iterations: Infinity }));
    });
  }, [stop, u]);

  useEffect(() => {
    if (mode !== "animated") return;
    if (claimed.current === null) claimed.current = intro ? takeIntro(intro) : !prefersReducedMotion();
    if (claimed.current) deal();
    return stop;
  }, [mode, intro, deal, stop]);

  useEffect(() => {
    if (mode !== "loading" || !visible || prefersReducedMotion()) return;
    loop();
    return stop;
  }, [mode, visible, loop, stop]);

  const replay = () => { if (!prefersReducedMotion()) deal(); };

  return (
    <span
      ref={ref}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "Cambio"}
      aria-hidden={decorative || undefined}
      data-logo={mode}
      data-logo-intro={intro}
      data-logo-flat={m.w < FLAT_BELOW || undefined}
      onClick={mode === "animated" ? replay : undefined}
      className={`relative inline-block shrink-0 align-middle ${className}`}
      style={{ width: size, height: size, visibility: visible ? undefined : "hidden" }}
    >
      {tile ? <span aria-hidden className="absolute inset-0 bg-bg" style={{ borderRadius: `${TILE_RADIUS}%` }} /> : null}
      <span key={generation} aria-hidden className="absolute inset-0 block" style={m.vars}>
        {LOGO.cards.map((c, i) => (
          <span
            key={i}
            data-logo-card
            className="absolute block"
            style={{ left: c.x * u - m.w / 2, top: c.y * u - m.h / 2, width: m.w, height: m.h, transform: `rotate(${c.rotate}deg)` }}
          >
            {c.ace ? (
              <span className="flip block h-full w-full" data-face="up">
                <span data-logo-flip className="flip-inner block">
                  <span className="flip-side front block"><CardBack size="lg" style={m.card} /></span>
                  <span className="flip-side back block">
                    <span className="block origin-top-left" style={m.face}><FaceCard card={ACE} size="lg" style={m.faceRing} /></span>
                  </span>
                </span>
              </span>
            ) : <CardBack size="lg" style={m.card} />}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * A wait worth showing. Nothing appears for the first moments, so fast loads
 * never flash it; after that the quiet logo deals above the label.
 */
export function LogoLoader({ label, size = 40, className = "" }: { label: string; size?: number; className?: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), LOADING_GRACE_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div role="status" aria-busy className={`flex flex-col items-center gap-3 ${className}`}>
      <Logo size={size} mode="loading" decorative visible={shown} />
      <p className="t-sub text-ink-2" style={{ visibility: shown ? undefined : "hidden" }}>{label}</p>
    </div>
  );
}
