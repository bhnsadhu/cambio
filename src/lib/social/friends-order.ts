import type { Friend } from "./types";

/**
 * Seat membership wins over presence while viewing a table. On other pages,
 * use the presence service's shared-table status instead.
 *
 * Rank each group by points (the source of badge tiers), highest first.
 * Equal points keep the server's order. Return the row's `here` flag so
 * its position and its invitation controls agree.
 */
export function orderFriends(friends: readonly Friend[], seated: readonly string[] | null = null) {
  const seats = seated === null ? null : new Set(seated);
  const rows = friends.map((friend) => ({
    friend,
    here: seats === null ? friend.online && !!friend.playing?.together : seats.has(friend.id),
  }));
  const group = (row: (typeof rows)[number]) => row.here ? 0 : row.friend.online ? 1 : 2;
  return rows.sort((a, b) => group(a) - group(b) || b.friend.points - a.friend.points);
}
