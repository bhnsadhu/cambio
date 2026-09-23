"use client";

import { useSyncExternalStore } from "react";
import { isAvatarId } from "@/lib/avatars";

export interface GuestIdentity { name: string; avatarId: number | null }

const KEY = "cambio:guest-player";
const listeners = new Set<() => void>();
let current: GuestIdentity | null | undefined;

/** Appearance is temporary to this tab; a saved account owns lasting identity. */
export function guestIdentity(): GuestIdentity | null {
  if (typeof window === "undefined") return null;
  if (current !== undefined) return current;
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as GuestIdentity | null;
    current = value && typeof value.name === "string" && value.name.length <= 18
      && (value.avatarId === null || isAvatarId(value.avatarId)) ? value : null;
  } catch { current = null; }
  return current;
}

export function storeGuestIdentity(value: GuestIdentity) {
  current = { name: value.name.trim(), avatarId: isAvatarId(value.avatarId) ? value.avatarId : null };
  try { sessionStorage.setItem(KEY, JSON.stringify(current)); } catch { /* Still works for this visit without storage. */ }
  for (const listener of listeners) listener();
}

export function clearGuestIdentity() {
  current = null;
  try { sessionStorage.removeItem(KEY); } catch { /* Storage is optional. */ }
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const serverSnapshot = () => null;
export function useGuestIdentity() { return useSyncExternalStore(subscribe, guestIdentity, serverSnapshot); }
