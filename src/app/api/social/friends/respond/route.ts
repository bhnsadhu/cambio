import { profileByToken, respondToFriend } from "@/lib/server/social";
import { fail, ok, requireProfileToken } from "@/lib/server/http";
import { GameError } from "@/lib/game/engine";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { profileId?: string; accept?: boolean };
    const me = await profileByToken(requireProfileToken(req));
    if (!me || !body.profileId) throw new GameError("NOT_FOUND", "That request is no longer there.");
    return ok({ outcome: await respondToFriend(me.id, body.profileId, body.accept === true) });
  } catch (e) {
    return fail(e);
  }
}
