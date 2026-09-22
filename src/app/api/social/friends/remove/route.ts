import { profileByToken, removeFriend } from "@/lib/server/social";
import { fail, ok, requireProfileToken } from "@/lib/server/http";
import { GameError } from "@/lib/game/engine";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { profileId?: string };
    const me = await profileByToken(requireProfileToken(req));
    if (!me || !body.profileId) throw new GameError("NOT_FOUND", "No such friend.");
    await removeFriend(me.id, body.profileId);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
