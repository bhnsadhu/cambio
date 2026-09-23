import { describe, expect, it } from "vitest";
import { loginHref, returnPath, settingsReturnPath } from "./navigation";

describe("Account return destinations", () => {
  it("resumes known screens and preserves a table or player", () => {
    for (const path of ["/", "/me", "/g/ABCDE", "/p/player123", "/leaderboard", "/leaderboard?scope=friends", "/leaderboard?scope=all"]) expect(returnPath(path)).toBe(path);
    expect(loginHref("/g/ABCDE", "register")).toBe("/login?next=%2Fg%2FABCDE&mode=register");
  });
  it("cannot redirect outside the app or back into an authentication loop", () => {
    for (const path of [null, ["/me"], "https://example.com", "//example.com", "/\\example.com", "javascript:alert(1)", "/login", "/api/account", "/g/ABCDE/../../login", "/%2fexample.com", "/me?next=//example.com"]) {
      expect(returnPath(path)).toBe("/");
    }
  });
  it("preserves settings context through authentication without nesting return loops", () => {
    for (const from of ["/g/ABCDE", "/p/player123", "/leaderboard?scope=friends", "record"]) {
      const path = `/me?${new URLSearchParams({ from })}`;
      expect(returnPath(path)).toBe(path);
      expect(new URLSearchParams(loginHref(path).split("?")[1]).get("next")).toBe(path);
      expect(settingsReturnPath(path)).toBe(from === "record" ? "/" : from);
    }
    for (const from of ["//example.com", "https://example.com", "/login", "/me", "/me?from=record"]) {
      expect(returnPath(`/me?${new URLSearchParams({ from })}`)).toBe("/");
    }
    expect(returnPath("/me?from=record&from=%2Fg%2FABCDE")).toBe("/");
  });
});
