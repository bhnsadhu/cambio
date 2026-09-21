"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PlayerView } from "@/lib/game/types";
import { diffFlights, land, NOTHING_FLYING, takeFlights, type FlightSpec } from "@/lib/client/flights";
import { usePositions, type LocKey } from "@/lib/client/positions";
import { CardBack, FaceCard } from "./cards";

const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/**
 * Works out which cards moved since the last view and flies them across the
 * table. Destinations stay invisible until their card lands, and a flight
 * always completes its arc, whatever else happens while it is in the air.
 */
export function useFlights(view: PlayerView | null, me: string | null) {
  const positions = usePositions();

  // Keep the view before this one so a change can be described as motion.
  // Tracked by version, not object identity: the poll and every reconnect
  // re-deliver the version we already hold, and swapping the tracked view for
  // an identical one would recompute the specs and cancel cards mid-flight.
  const [track, setTrack] = useState<{ cur: PlayerView | null; prev: PlayerView | null }>({ cur: null, prev: null });
  if (track.cur?.public.version !== view?.public.version) setTrack({ cur: view, prev: track.cur });

  const specs = useMemo(() => {
    const { prev, cur } = track;
    if (!cur || !prev || prev.public.version >= cur.public.version) return [] as FlightSpec[];
    return diffFlights(prev, cur, me);
  }, [track, me]);

  useLayoutEffect(() => {
    // Remember where everything was before this view repaints things away.
    return () => { positions.snapshot(); };
  }, [view, positions]);

  // What is in the air is decided by `takeFlights`, which is pure and tested.
  const phase = view?.public.phase ?? null;
  const [flying, setFlying] = useState(NOTHING_FLYING);
  const taken = takeFlights(flying, specs, phase);
  if (taken !== flying) setFlying(taken);

  // Landings are collected and flushed once per frame so a sixteen card deal
  // costs one render, not sixteen.
  const pendingLandings = useRef<string[]>([]);
  const flush = useRef<number | null>(null);
  const onLanded = useCallback((id: string) => {
    pendingLandings.current.push(id);
    if (flush.current !== null) return;
    flush.current = requestAnimationFrame(() => {
      flush.current = null;
      const batch = new Set(pendingLandings.current);
      pendingLandings.current = [];
      setFlying((cur) => land(cur, batch));
    });
  }, []);

  const hidden = useMemo(() => new Set<LocKey>(taken.list.map((s) => s.to)), [taken]);

  return { specs: taken.list, hidden, onLanded };
}

export function FlightLayer({ specs, onLanded }: { specs: FlightSpec[]; onLanded: (id: string) => void }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-40" aria-hidden>
      {specs.map((s) => (
        <Flight key={s.id} spec={s} onLanded={onLanded} />
      ))}
    </div>
  );
}

function Flight({ spec, onLanded }: { spec: FlightSpec; onLanded: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const positions = usePositions();
  const [done, setDone] = useState(false);
  const landedRef = useRef(onLanded);
  useEffect(() => { landedRef.current = onLanded; }, [onLanded]);

  useLayoutEffect(() => {
    const el = ref.current;
    const from = positions.lastRect(spec.from) ?? positions.rect(spec.from);
    const to = positions.rect(spec.to) ?? positions.lastRect(spec.to);
    if (!el || !from || !to) { setDone(true); landedRef.current(spec.id); return; }

    el.style.left = `${from.left}px`;
    el.style.top = `${from.top}px`;
    el.style.width = `${from.width}px`;
    el.style.height = `${from.height}px`;
    const dx = to.left - from.left;
    const dy = to.top - from.top;
    const sx = to.width / from.width;
    const sy = to.height / from.height;
    const lift = Math.min(36, Math.max(14, Math.hypot(dx, dy) * 0.08));
    const anim = el.animate(
      [
        { transform: "translate3d(0px, 0px, 0) scale(1, 1)", opacity: 1, offset: 0 },
        { transform: `translate3d(${dx * 0.5}px, ${dy * 0.5 - lift}px, 0) scale(${((1 + sx) / 2) * 1.05}, ${((1 + sy) / 2) * 1.05})`, opacity: 1, offset: 0.5 },
        { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`, opacity: 1, offset: 1 },
      ],
      { duration: spec.duration, delay: spec.delay, easing: EASE_OUT, fill: "both", composite: "replace" },
    );
    let finished = false;
    anim.onfinish = () => { finished = true; setDone(true); landedRef.current(spec.id); };
    // A cancelled flight reports nothing: it was cancelled because the card
    // is moving again, and the flight that replaced it owns the destination.
    return () => { if (!finished) anim.cancel(); };
    // A flight is defined entirely by its spec; positions is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.id]);

  if (done) return null;
  return (
    <div ref={ref} className="absolute origin-top-left will-change-transform" style={{ opacity: 0, contain: "layout paint" }}>
      {spec.face ? (
        <FaceCard card={spec.face} size="lg" className="h-full! w-full! shadow-lift" />
      ) : (
        <CardBack size="lg" className="h-full! w-full! shadow-lift" />
      )}
    </div>
  );
}
