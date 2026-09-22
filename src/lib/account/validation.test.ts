import { describe, expect, it } from "vitest";
import { displayNameValue, passwordValue, usernameValue } from "./validation";

describe("Account form validation", () => {
  it("normalizes only the login username", () => {
    expect(usernameValue("  MixedCase42  ")).toBe("mixedcase42");
    expect(displayNameValue("  McKenzie  Lee ")).toBe("McKenzie Lee");
    expect(passwordValue("  My strong password  ")).toBe("  My strong password  ");
  });
  it("rejects missing values, malformed usernames, and weak or unbounded passwords", () => {
    for (const value of [null, {}, "ab", "a b c", "a/b", "x".repeat(19)]) expect(() => usernameValue(value)).toThrow();
    for (const value of [null, {}, "", "short", "x".repeat(129)]) expect(() => passwordValue(value)).toThrow();
    for (const value of [null, {}, "", "   ", "x".repeat(19), "CaMiLa"]) expect(() => displayNameValue(value)).toThrow();
  });
});
