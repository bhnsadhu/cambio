import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ rpc: vi.fn() }));
import { rpc } from "./db";
import { profilesForPlayers } from "./table-profiles";

beforeEach(() => { vi.mocked(rpc).mockReset(); });

describe("public table profile details", () => {
  it("includes only seated accounts and only the fields needed for tiers and friend requests", async () => {
    vi.mocked(rpc).mockImplementation(async (_name, args) => ({
      me: { id: args.p_id, handle: "player", points: 180, displayName: "Player", rank: 2, roundsWon: 5 },
      entries: [{ id: "unrelated-player", handle: "another", points: 3000 }],
      total: 200, offset: 0, nextOffset: 50,
    }));
    const profiles = await profilesForPlayers([
      { isBot: false, profileId: "seated-account" },
      { isBot: false, profileId: "seated-account" },
      { isBot: false, profileId: null },
      { isBot: true, profileId: "never-look-up-a-bot" },
    ]);
    expect(profiles).toEqual([{ id: "seated-account", handle: "player", points: 180 }]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("leaderboard_snapshot", { p_id: "seated-account", p_scope: "all", p_offset: 0 });
  });

  it("omits deleted accounts and does not query guest-only tables", async () => {
    vi.mocked(rpc).mockResolvedValue({ me: null, entries: [] });
    expect(await profilesForPlayers([{ isBot: false, profileId: "deleted-account" }])).toEqual([]);
    vi.mocked(rpc).mockClear();
    expect(await profilesForPlayers([{ isBot: false, profileId: null }, { isBot: true, profileId: null }])).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});
