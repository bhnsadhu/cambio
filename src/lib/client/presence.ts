"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { callProfile, useStoredProfile } from "./profile";

/** One tracker per document, including pages without a friends panel. */
export function PresenceSession() {
  const stored = useStoredProfile();
  const token = stored?.token ?? null;
  const profileId = stored?.profile.id ?? null;
  const pathname = usePathname();
  const code = /^\/g\/([^/]+)$/.exec(pathname)?.[1] ?? null;
  const tab = useRef<{ id: string; sequence: number } | null>(null);
  const currentCode = useRef(code);
  const heartbeat = useRef<(() => void) | null>(null);
  // Client-side navigation changes where this document is, not whether it is
  // open. Do not send an offline event between two pages of the website.
  useEffect(() => { currentCode.current = code; heartbeat.current?.(); }, [code]);
  useEffect(() => {
    if (!token || !profileId) return;
    const current = tab.current ??= { id: crypto.randomUUID(), sequence: 0 };
    let left = false;
    const payload = (online: boolean) => JSON.stringify({ tabId: current.id, sequence: ++current.sequence, online, code: currentCode.current, token, profileId });
    const beat = () => {
      if (!left && navigator.onLine) void callProfile("/api/presence", { method: "POST", body: payload(true) }).catch(() => {});
    };
    const leave = () => {
      if (left) return;
      left = true;
      const body = payload(false);
      try {
        if (navigator.sendBeacon?.("/api/presence", new Blob([body], { type: "application/json" }))) return;
      } catch { /* Fall back to a keepalive request. */ }
      void fetch("/api/presence", { method: "POST", body, headers: { "content-type": "application/json" }, credentials: "same-origin", keepalive: true }).catch(() => {});
    };
    const resume = () => { left = false; beat(); };
    // A background tab still counts as being on the website. Refresh its
    // lease before browser timer throttling, and again when it is restored.
    const visible = () => { if (document.visibilityState === "visible") resume(); else beat(); };
    heartbeat.current = beat;
    beat();
    // Keep background tabs online too; expiry handles lost connections/crashes.
    const interval = window.setInterval(beat, 20_000);
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", leave);
    document.addEventListener("visibilitychange", visible);
    return () => {
      leave();
      heartbeat.current = null;
      window.clearInterval(interval);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", leave);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [token, profileId]);
  return null;
}
