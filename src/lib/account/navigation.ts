/** Only actual app destinations can be resumed after authentication. */
export function returnPath(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  if (raw === "/" || raw === "/me") return raw;
  if (/^\/leaderboard(?:\?scope=(all|friends))?$/.test(raw)) return raw;
  if (/^\/g\/[A-Z0-9]{5}$/i.test(raw) || /^\/p\/[a-z0-9]{3,18}$/i.test(raw)) return raw;
  if (raw.startsWith("/me?")) {
    const query = new URLSearchParams(raw.slice(4));
    const from = query.get("from");
    // Preserve the settings return link through login without accepting a
    // nested settings/login destination or an external redirect.
    if (query.size === 1 && from && (from === "record" || (!from.startsWith("/me") && returnPath(from) === from))) {
      return `/me?${new URLSearchParams({ from })}`;
    }
  }
  return "/";
}

export function settingsReturnPath(next: string): string {
  if (!next.startsWith("/me")) return next;
  const from = new URLSearchParams(next.split("?")[1]).get("from");
  return from === "record" ? "/" : returnPath(from);
}

export function loginHref(next = "/", mode: "login" | "register" = "login") {
  const query = new URLSearchParams();
  const path = returnPath(next);
  if (path !== "/") query.set("next", path);
  if (mode === "register") query.set("mode", mode);
  return `/login${query.size ? `?${query}` : ""}`;
}

export function backLabel(path: string) {
  return path.startsWith("/g/") ? "Back to the table" : path.startsWith("/p/") ? "Back to the profile" : path.startsWith("/leaderboard") ? "Back to the leaderboard" : "Back to play";
}
