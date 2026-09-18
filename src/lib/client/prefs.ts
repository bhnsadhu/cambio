"use client";

import { useSyncExternalStore } from "react";

/** Small per device preferences: onboarding and one time hints. */
export interface Prefs {
  onboarded?: boolean;
  sawPeekHint?: boolean;
  sawPowerHint?: boolean;
}

const KEY = "cambio:prefs";
let cache: Prefs | null = null;
const listeners = new Set<() => void>();
const SERVER: Prefs = {};

function read(): Prefs {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Prefs; } catch { cache = {}; }
  return cache;
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  cache = { ...read(), [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* private mode */ }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, read, () => SERVER);
}
