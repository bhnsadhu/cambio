import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./social", () => ({ profileByToken: vi.fn() }));
vi.mock("./http", () => ({ profileTokenFrom: (req: Request) => req.headers.get("cookie"), tokenFrom: (req: Request) => req.headers.get("x-cambio-token") }));
import { playerForRequest } from "./identity";
import { profileByToken } from "./social";
import type { GameState } from "@/lib/game/types";

const state = { players: [
  { id: "account-seat", profileId: "profile-a", token: "seat-token", isBot: false },
  { id: "guest-seat", token: "guest-token", isBot: false },
] } as GameState;
const req = (token?: string) => new Request("http://localhost", { headers: token ? { "x-cambio-token": token } : {} });
beforeEach(() => vi.mocked(profileByToken).mockResolvedValue(null));

describe("Game account authorization", () => {
  it("revokes account seats on logout even with a saved seat token", async () => {
    expect(await playerForRequest(state, req("seat-token"))).toBeNull();
  });
  it("does not let a different account take over a seat", async () => {
    vi.mocked(profileByToken).mockResolvedValue({ id: "profile-b" } as never);
    expect(await playerForRequest(state, req("seat-token"))).toBeNull();
  });
  it("recovers the account seat after all browser storage is cleared", async () => {
    vi.mocked(profileByToken).mockResolvedValue({ id: "profile-a" } as never);
    expect((await playerForRequest(state, req()))?.id).toBe("account-seat");
  });
  it("keeps guest play independent of accounts", async () => {
    expect((await playerForRequest(state, req("guest-token")))?.id).toBe("guest-seat");
  });
});
