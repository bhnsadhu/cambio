"use client";

import { useEffect, useState } from "react";

/**
 * A ticking clock for the few components that show a countdown. Keeping it
 * here, rather than in the game hook, means the rest of the table does not
 * re-render ten times a second while cards are in flight.
 */
export function useClock(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, intervalMs);
    const raf = window.requestAnimationFrame(tick);
    return () => { window.clearInterval(id); window.cancelAnimationFrame(raf); };
  }, [intervalMs, enabled]);
  return now;
}
