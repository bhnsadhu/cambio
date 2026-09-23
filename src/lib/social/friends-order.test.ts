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
  it("puts seated friends first even when their presence has expired", () => {
    const friends = [
      friend("offline"),
      friend("other-table", { online: true, playing: playing(false) }),
      friend("here-offline"),
      friend("online", { online: true }),
      friend("here-online", { online: true, playing: playing(true) }),
    ];

    const rows = orderFriends(friends, ["here-offline", "here-online"]);
    expect(rows.map(({ friend }) => friend.id)).toEqual([
      "here-offline", "here-online", "other-table", "online", "offline",
    ]);
    expect(rows.filter(({ here }) => here).map(({ friend }) => friend.id)).toEqual(["here-offline", "here-online"]);
    expect(friends.map(({ id }) => id)).toEqual(["offline", "other-table", "here-offline", "online", "here-online"]);
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
