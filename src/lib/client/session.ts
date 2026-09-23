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
  try { localStorage.setItem(key(code), JSON.stringify({ ...s, savedAt: Date.now() })); } catch { /* private mode etc. */ }
}

/** Only locally remembered seats are candidates; the server verifies each one. */
export function recentSessions(): { code: string; session: Session }[] {
  try {
    return Object.keys(localStorage).filter((key) => /^cambio:seat:[A-Z0-9]{5}$/.test(key)).flatMap((key) => {
      try {
        const session = JSON.parse(localStorage.getItem(key) ?? "null");
        return typeof session?.token === "string" && typeof session.playerId === "string"
          ? [{ code: key.slice(-5), session, savedAt: Number(session.savedAt) || 0 }] : [];
      } catch { return []; }
    }).sort((a, b) => b.savedAt - a.savedAt).slice(0, 6);
  } catch { return []; }
}

export function clearSession(code: string) {
  try { localStorage.removeItem(key(code)); } catch { /* ignore */ }
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
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith("cambio:seat:")) localStorage.removeItem(key);
    }
  } catch { /* Storage can be disabled. */ }
  cache.clear();
  for (const listener of listeners) listener();
}
