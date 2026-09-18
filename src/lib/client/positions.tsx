"use client";

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";

/**
 * A registry of where things are on the table, keyed by location:
 *   deck · discard · drawn · held:<playerId> · slot:<playerId>:<index>
 * Card flights read a source rect (possibly from the last snapshot, since the
 * source element may already be gone) and a live destination rect.
 */

export type LocKey = string;

export interface Positions {
  register: (key: LocKey) => (el: HTMLElement | null) => void;
  rect: (key: LocKey) => DOMRect | null;
  lastRect: (key: LocKey) => DOMRect | null;
  snapshot: () => void;
}

const Ctx = createContext<Positions | null>(null);

export function PositionsProvider({ children }: { children: ReactNode }) {
  const els = useRef(new Map<LocKey, HTMLElement>());
  const last = useRef(new Map<LocKey, DOMRect>());
  const callbacks = useRef(new Map<LocKey, (el: HTMLElement | null) => void>());

  const value = useMemo<Positions>(() => ({
    register(key) {
      let cb = callbacks.current.get(key);
      if (!cb) {
        cb = (el) => {
          if (el) els.current.set(key, el);
          else {
            const prev = els.current.get(key);
            if (prev) {
              const r = prev.getBoundingClientRect();
              if (r.width > 0) last.current.set(key, r);
            }
            els.current.delete(key);
          }
        };
        callbacks.current.set(key, cb);
      }
      return cb;
    },
    rect(key) {
      const el = els.current.get(key);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 ? r : null;
    },
    lastRect(key) {
      return last.current.get(key) ?? null;
    },
    snapshot() {
      for (const [key, el] of els.current) {
        const r = el.getBoundingClientRect();
        if (r.width > 0) last.current.set(key, r);
      }
    },
  }), []);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePositions(): Positions {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePositions needs a PositionsProvider");
  return v;
}
