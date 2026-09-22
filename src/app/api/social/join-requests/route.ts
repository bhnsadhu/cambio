import { GameError } from "@/lib/game/engine";
import { fail, ok, requireProfileToken } from "@/lib/server/http";
import { profileByToken, requestTableJoin } from "@/lib/server/social";

export async function POST(req: Request) {
  try {
    const me = await profileByToken(requireProfileToken(req));
    const body = await req.json() as { profileId?: string; tableId?: string };
    if (!me) throw new GameError("NOT_FOUND", "Log in to your account first.");
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(body.profileId ?? "") || !uuid.test(body.tableId ?? "")) {
      throw new GameError("INVALID_TARGET", "Pick a friend and their table.");
    }
    return ok({ outcome: await requestTableJoin(me.id, body.profileId!, body.tableId!) });
  } catch (e) { return fail(e); }
}
