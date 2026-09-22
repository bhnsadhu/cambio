import { createInvite, profileByToken } from "@/lib/server/social";
import { loadByCode } from "@/lib/server/store";
import { normaliseCode } from "@/lib/server/ids";
import { fail, ok, requireProfileToken } from "@/lib/server/http";
import { GameError } from "@/lib/game/engine";

/** Ask a friend to a table you are sitting at. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { profileId?: string; code?: string };
    const me = await profileByToken(requireProfileToken(req));
    if (!me) throw new GameError("NOT_FOUND", "That profile no longer exists.");
    const code = normaliseCode(body.code ?? "");
    if (!body.profileId || !code) throw new GameError("INVALID_TARGET", "Pick a friend and a table.");
    const row = await loadByCode(code);
    if (!row) throw new GameError("NOT_FOUND", "That table is gone.");
    // Only someone at the table can hand out its code.
    if (!row.state.players.some((p) => p.profileId === me.id)) {
      throw new GameError("INVALID_TARGET", "You are not seated at that table.");
    }
    return ok({ id: await createInvite(me.id, body.profileId, code) });
  } catch (e) {
    return fail(e);
  }
}
