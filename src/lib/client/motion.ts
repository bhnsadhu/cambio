/**
 * The motion language outside live play, matched to the table's own: ease
 * out, a short duration, a small stagger, transform and opacity only, run
 * through the Web Animations API so nothing touches layout.
 */
export const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
/** The two sided card's turn, as `.flip-inner` transitions it. */
export const EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";
export const ENTER_MS = 260;
export const STAGGER_MS = 60;
export const FLIP_MS = 300;
/** A loading state stays invisible this long, so a fast load never flashes it. */
export const LOADING_GRACE_MS = 400;

export function prefersReducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

const SEEN = "cambio:seen:";

export function seenThisSession(key: string): boolean {
  try { return sessionStorage.getItem(SEEN + key) === "1"; } catch { return false; }
}

export function markSeen(key: string) {
  try { sessionStorage.setItem(SEEN + key, "1"); } catch { /* Storage is optional; the entrance simply plays again. */ }
}

/**
 * True the first time a one time entrance is asked for in this browser
 * session, and never when the viewer prefers reduced motion.
 */
export function claimEntrance(key: string): boolean {
  if (prefersReducedMotion() || seenThisSession(key)) return false;
  markSeen(key);
  return true;
}

/**
 * Runs before first paint (inlined into the document head) and marks which
 * one time intros are still due, so their elements can start hidden instead
 * of painting their final state and then jumping back to the start.
 */
export const INTRO_SCRIPT = `try{var d=document.documentElement;if(!matchMedia("(prefers-reduced-motion: reduce)").matches&&sessionStorage.getItem("${SEEN}hero")!=="1")d.setAttribute("data-intro","hero")}catch(e){}`;

/** Takes a pending intro, so it plays exactly once. */
export function takeIntro(key: string): boolean {
  const root = document.documentElement;
  const due = (root.getAttribute("data-intro") ?? "").split(" ").filter(Boolean);
  if (!due.includes(key)) return false;
  const rest = due.filter((k) => k !== key);
  if (rest.length) root.setAttribute("data-intro", rest.join(" ")); else root.removeAttribute("data-intro");
  markSeen(key);
  return !prefersReducedMotion();
}
