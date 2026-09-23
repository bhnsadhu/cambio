/** A seat at a table, remembered per join code so a closed tab can come back. */
export interface Session {
  playerId: string;
  token: string;
  name: string;
}

const key = (code: string) => `cambio:seat:${code.toUpperCase()}`;

export function loadSession(code: string): Session | null {
  try {
    const raw = localStorage.getItem(key(code));
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(code: string, s: Session) {
  try { localStorage.setItem(key(code), JSON.stringify(s)); } catch { /* private mode etc. */ }
}

export function clearSession(code: string) {
  try { localStorage.removeItem(key(code)); } catch { /* ignore */ }
}

/** Credentials prove which existing guest seats a newly created account owns. */
export function savedSeats(): { code: string; token: string }[] {
  const seats: { code: string; token: string }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const code = /^cambio:seat:([A-Z0-9]{5})$/.exec(localStorage.key(i) ?? "")?.[1];
      if (!code) continue;
      const seat = loadSession(code);
      if (typeof seat?.token === "string" && seat.token) seats.push({ code, token: seat.token });
    }
  } catch { /* Storage is optional. */ }
  const current = recentTable()?.code;
  seats.sort((a, b) => Number(b.code === current) - Number(a.code === current));
  return seats.slice(0, 20);
}

/** One recent visit, not a history of the browser's saved seats. */
const RECENT_TABLE_KEY = "cambio:recent-table";
export const RECENT_TABLE_MS = 30 * 60 * 1000;
export interface RecentTable { code: string; visitedAt: number }
const recentListeners = new Set<() => void>();

export function recentTable(now = Date.now()): RecentTable | null {
  try {
    const raw = localStorage.getItem(RECENT_TABLE_KEY);
    const value = raw ? JSON.parse(raw) as RecentTable : null;
    return value && /^[A-Z0-9]{5}$/.test(value.code) && Number.isFinite(value.visitedAt)
      && value.visitedAt <= now && now - value.visitedAt < RECENT_TABLE_MS ? value : null;
  } catch { return null; }
}

export function rememberTable(code: string) {
  try { localStorage.setItem(RECENT_TABLE_KEY, JSON.stringify({ code: code.toUpperCase(), visitedAt: Date.now() })); } catch { /* Storage is optional. */ }
  for (const listener of recentListeners) listener();
}

export function forgetRecentTable(code?: string) {
  if (code && recentTable()?.code !== code) return;
  try { localStorage.removeItem(RECENT_TABLE_KEY); } catch { /* Storage is optional. */ }
  for (const listener of recentListeners) listener();
}

export function subscribeRecentTable(listener: () => void): () => void {
  recentListeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === RECENT_TABLE_KEY || event.key === null) listener(); };
  window.addEventListener("storage", onStorage);
  return () => { recentListeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

export function lastName(): string {
  try { return localStorage.getItem("cambio:name") ?? ""; } catch { return ""; }
}

export function rememberName(name: string) {
  try { localStorage.setItem("cambio:name", name); } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* Session store (for useSyncExternalStore; SSR snapshot is null)      */
/* ------------------------------------------------------------------ */

const cache = new Map<string, Session | null>();
const listeners = new Set<() => void>();

export function getSessionSnapshot(code: string): Session | null {
  if (!cache.has(code)) cache.set(code, loadSession(code));
  return cache.get(code) ?? null;
}

export function getServerSessionSnapshot(): Session | null {
  return null;
}

export function setSessionValue(code: string, s: Session | null) {
  if (s) saveSession(code, s); else clearSession(code);
  cache.set(code, s);
  for (const l of listeners) l();
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/* Remembered display name, readable during render without hydration drift. */
const nameListeners = new Set<() => void>();
let nameCache: string | null = null;

export function getStoredName(): string {
  if (nameCache === null) nameCache = lastName();
  return nameCache;
}
export function getServerStoredName(): string { return ""; }
export function subscribeStoredName(l: () => void): () => void {
  nameListeners.add(l);
  return () => { nameListeners.delete(l); };
}
export function storeName(name: string) {
  rememberName(name);
  nameCache = name;
  for (const l of nameListeners) l();
}

/** A new account must never inherit another account's cached game seats. */
export function clearAllSessions() {
  forgetRecentTable();
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith("cambio:seat:")) localStorage.removeItem(key);
    }
  } catch { /* Storage can be disabled. */ }
  cache.clear();
  for (const listener of listeners) listener();
}
