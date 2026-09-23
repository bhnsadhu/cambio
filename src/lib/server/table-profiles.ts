import "server-only";
import type { PlayerPublic } from "@/lib/game/types";
import type { LeaderboardSnapshot } from "@/lib/social/leaderboard";
import type { TableProfile } from "@/lib/social/types";
import { rpc } from "./db";

/** Public account details for the table's at-most-four seats. */
export async function profilesForPlayers(players: Pick<PlayerPublic, "isBot" | "profileId">[]): Promise<TableProfile[]> {
  const ids = [...new Set(players.filter((p) => !p.isBot && p.profileId).map((p) => p.profileId!))];
  const profiles = await Promise.all(ids.map(async (id) => {
    // The existing all-player standings read can select any public profile
    // by id. Keep only its public username and points, not the rest of the ladder.
    const snapshot = await rpc<LeaderboardSnapshot>("leaderboard_snapshot", { p_id: id, p_scope: "all", p_offset: 0 });
    const profile = snapshot.me;
    return profile ? { id: profile.id, handle: profile.handle, points: profile.points } : null;
  }));
  return profiles.filter((p): p is TableProfile => p !== null);
}
