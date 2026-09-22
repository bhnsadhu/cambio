import { describe, expect, it } from "vitest";
import { displayNameValue, passwordValue, usernameForLookup, usernameValue } from "./validation";

describe("Account form validation", () => {
  it("normalizes usernames while preserving display names and passwords", () => {
    expect(usernameValue("  MixedCase42  ")).toBe("mixedcase42");
    expect(displayNameValue("  McKenzie  Lee ")).toBe("McKenzie Lee");
    expect(passwordValue("  My strong password  ")).toBe("  My strong password  ");
  });
  it("finds the same username with optional @ and capitalization", () => {
    for (const value of ["MixedCase42", "@MixedCase42", "  @mixedcase42  "]) {
      expect(usernameForLookup(value)).toBe(usernameValue("MixedCase42"));
    }
  });
  it("does not turn malformed friend searches into someone else's username", () => {
    for (const value of [null, {}, 42, "ab", "a b c", "a-b-c", "abc!", "@@abc", "x".repeat(19)]) {
      expect(usernameForLookup(value)).toBeNull();
    }
  });
  it("rejects missing values, malformed usernames, and weak or unbounded passwords", () => {
    for (const value of [null, {}, "ab", "a b c", "a/b", "x".repeat(19)]) expect(() => usernameValue(value)).toThrow();
    for (const value of [null, {}, "", "short", "x".repeat(129)]) expect(() => passwordValue(value)).toThrow();
    for (const value of [null, {}, "", "   ", "x".repeat(19), "CaMiLa"]) expect(() => displayNameValue(value)).toThrow();
  });
});
