import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { hashPassword, newSessionToken, tokenHash, verifyPassword } from "./passwords";

describe("Password and session credentials", () => {
  it("salts hashes, verifies the exact password, and rejects malformed hashes", async () => {
    const password = "  A Password With Spaces  ";
    const a = await hashPassword(password);
    const b = await hashPassword(password);
    expect(a).not.toBe(b);
    expect(a).not.toContain(password);
    expect(await verifyPassword(password, a)).toBe(true);
    expect(await verifyPassword(password.trim(), a)).toBe(false);
    expect(await verifyPassword(password.toLowerCase(), a)).toBe(false);
    expect(await verifyPassword(password, null)).toBe(false);
    expect(await verifyPassword(password, "not-a-hash")).toBe(false);
  });
  it("issues unpredictable tokens stored only as hashes", () => {
    const token = newSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSessionToken()).not.toBe(token);
    expect(tokenHash(token)).toHaveLength(64);
    expect(tokenHash(token)).not.toContain(token);
  });
});
