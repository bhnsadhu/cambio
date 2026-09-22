"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Profile } from "@/lib/social/types";

/**
 * The saved profile on this device.
 *
 * The token is the whole account: whoever holds it is that player. It lives
 * in localStorage beside the table seats, and the cached profile beside it
 * lets the page draw a name and a record before the network answers.
 */

const KEY = "cambio:profile";

export interface StoredProfile {
  token: string;
  profile: Profile;
}

let cache: StoredProfile | null | undefined;
const listeners = new Set<() => void>();

function read(): StoredProfile | null {
  if (cache !== undefined) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as StoredProfile) : null;
  } catch {
    cache = null;
  }
  return cache;
}

export function storedProfile(): StoredProfile | null {
  return read();
}

export function profileToken(): string | null {
  return read()?.token ?? null;
}

export function saveStoredProfile(value: StoredProfile | null) {
  cache = value;
  try {
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const SERVER: StoredProfile | null = null;

export function useStoredProfile(): StoredProfile | null {
  return useSyncExternalStore(subscribe, read, () => SERVER);
}

/* ------------------------------------------------------------------ */
/* Talking to the server                                               */
/* ------------------------------------------------------------------ */

export async function callProfile<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = profileToken();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["x-cambio-profile"] = token;
  const res = await fetch(path, { ...init, headers, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { error?: { message: string } } & T;
  if (!res.ok || body.error) throw new Error(body.error?.message ?? `Request failed (${res.status})`);
  return body;
}

export async function createProfile(name: string): Promise<Profile> {
  const res = await callProfile<{ profile: Profile; token: string }>("/api/profile", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  saveStoredProfile({ token: res.token, profile: res.profile });
  return res.profile;
}

export async function renameProfile(name: string): Promise<Profile | null> {
  const stored = storedProfile();
  if (!stored) return null;
  const res = await callProfile<{ profile: Profile }>("/api/profile", { method: "PATCH", body: JSON.stringify({ name }) });
  saveStoredProfile({ token: stored.token, profile: res.profile });
  return res.profile;
}

/** Re-reads the record from the server and keeps the cached copy current. */
export async function refreshProfile(): Promise<Profile | null> {
  const stored = storedProfile();
  if (!stored) return null;
  const res = await callProfile<{ profile: Profile | null }>("/api/profile");
  if (!res.profile) { saveStoredProfile(null); return null; }
  saveStoredProfile({ token: stored.token, profile: res.profile });
  return res.profile;
}

/**
 * The live record for this device, refreshed on mount. Returns null when no
 * profile has been saved yet.
 */
export function useProfile(): { profile: Profile | null; token: string | null; create: (name: string) => Promise<Profile>; rename: (name: string) => Promise<Profile | null>; forget: () => void } {
  const stored = useStoredProfile();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!stored) return;
    void refreshProfile().catch(() => {}).then(() => setTick((t) => t + 1));
    // Only on the first mount of a session: the record changes when a round
    // is scored, and the pages that care refresh themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored?.token]);
  const create = useCallback((name: string) => createProfile(name), []);
  const rename = useCallback((name: string) => renameProfile(name), []);
  const forget = useCallback(() => saveStoredProfile(null), []);
  return useMemo(
    () => ({ profile: stored?.profile ?? null, token: stored?.token ?? null, create, rename, forget }),
    [stored, create, rename, forget],
  );
}
