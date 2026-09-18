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
