import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ rpc: vi.fn() }));
import { rpc } from "./db";
import { updateAccount } from "./account";

const account = { profile: { id: "account-id", display_name: "Current name", avatar_id: 4 }, username: "currentuser", password_hash: "current-hash" };
const request = () => new Request("http://localhost/api/account", { method: "PATCH", headers: {
  origin: "http://localhost", cookie: `cambio_session=${"x".repeat(43)}`,
} });
beforeEach(() => {
  vi.mocked(rpc).mockReset();
  vi.mocked(rpc).mockImplementation(async (name) => name === "account_session" ? account : { ...account, profile: { ...account.profile, avatar_id: 0 } });
});

describe("Account avatar updates", () => {
  it("saves the first avatar without rotating sessions or overwriting unrelated fields", async () => {
    const result = await updateAccount(request(), { avatarId: 0 });
    expect(result.token).toBeNull();
    expect(vi.mocked(rpc)).toHaveBeenCalledWith("account_update", expect.objectContaining({
      p_avatar_id: 0, p_display_name: null, p_username: null, p_password_hash: null,
      p_next_session_hash: null, p_expected_hash: "current-hash",
    }));
    expect(vi.mocked(rpc)).not.toHaveBeenCalledWith("account_rate_limit", expect.anything());
  });
  it.each([-1, 6, 0.5, "2", null, false, {}, []])("rejects malformed avatar choice %j before a write", async (avatarId) => {
    await expect(updateAccount(request(), { avatarId })).rejects.toMatchObject({ code: "AVATAR", status: 400 });
    expect(vi.mocked(rpc)).not.toHaveBeenCalledWith("account_update", expect.anything());
  });
  it("preserves the selected avatar when only the display name is updated", async () => {
    await updateAccount(request(), { displayName: "New name" });
    expect(vi.mocked(rpc)).toHaveBeenCalledWith("account_update", expect.objectContaining({ p_avatar_id: null, p_display_name: "New name", p_username: null }));
  });
  it("requires the owner's live session", async () => {
    vi.mocked(rpc).mockResolvedValue(null);
    await expect(updateAccount(request(), { avatarId: 2 })).rejects.toMatchObject({ code: "SESSION", status: 401 });
    expect(vi.mocked(rpc)).not.toHaveBeenCalledWith("account_update", expect.anything());
  });
  it("rejects cross-origin avatar writes", async () => {
    const req = request();
    req.headers.set("origin", "http://another-site.test");
    await expect(updateAccount(req, { avatarId: 2 })).rejects.toMatchObject({ code: "ORIGIN", status: 403 });
    expect(vi.mocked(rpc)).not.toHaveBeenCalled();
  });
});
