"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { Card } from "@/lib/game/types";
import { EASE_IN_OUT } from "@/lib/client/motion";
import { CardBack, FaceCard } from "./cards";
import { Logo } from "./Logo";

/**
 * The landing hero, for guests and account holders alike: the mark large and
 * centered, dealing itself once per session and then breathing slowly, with a
 * few faint cards drifting behind it. The title follows the mark directly.
 */
export function Hero({ children }: { children?: ReactNode }) {
  return (
    <section aria-labelledby="hero-title" className="relative isolate flex flex-col items-center pt-8 pb-10 text-center sm:pt-12 lg:pb-14">
      <HeroDrift />
      {/* One size per breakpoint; the hidden one waits and never claims the intro. */}
      <div className="sm:hidden"><Logo size={208} mode="animated" intro="hero" breathe /></div>
      <div className="hidden sm:block"><Logo size={300} mode="animated" intro="hero" breathe /></div>
      <h1 id="hero-title" className="t-display mt-8 max-w-[760px] text-[28px]! sm:text-[44px]! lg:text-[60px]!">The memory card game,<br />live with friends.</h1>
      {children}
    </section>
  );
}

const reducedQuery = "(prefers-reduced-motion: reduce)";

const KING: Card = { id: "drift-king", rank: "K", suit: "H" };

/** Faint cards crossing behind the mark, slowly, at different depths. The red king leads. */
const DRIFT: { left: number; top: number; width: number; tilt: number; seconds: number; alpha: number; face?: boolean }[] = [
  { left: 4, top: 14, width: 34, tilt: -14, seconds: 96, alpha: 0.12 },
  { left: 20, top: 46, width: 24, tilt: 10, seconds: 128, alpha: 0.08 },
  { left: 33, top: 6, width: 22, tilt: -22, seconds: 150, alpha: 0.06 },
  { left: 70, top: 10, width: 40, tilt: 12, seconds: 88, alpha: 0.12 },
  { left: 86, top: 40, width: 28, tilt: -8, seconds: 112, alpha: 0.08 },
  { left: 60, top: 54, width: 30, tilt: 18, seconds: 136, alpha: 0.07 },
  { left: 12, top: 30, width: 30, tilt: 8, seconds: 104, alpha: 0.2, face: true },
];

function HeroDrift() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const layer = ref.current;
    if (!layer || typeof layer.animate !== "function" || window.matchMedia(reducedQuery).matches) return;
    let animations: Animation[] = [];
    const start = () => {
      for (const a of animations) a.cancel();
      animations = [];
      const width = layer.clientWidth;
      const margin = 90;
      layer.querySelectorAll<HTMLElement>("[data-drift]").forEach((el, i) => {
        const card = DRIFT[i];
        const from = -(card.left / 100) * width - margin;
        const to = width - (card.left / 100) * width + margin;
        const duration = card.seconds * 1000;
        // Phased so the first frame is exactly where the card was painted.
        const phase = -from / (to - from);
        animations.push(el.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], {
          duration, delay: -phase * duration, iterations: Infinity, easing: "linear",
        }));
        const sway = el.firstElementChild as HTMLElement | null;
        if (sway) {
          animations.push(sway.animate([
            { transform: `translateY(0px) rotate(${card.tilt}deg)` },
            { transform: `translateY(${i % 2 ? 7 : -7}px) rotate(${card.tilt + (i % 2 ? -7 : 7)}deg)`, offset: 0.5 },
            { transform: `translateY(0px) rotate(${card.tilt}deg)` },
          ], { duration: 9000 + i * 1300, iterations: Infinity, easing: EASE_IN_OUT }));
        }
      });
    };
    start();
    let resize = 0;
    const onResize = () => { window.clearTimeout(resize); resize = window.setTimeout(start, 150); };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); window.clearTimeout(resize); for (const a of animations) a.cancel(); };
  }, []);

  return (
    <div ref={ref} aria-hidden data-hero-drift className="hero-drift pointer-events-none absolute inset-x-0 top-0 -z-10 h-[80%] overflow-hidden">
      {DRIFT.map((card, i) => {
        const vars = { "--tile-w": `${card.width}px`, "--tile-h": `${card.width * 1.42}px`, "--tile-r": `${card.width * 0.16}px` } as CSSProperties;
        return (
          <div key={i} data-drift className="absolute" style={{ left: `${card.left}%`, top: `${card.top}%`, opacity: card.alpha }}>
            <div style={{ transform: `rotate(${card.tilt}deg)` }}>
              <div style={vars}>
                {card.face ? (
                  <div className="origin-top-left" style={{ width: card.width, height: card.width * 1.42 }}>
                    <div className="origin-top-left" style={{ transform: `scale(${card.width / 36})` }}><FaceCard card={KING} size="sm" /></div>
                  </div>
                ) : <CardBack size="lg" />}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
