import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ rpc: vi.fn() }));
vi.mock("./passwords", async (original) => ({
  ...await original<typeof import("./passwords")>(),
  hashPassword: vi.fn(async () => "created-password-hash"),
}));
vi.mock("./store", () => ({ claimGuestSeats: vi.fn(), syncProfileGames: vi.fn() }));
import { rpc } from "./db";
import { tokenHash } from "./passwords";
import { claimGuestSeats, syncProfileGames } from "./store";
import { POST } from "@/app/api/account/route";

const account = { profile: { id: "account-id", display_name: "Guest name", avatar_id: 4 }, username: "guestaccount" };
const guestSeats = [{ code: "TEST1", token: "guest-token" }];
function request(extra: object, legacy = false) {
  return new Request("http://localhost/api/account", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", ...(legacy ? { "x-cambio-profile": "legacy-token" } : {}) },
    body: JSON.stringify({ username: "guestaccount", displayName: "Guest name", password: "guest-password", guestSeats, ...extra }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(rpc).mockImplementation(async (name, args) => {
    if (name === "account_rate_limit") return true;
    if (name === "account_register") return account;
    if (name === "account_update") return { ...account, profile: { ...account.profile, avatar_id: args.p_avatar_id } };
    throw new Error(`Unexpected call: ${name}`);
  });
  vi.mocked(claimGuestSeats).mockResolvedValue(undefined);
  vi.mocked(syncProfileGames).mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("guest avatar at signup", () => {
  it.each([0, 35])("saves avatar %i under the created session before upgrading seats", async (avatarId) => {
    const response = await POST(request({ avatarId }));
    const token = /cambio_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
    expect(response.status).toBe(201);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await response.json()).toMatchObject({ profile: { id: account.profile.id, avatarId }, warning: null });
    expect(rpc).toHaveBeenCalledWith("account_update", {
      p_session_hash: tokenHash(token!), p_expected_hash: "created-password-hash", p_display_name: null,
      p_username: null, p_password_hash: null, p_next_session_hash: null, p_avatar_id: avatarId,
    });
    expect(claimGuestSeats).toHaveBeenCalledWith(guestSeats, account.profile.id, "Guest name", avatarId);
    expect(syncProfileGames).toHaveBeenCalledWith(account.profile.id, "Guest name", avatarId);
  });

  it.each([null, -1, 36, "2"])("rejects invalid avatar %j before creating credentials", async (avatarId) => {
    const response = await POST(request({ avatarId }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "AVATAR" } });
    expect(rpc).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("preserves the legacy profile's avatar when no guest selection is supplied", async () => {
    const response = await POST(request({}, true));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ profile: { avatarId: 4 }, warning: null });
    expect(rpc).toHaveBeenCalledWith("account_register", expect.objectContaining({ p_legacy_hash: tokenHash("legacy-token") }));
    expect(rpc).not.toHaveBeenCalledWith("account_update", expect.anything());
  });

  it("delivers the created account and cookie when saving the avatar fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(rpc).mockImplementation(async (name) => {
      if (name === "account_rate_limit") return true;
      if (name === "account_register") return account;
      throw new Error("Avatar store unavailable");
    });
    const response = await POST(request({ avatarId: 35 }));
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("cambio_session=");
    expect(await response.json()).toMatchObject({ profile: { avatarId: 4 }, warning: expect.stringContaining("avatar could not be saved") });
    expect(claimGuestSeats).toHaveBeenCalledWith(guestSeats, account.profile.id, "Guest name", 4);
  });

  it("combines avatar and table sync warnings without losing the new session", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(rpc).mockImplementation(async (name) => {
      if (name === "account_rate_limit") return true;
      if (name === "account_register") return account;
      throw new Error("Avatar store unavailable");
    });
    vi.mocked(claimGuestSeats).mockRejectedValue(new Error("Table unavailable"));
    const response = await POST(request({ avatarId: 35 }));
    const result = await response.json();
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("cambio_session=");
    expect(result.warning).toContain("avatar could not be saved");
    expect(result.warning).toContain("table could not refresh");
  });
});
