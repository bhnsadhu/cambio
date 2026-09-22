import { profileByHandle, profileByToken, requestFriend } from "@/lib/server/social";
import { fail, ok, requireProfileToken } from "@/lib/server/http";
import { GameError } from "@/lib/game/engine";

/** Ask someone to be a friend, by the handle they share. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { handle?: string };
    const me = await profileByToken(requireProfileToken(req));
    if (!me) throw new GameError("NOT_FOUND", "That profile no longer exists.");
    const them = await profileByHandle(body.handle ?? "");
    if (!them) throw new GameError("NOT_FOUND", "No player with that handle.");
    const outcome = await requestFriend(me.id, them.id);
    if (outcome === "self") throw new GameError("INVALID_TARGET", "That is you.");
    return ok({ outcome, profile: them });
  } catch (e) {
    return fail(e);
  }
}
