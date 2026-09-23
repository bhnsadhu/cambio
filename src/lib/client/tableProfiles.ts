"use client";

import { useEffect, useState } from "react";
import type { PublicView } from "@/lib/game/types";
import type { TableProfile } from "@/lib/social/types";

/** Shared by every seat; refresh on roster/round changes, not on every game action. */
export function useTableProfiles(code: string, view: PublicView | null): Record<string, TableProfile> {
  const ids = [...new Set((view?.players ?? []).filter((p) => !p.isBot && p.profileId).map((p) => p.profileId!))].sort().join(",");
  const phase = view?.phase;
  const round = view?.round;
  const [loaded, setLoaded] = useState<{ code: string; profiles: Record<string, TableProfile> } | null>(null);

  useEffect(() => {
    if (!ids) return;
    const controller = new AbortController();
    let reading = false;
    const refresh = async () => {
      if (reading || controller.signal.aborted) return;
      reading = true;
      try {
        const response = await fetch(`/api/games/${encodeURIComponent(code)}/profiles`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Could not load player details.");
        const { profiles } = await response.json() as { profiles: TableProfile[] };
        if (!controller.signal.aborted) setLoaded({ code, profiles: Object.fromEntries(profiles.map((p) => [p.id, p])) });
      } catch {
        // Keep the table playable during a temporary profile lookup failure.
        // Focus, reconnect, and the next poll retry without clearing known tiers.
      } finally { reading = false; }
    };
    void refresh();
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.clearInterval(poll);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [code, ids, phase, round]);

  const current = new Set(ids ? ids.split(",") : []);
  return loaded?.code === code
    ? Object.fromEntries(Object.entries(loaded.profiles).filter(([id]) => current.has(id)))
    : {};
}
