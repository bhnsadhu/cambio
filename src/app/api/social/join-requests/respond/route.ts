import { GameError } from "@/lib/game/engine";
import { fail, ok, requireProfileToken } from "@/lib/server/http";
import { profileByToken, respondToTableJoin } from "@/lib/server/social";

export async function POST(req: Request) {
  try {
    const me = await profileByToken(requireProfileToken(req));
    const body = await req.json() as { requestId?: string; accept?: boolean };
    if (!me) throw new GameError("NOT_FOUND", "Log in to your account first.");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId ?? "") || typeof body.accept !== "boolean") {
      throw new GameError("INVALID_TARGET", "Choose a request to answer.");
    }
    return ok({ outcome: await respondToTableJoin(me.id, body.requestId!, body.accept) });
  } catch (e) { return fail(e); }
}
