/**
 * Dark or light. The choice lives on <html data-theme> and in local storage;
 * with no saved choice, the system's preference decides.
 */
export type Theme = "dark" | "light";

const KEY = "cambio:theme";

/** Runs before first paint (inlined into the document head), so a page never paints in the wrong theme. */
export const THEME_SCRIPT = `(function(){var t;try{t=localStorage.getItem("${KEY}")}catch(e){}try{if(t!=="dark"&&t!=="light")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}catch(e){t="dark"}document.documentElement.setAttribute("data-theme",t)})();`;

export function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/** Switches at once: transitions are held for a frame so nothing is caught halfway between palettes. */
export function setTheme(theme: Theme) {
  const still = document.createElement("style");
  still.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.appendChild(still);
  document.documentElement.setAttribute("data-theme", theme);
  requestAnimationFrame(() => requestAnimationFrame(() => still.remove()));
  try { localStorage.setItem(KEY, theme); } catch { /* Storage is optional; the choice lasts this page. */ }
}
