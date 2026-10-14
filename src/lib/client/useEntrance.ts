import { useLayoutEffect, useRef } from "react";
import { claimEntrance } from "./motion";

/**
 * A one time entrance: the first time this key is shown in a browser
 * session, `play` runs on the element before it paints, so its resting state
 * never flashes first. Later visits and reduced motion get the resting state.
 */
export function useEntrance<T extends HTMLElement>(key: string, play: (el: T) => Animation[]) {
  const ref = useRef<T>(null);
  // Decided once per mounted element, so a development remount still plays it.
  const claimed = useRef<boolean | null>(null);
  const playRef = useRef(play);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    if (claimed.current === null) claimed.current = claimEntrance(key);
    if (!claimed.current) return;
    const animations = playRef.current(el);
    return () => { for (const a of animations) a.cancel(); };
  }, [key]);
  return ref;
}
