import { profileByToken, respondToInvite } from "@/lib/server/social";
import { fail, ok, requireProfileToken } from "@/lib/server/http";
import { GameError } from "@/lib/game/engine";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { inviteId?: string; accept?: boolean };
    const me = await profileByToken(requireProfileToken(req));
    if (!me || !body.inviteId) throw new GameError("NOT_FOUND", "That invite is no longer open.");
    const code = await respondToInvite(me.id, body.inviteId, body.accept === true);
    return ok({ code: code ?? null });
  } catch (e) {
    return fail(e);
  }
}
