import { describe, expect, it } from "vitest";
import { loginHref, returnPath } from "./navigation";

describe("Account return destinations", () => {
  it("resumes known screens and preserves a table or player", () => {
    for (const path of ["/", "/me", "/g/ABCDE", "/p/player123"]) expect(returnPath(path)).toBe(path);
    expect(loginHref("/g/ABCDE", "register")).toBe("/login?next=%2Fg%2FABCDE&mode=register");
  });
  it("cannot redirect outside the app or back into an authentication loop", () => {
    for (const path of [null, ["/me"], "https://example.com", "//example.com", "/\\example.com", "javascript:alert(1)", "/login", "/api/account", "/g/ABCDE/../../login", "/%2fexample.com", "/me?next=//example.com"]) {
      expect(returnPath(path)).toBe("/");
    }
  });
});
