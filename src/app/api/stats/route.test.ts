import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/db", () => db);
import { GET } from "./route";

const snapshot = {
  entries: [{ id: "player-1", handle: "dummyhandle", displayName: "Dummy Player", avatarId: 3, points: 40, roundsWon: 2, roundsPlayed: 6, rank: 1 }],
  me: null,
  total: 1234,
  offset: 0,
  nextOffset: 50,
};

beforeEach(() => {
  vi.resetAllMocks();
  db.rpc.mockResolvedValue(snapshot);
});

describe("public player count", () => {
  it("returns only the global leaderboard total from the same query", async () => {
    const response = await GET(new Request("http://localhost/api/stats"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ players: 1234 });
    expect(db.rpc).toHaveBeenCalledWith("leaderboard_snapshot", { p_id: null, p_scope: "all", p_offset: 0 });
  });

  it("is cached for 60 seconds", async () => {
    const response = await GET(new Request("http://localhost/api/stats"));

    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
  });

  it("serves the shields.io endpoint badge format without any player names", async () => {
    const response = await GET(new Request("http://localhost/api/stats?format=shields"));
    const text = await response.text();

    expect(JSON.parse(text)).toEqual({ schemaVersion: 1, label: "players", message: "1,234", color: "4ff0a8" });
    for (const secret of ["player-1", "dummyhandle", "Dummy Player"]) expect(text).not.toContain(secret);
  });

  it("does not cache a failed lookup", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.rpc.mockRejectedValue(new Error("leaderboard_snapshot: unavailable"));

    const response = await GET(new Request("http://localhost/api/stats"));

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
