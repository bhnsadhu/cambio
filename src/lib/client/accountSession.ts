"use client";

export const SESSION_REVISION_KEY = "cambio:session-revision";
const LOCK = "cambio:account-session";
let localChange: Promise<void> = Promise.resolve();

/** A public revision marker, never a credential. Read directly so another
 * tab's change invalidates a response even before its storage event runs. */
export function sessionRevision() {
  try { return localStorage.getItem(SESSION_REVISION_KEY) ?? ""; } catch { return ""; }
}
export function advanceSessionRevision() {
  try { localStorage.setItem(SESSION_REVISION_KEY, crypto.randomUUID()); } catch { /* Storage is optional. */ }
}

function locally<T>(work: () => Promise<T>): Promise<T> {
  const result = localChange.then(work);
  localChange = result.then(() => {}, () => {});
  return result;
}

/** Cookie changes are exclusive across tabs. The browser releases the lock
 * if a tab closes. Restricted browsers still coordinate within this tab. */
export async function withSessionChange<T>(work: () => Promise<T>): Promise<T> {
  let started = false;
  try {
    if (navigator.locks) return await navigator.locks.request(LOCK, async () => { started = true; return work(); });
  } catch (error) {
    if (started) throw error; // Never repeat a mutation that actually ran.
  }
  return locally(work);
}

/** Wait for a current change, then release before fetching. Slow reads must
 * never block logout; their revision checks discard obsolete responses. */
export async function waitForSessionChange() {
  try {
    if (navigator.locks) { await navigator.locks.request(LOCK, { mode: "shared" }, () => {}); return; }
  } catch { /* Storage access may be restricted. */ }
  await localChange;
}
