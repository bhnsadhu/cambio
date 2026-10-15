import { INTRO_SCRIPT } from "./motion";
import { THEME_SCRIPT } from "./theme";

/**
 * Marks a browser that holds a saved account (the profile key in
 * src/lib/client/profile.ts) before first paint. Pages render the guest view
 * on the server for everyone; with this mark, an account holder's browser
 * keeps that guest view hidden until it knows which view to show.
 */
const ACCOUNT_SCRIPT = `try{if(localStorage.getItem("cambio:profile"))document.documentElement.setAttribute("data-account","")}catch(e){}`;

/** Inlined into the document head; runs before anything paints. */
export const PREPAINT_SCRIPT = THEME_SCRIPT + INTRO_SCRIPT + ACCOUNT_SCRIPT;
