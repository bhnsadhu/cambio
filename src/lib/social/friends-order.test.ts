import { describe, expect, it } from "vitest";
import { orderFriends } from "./friends-order";
import type { Friend, LiveGame } from "./types";

function friend(id: string, values: Partial<Friend> = {}): Friend {
  return {
    id, handle: id, displayName: id, points: 0, roundsWon: 0, roundsPlayed: 0,
    since: null, online: false, lastSeenAt: null, playing: null,
    playedTogether: 0, yourWins: 0, theirWins: 0,
    ...values,
  };
}

function playing(together: boolean): LiveGame {
  return { tableId: "table", together, doNotDisturb: false, phase: "playing", openSeats: 0 };
}

describe("friends list order", () => {
  it("ranks friends within each presence group while keeping seated friends first", () => {
    const friends = [
      friend("offline-low"),
      friend("other-table", { online: true, points: 180, playing: playing(false) }),
      friend("here-offline", { points: 60 }),
      friend("online", { online: true, points: 400 }),
      friend("here-online", { online: true, points: 800, playing: playing(true) }),
      friend("online-same-tier", { online: true, points: 450 }),
      friend("offline-high", { points: 3000 }),
    ];

    const rows = orderFriends(friends, ["here-offline", "here-online"]);
    expect(rows.map(({ friend }) => friend.id)).toEqual([
      "here-online", "here-offline", "online-same-tier", "online", "other-table", "offline-high", "offline-low",
    ]);
    expect(rows.filter(({ here }) => here).map(({ friend }) => friend.id)).toEqual(["here-online", "here-offline"]);
    expect(friends.map(({ id }) => id)).toEqual(["offline-low", "other-table", "here-offline", "online", "here-online", "online-same-tier", "offline-high"]);
  });

  it("uses current seats instead of a stale shared-table presence flag", () => {
    const friends = [
      friend("online", { online: true }),
      friend("previous-table", { online: true, playing: playing(true) }),
      friend("current-table"),
    ];

    expect(orderFriends(friends, ["current-table"]).map(({ friend, here }) => [friend.id, here])).toEqual([
      ["current-table", true], ["online", false], ["previous-table", false],
    ]);
    expect(orderFriends(friends, []).every(({ here }) => !here)).toBe(true);
  });

  it("uses live shared-table presence on the home page", () => {
    const friends = [
      friend("expired", { playing: playing(true) }),
      friend("other-table", { online: true, playing: playing(false) }),
      friend("together", { online: true, playing: playing(true) }),
      friend("offline"),
    ];

    expect(orderFriends(friends).map(({ friend, here }) => [friend.id, here])).toEqual([
      ["together", true], ["other-table", false], ["expired", false], ["offline", false],
    ]);
  });

  it("moves friends as presence and seating change without shuffling peers", () => {
    const friends = [friend("first"), friend("second", { online: true }), friend("third")];
    expect(orderFriends(friends, []).map(({ friend }) => friend.id)).toEqual(["second", "first", "third"]);

    const refreshed = friends.map((value) => ({ ...value, online: value.id !== "second" }));
    expect(orderFriends(refreshed, []).map(({ friend }) => friend.id)).toEqual(["first", "third", "second"]);
    expect(orderFriends(refreshed, ["second"]).map(({ friend }) => friend.id)).toEqual(["second", "first", "third"]);
    expect(orderFriends(refreshed, []).map(({ friend }) => friend.id)).toEqual(["first", "third", "second"]);
  });
});
