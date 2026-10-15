import { rpc } from "@/lib/server/db";
import { fail } from "@/lib/server/http";
import type { LeaderboardSnapshot } from "@/lib/social/leaderboard";

/**
 * Public, read only player count for the README badge. It runs the same
 * query as the global leaderboard, so the number always matches the "N
 * players" line there, and only the count leaves this route: no names,
 * usernames, or account data.
 */
export async function GET(req: Request) {
  try {
    const { total } = await rpc<LeaderboardSnapshot>("leaderboard_snapshot", { p_id: null, p_scope: "all", p_offset: 0 });
    // shields.io endpoint badge format: https://shields.io/badges/endpoint-badge
    const body = new URL(req.url).searchParams.get("format") === "shields"
      ? { schemaVersion: 1, label: "players", message: total.toLocaleString("en-US"), color: "4ff0a8" }
      : { players: total };
    return Response.json(body, { headers: { "cache-control": "public, max-age=60, s-maxage=60" } });
  } catch (error) { return fail(error); }
}
