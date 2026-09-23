"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Profile } from "@/lib/social/types";
import { clearAllSessions, storeName } from "./session";
import { advanceSessionRevision, SESSION_REVISION_KEY, sessionRevision, waitForSessionChange, withSessionChange } from "./accountSession";

const KEY = "cambio:profile";
/** `token` is a public identity marker for accounts. Only legacy profiles
 * retain a browser credential, until they are upgraded. Account credentials
 * live in an HttpOnly cookie and are never stored in JavaScript. */
export interface StoredProfile { token: string; profile: Profile; username?: string | null }
let cache: StoredProfile | null | undefined;
let ready = false;
let generation = 0;
let pending: Promise<Profile | null> | null = null;
let accountNotice: string | null = null;
const listeners = new Set<() => void>();
function emit() { for (const listener of listeners) listener(); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function profileGeneration() { return `${generation}:${sessionRevision()}`; }

function read(): StoredProfile | null {
  if (cache !== undefined) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    cache = parsed?.profile?.id && typeof parsed.token === "string" ? parsed : null;
  } catch { cache = null; }
  return cache ?? null;
}
export function storedProfile() { return read(); }
export function profileToken(): string | null {
  const token = read()?.token;
  return token && !token.startsWith("account:") ? token : null;
}
export function saveStoredProfile(value: StoredProfile | null, forGeneration?: string) {
  if (forGeneration !== undefined && forGeneration !== profileGeneration()) return;
  if (value === null) { generation += 1; clearAllSessions(); }
  cache = value;
  try {
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
  } catch { /* Storage is optional. The account lives on the server. */ }
  emit();
}
export function useStoredProfile() { return useSyncExternalStore(subscribe, read, () => null); }
export function useAccountReady() { return useSyncExternalStore(subscribe, () => ready, () => false); }
export function useAccountNotice() { return useSyncExternalStore(subscribe, () => accountNotice, () => null); }
export function dismissAccountNotice() { accountNotice = null; emit(); }

export async function callProfile<T>(path: string, init: RequestInit = {}): Promise<T> {
  const gen = profileGeneration();
  await waitForSessionChange();
  return fetchProfile<T>(path, init, gen);
}

async function fetchProfile<T>(path: string, init: RequestInit, gen: string): Promise<T> {
  const token = profileToken();
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("x-cambio-profile", token);
  const res = await fetch(path, { ...init, headers, credentials: "same-origin", cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message: string } } & T;
  if (!res.ok || body.error) {
    if (body.error?.code === "SESSION" && gen === profileGeneration()) saveStoredProfile(null, gen);
    throw new Error(body.error?.message ?? `Request failed (${res.status})`);
  }
  return body;
}

interface AccountResponse { profile: Profile; username: string; warning?: string | null }
function rememberAccount(res: AccountResponse, gen: string) {
  if (gen !== profileGeneration()) return;
  accountNotice = null;
  if (read()?.profile.id !== res.profile.id) clearAllSessions();
  saveStoredProfile({ token: `account:${res.profile.id}`, profile: res.profile, username: res.username }, gen);
  storeName(res.profile.displayName);
}
function changeAccount<T>(work: (gen: string) => Promise<T>): Promise<T> {
  return withSessionChange(async () => {
    ++generation;
    advanceSessionRevision();
    try { return await work(profileGeneration()); }
    finally { ++generation; advanceSessionRevision(); }
  });
}

export function authenticate(mode: "login" | "register", values: { username: string; password: string; displayName?: string }) {
  return changeAccount(async (gen) => {
    const res = await fetchProfile<AccountResponse>(mode === "login" ? "/api/account/login" : "/api/account", {
      method: "POST", body: JSON.stringify(values),
    }, gen);
    rememberAccount(res, gen);
    return res;
  });
}
export function updateAccount(values: { avatarId?: number; displayName?: string; username?: string; currentPassword?: string; password?: string }) {
  return changeAccount(async (gen) => {
    const res = await fetchProfile<AccountResponse>("/api/account", { method: "PATCH", body: JSON.stringify(values) }, gen);
    rememberAccount(res, gen);
    return res;
  });
}
export function signOut() {
  return changeAccount(async (gen) => {
    // Only clear the UI once the server has revoked the cookie session.
    await fetchProfile("/api/account/logout", { method: "POST" }, gen);
    accountNotice = "You are signed out. Your stats and friends are saved.";
    saveStoredProfile(null);
    storeName("");
  });
}
export function deleteAccount(currentPassword: string, confirmation: string) {
  return changeAccount(async (gen) => {
    await fetchProfile("/api/account", { method: "DELETE", body: JSON.stringify({ currentPassword, confirmation }) }, gen);
    accountNotice = "Your account was deleted.";
    saveStoredProfile(null);
    storeName("");
  });
}

export async function refreshProfile(): Promise<Profile | null> {
  // Concurrent screens share one request. A generation change discards any
  // response that began before login, logout, deletion, or account edits.
  if (pending) return pending;
  const gen = profileGeneration();
  pending = (async () => {
    const res = await callProfile<{ profile: Profile | null; username: string | null }>("/api/account");
    if (gen !== profileGeneration()) return read()?.profile ?? null;
    if (res.profile && res.username) {
      rememberAccount({ profile: res.profile, username: res.username }, gen);
      return res.profile;
    }
    const legacy = profileToken();
    if (legacy) {
      const old = await callProfile<{ profile: Profile | null }>("/api/profile");
      saveStoredProfile(old.profile ? { token: legacy, profile: old.profile, username: null } : null, gen);
      return old.profile;
    }
    if (read()) saveStoredProfile(null, gen);
    return null;
  })().finally(() => { pending = null; ready = true; emit(); });
  return pending;
}

/** Restore the account on every visit, including after browser cache clearing. */
export function AccountSession() {
  useEffect(() => {
    const refresh = () => { void refreshProfile().catch(() => {}); };
    refresh();
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    const storage = (event: StorageEvent) => {
      if (event.key === SESSION_REVISION_KEY) { generation += 1; refresh(); return; }
      if (event.key !== KEY && event.key !== null) return;
      const previous = read()?.token;
      generation += 1;
      cache = undefined;
      if (read()?.token !== previous) clearAllSessions();
      emit();
      refresh();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("storage", storage);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("storage", storage);
    };
  }, []);
  return null;
}
