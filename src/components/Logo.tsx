"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { Card } from "@/lib/game/types";
import { LOGO, TILE_RADIUS } from "@/lib/logo/mark";
import { EASE_IN_OUT, EASE_OUT, ENTER_MS, LOADING_GRACE_MS, prefersReducedMotion, takeIntro } from "@/lib/client/motion";
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

/**
 * The hero deal is a showpiece, slower than motion at the table: a deck
 * appears in the middle, each card peels off and sweeps out to the arc with
 * a small overshoot, and the ace lifts and turns over last.
 */
const DECK_IN = 380;
const DEAL_GAP = 130;
const SWEEP = 560;
const FLIP_PAUSE = 150;
const FLIP_SLOW = 650;
/** The breath that follows: a slow ripple round the arc and a gentle hover. */
const BREATH_MS = 5600;
const HOVER_MS = 7200;

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
 *   animated  deals the cards from a deck at the center into the arc, then
 *             turns the ace. With `intro`, it plays once per browser session; a
 *             click replays. With `breathe`, it keeps breathing afterwards.
 *   loading   a quiet, repeating deal for waits; hidden until `visible`.
 * Reduced motion always gets the final frame.
 */
export function Logo({ size, mode = "static", tile = false, decorative = false, intro, visible = true, breathe = false, className = "" }: {
  size: number;
  mode?: LogoMode;
  /** After any deal, keep the mark slowly breathing: for a hero, never beside text. */
  breathe?: boolean;
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
  const breathing = useRef<Animation[]>([]);
  const dealing = useRef(false);
  // Decided once per mounted logo, so a remount in development still plays it.
  const claimed = useRef<boolean | null>(null);
  const [generation, setGeneration] = useState(0);
  const m = metrics(size);
  const u = m.u;

  const stop = useCallback(() => {
    for (const a of running.current) a.cancel();
    running.current = [];
  }, []);
  const rest = useCallback(() => {
    for (const a of breathing.current) a.cancel();
    breathing.current = [];
  }, []);

  const deal = useCallback(() => {
    const root = ref.current;
    if (!root || typeof root.animate !== "function") return;
    stop();
    rest();
    dealing.current = true;
    const cards = root.querySelectorAll<HTMLElement>("[data-logo-card]");
    const last = cards.length - 1;
    cards.forEach((el, i) => {
      const c = LOGO.cards[i];
      // The deck: every card stacked at the center, a hair apart, the ace's back on top.
      const dx = (LOGO.deck.x - c.x) * u;
      const dy = (LOGO.deck.y - c.y) * u - i * 0.35 * u;
      // Outward, past its place, before it settles: the direction the card lies from the center.
      const rad = (c.rotate * Math.PI) / 180;
      const ox = Math.cos(rad) * 1.4 * u;
      const oy = Math.sin(rad) * 1.4 * u;
      const leave = DECK_IN + i * DEAL_GAP;
      const total = leave + SWEEP;
      const at = (ms: number) => ms / total;
      running.current.push(el.animate([
        { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(0.96)`, opacity: 0, zIndex: i, offset: 0 },
        { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(1)`, opacity: 1, zIndex: i, offset: at(DECK_IN * 0.8) },
        { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(1)`, opacity: 1, zIndex: i, offset: at(leave), easing: EASE_OUT },
        // Lifted over the deck while it travels.
        { transform: `translate(${dx * 0.45}px, ${dy * 0.45}px) rotate(${c.rotate * 0.7}deg) scale(1.08)`, opacity: 1, zIndex: 50, offset: at(leave + SWEEP * 0.45) },
        { transform: `translate(${ox}px, ${oy}px) rotate(${c.rotate}deg) scale(1.02)`, opacity: 1, zIndex: 50, offset: at(leave + SWEEP * 0.82), easing: EASE_IN_OUT },
        { transform: `translate(0px, 0px) rotate(${c.rotate}deg) scale(1)`, opacity: 1, zIndex: 50, offset: 1 },
      ], { duration: total, fill: "backwards" }));
    });
    // The ace lands face down like the rest, then lifts and turns over slowly.
    const flip = root.querySelector<HTMLElement>("[data-logo-flip]");
    if (flip) {
      running.current.push(flip.animate([
        { transform: "rotateY(0deg) scale(1)" },
        { transform: "rotateY(90deg) scale(1.16)", offset: 0.5 },
        { transform: "rotateY(180deg) scale(1)" },
      ], { duration: FLIP_SLOW, delay: DECK_IN + last * DEAL_GAP + SWEEP + FLIP_PAUSE, easing: EASE_IN_OUT, fill: "backwards" }));
    }
    // Once dealt, release the animations and paint fresh cards. The browser
    // rasterizes nodes it has animated slightly differently, and the final
    // frame must match the static logo pixel for pixel.
    const dealt = running.current;
    void Promise.all(dealt.map((a) => a.finished)).then(() => {
      if (running.current !== dealt) return;
      stop();
      dealing.current = false;
      setGeneration((g) => g + 1);
    }, () => {});
  }, [stop, rest, u]);

  /** A slow ripple runs round the arc, each card easing outward and back, while the whole mark hovers. */
  const breath = useCallback(() => {
    const root = ref.current;
    if (!root || typeof root.animate !== "function") return;
    rest();
    const reach = 1.5 * u;
    root.querySelectorAll<HTMLElement>("[data-logo-idle]").forEach((el, i) => {
      // Inside a card turned along the arc, +x points away from the center.
      breathing.current.push(el.animate([
        { transform: "translateX(0px) rotate(0deg)" },
        { transform: `translateX(${reach}px) rotate(1.2deg)`, offset: 0.5 },
        { transform: "translateX(0px) rotate(0deg)" },
      ], { duration: BREATH_MS, delay: -(LOGO.cards.length - i) * 280, iterations: Infinity, easing: EASE_IN_OUT }));
    });
    const mark = root.querySelector<HTMLElement>("[data-logo-mark]");
    if (mark) {
      breathing.current.push(mark.animate([
        { transform: "translateY(0px)" },
        { transform: `translateY(${-1.2 * u}px)`, offset: 0.5 },
        { transform: "translateY(0px)" },
      ], { duration: HOVER_MS, iterations: Infinity, easing: EASE_IN_OUT }));
    }
  }, [rest, u]);

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
    const el = ref.current;
    const start = () => {
      if (claimed.current === null) claimed.current = intro ? takeIntro(intro) : !prefersReducedMotion();
      if (claimed.current) deal();
    };
    // A logo on a view that is not displayed yet keeps its intro until it is.
    if (el && el.getClientRects().length === 0 && typeof ResizeObserver !== "undefined") {
      const watch = new ResizeObserver(() => {
        if (!el.getClientRects().length) return;
        watch.disconnect();
        start();
      });
      watch.observe(el);
      return () => { watch.disconnect(); stop(); };
    }
    start();
    return stop;
  }, [mode, intro, deal, stop]);

  // Breathing starts on mount, and again on the fresh cards after every deal.
  useEffect(() => {
    if (!breathe || dealing.current || prefersReducedMotion()) return;
    breath();
    return rest;
  }, [breathe, generation, breath, rest]);

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
      <span key={generation} data-logo-mark aria-hidden className="absolute inset-0 block" style={m.vars}>
        {LOGO.cards.map((c, i) => (
          <span
            key={i}
            data-logo-card
            className="absolute block"
            style={{ left: c.x * u - m.w / 2, top: c.y * u - m.h / 2, width: m.w, height: m.h, transform: `rotate(${c.rotate}deg)` }}
          >
            <span data-logo-idle className="block h-full w-full">
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
