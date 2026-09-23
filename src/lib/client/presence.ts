"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { callProfile, useStoredProfile } from "./profile";

/** One tracker per document, including pages without a friends panel. */
export function PresenceSession() {
  const token = useStoredProfile()?.token ?? null;
  const pathname = usePathname();
  const code = /^\/g\/([^/]+)$/.exec(pathname)?.[1] ?? null;
  const tab = useRef<{ id: string; sequence: number } | null>(null);
  useEffect(() => {
    if (!token) return;
    const current = tab.current ??= { id: crypto.randomUUID(), sequence: 0 };
    let left = false;
    const payload = (online: boolean) => JSON.stringify({ tabId: current.id, sequence: ++current.sequence, online, code, token });
    const beat = () => {
      if (!left) void callProfile("/api/presence", { method: "POST", body: payload(true) }).catch(() => {});
    };
    const leave = () => {
      left = true;
      const body = payload(false);
      try {
        if (navigator.sendBeacon?.("/api/presence", new Blob([body], { type: "application/json" }))) return;
      } catch { /* Fall back to a keepalive request. */ }
      void fetch("/api/presence", { method: "POST", body, headers: { "content-type": "application/json" }, credentials: "same-origin", keepalive: true }).catch(() => {});
    };
    const resume = () => { left = false; beat(); };
    const visible = () => { if (document.visibilityState === "visible") resume(); };
    beat();
    // Keep background tabs online too; expiry handles lost connections/crashes.
    const interval = window.setInterval(beat, 20_000);
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", visible);
    return () => {
      left = true;
      window.clearInterval(interval);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [token, code]);
  return null;
}
