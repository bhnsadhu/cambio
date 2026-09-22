import { AccountError } from "@/lib/account/validation";
import { rpc } from "@/lib/server/db";
import { fail, ok, profileTokenFrom } from "@/lib/server/http";
import { profileByToken } from "@/lib/server/social";
import type { LeaderboardSnapshot } from "@/lib/social/leaderboard";

export async function GET(req: Request) {
  try {
    const query = new URL(req.url).searchParams;
    const scope = query.get("scope") ?? "all";
    const rawOffset = query.get("offset") ?? "0";
    const offset = Number(rawOffset);
    if (!/^(0|[1-9][0-9]*)$/.test(rawOffset) || !Number.isSafeInteger(offset) || offset > 1_000_000 || (scope !== "all" && scope !== "friends")) {
      throw new AccountError("INPUT", "Choose Friends or All players to see the leaderboard.");
    }
    const me = await profileByToken(profileTokenFrom(req));
    if (scope === "friends" && !me) throw new AccountError("SESSION", "Log in to see your friends leaderboard.", 401);
    return ok(await rpc<LeaderboardSnapshot>("leaderboard_snapshot", { p_id: me?.id ?? null, p_scope: scope, p_offset: offset }));
  } catch (error) { return fail(error); }
}
