import { beforeEach, describe, expect, it, vi } from "vitest";

const social = vi.hoisted(() => ({
  profileByToken: vi.fn(),
  profileByUsername: vi.fn(),
  requestFriend: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/social", () => social);
import { POST } from "./route";

function request(body: object) {
  return new Request("http://localhost/api/social/friends", {
    method: "POST",
    headers: { "content-type": "application/json", "x-cambio-profile": "viewer-token" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  social.profileByToken.mockResolvedValue({ id: "viewer" });
  social.profileByUsername.mockResolvedValue({ id: "tablemate", handle: "theirname" });
  social.requestFriend.mockResolvedValue("sent");
});

describe("friend requests from a player card", () => {
  it("rejects a reused username instead of sending to the new owner", async () => {
    social.profileByUsername.mockResolvedValue({ id: "new-owner", handle: "theirname" });

    const response = await POST(request({ username: "theirname", expectedProfileId: "tablemate" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_TARGET" } });
    expect(social.requestFriend).not.toHaveBeenCalled();
  });

  it("does not send when the old username is no longer assigned", async () => {
    social.profileByUsername.mockResolvedValue(null);

    const response = await POST(request({ username: "theirname", expectedProfileId: "tablemate" }));

    expect(response.status).toBe(404);
    expect(social.requestFriend).not.toHaveBeenCalled();
  });

  it("sends to the displayed account when the username still belongs to it", async () => {
    const response = await POST(request({ username: "theirname", expectedProfileId: "tablemate" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "sent", profile: { id: "tablemate" } });
    expect(social.profileByToken).toHaveBeenCalledWith("viewer-token");
    expect(social.requestFriend).toHaveBeenCalledExactlyOnceWith("viewer", "tablemate");
  });

  it.each([{ username: "theirname" }, { handle: "theirname" }])("preserves username-only requests: %j", async (body) => {
    social.requestFriend.mockResolvedValue("accepted");

    const response = await POST(request(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "accepted" });
    expect(social.profileByUsername).toHaveBeenCalledWith("theirname");
    expect(social.requestFriend).toHaveBeenCalledExactlyOnceWith("viewer", "tablemate");
  });
});
