import { loadByCode, playerForToken, runAction, viewFor } from "@/lib/server/store";
import { spawnBots } from "@/lib/server/runner";
import { normaliseCode } from "@/lib/server/ids";
import { fail, ok, tokenFrom } from "@/lib/server/http";
import { GameError } from "@/lib/game/engine";
import type { Action } from "@/lib/game/types";

const ACTION_TYPES = new Set<Action["type"]>([
  "start", "advance", "draw", "place", "swap", "callCambio", "peekOwn", "peekOther",
  "blindSwap", "kingLook", "kingDecide", "skipPower", "stick", "give", "playAgain", "timeout",
]);

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const body = (await req.json().catch(() => ({}))) as { actionId?: string; action?: Action };
    if (!body.actionId || typeof body.actionId !== "string" || !body.action || !ACTION_TYPES.has(body.action.type)) {
      throw new GameError("INVALID_TARGET", "Malformed action.");
    }
    const row = await loadByCode(normaliseCode(code));
    if (!row) throw new GameError("NOT_FOUND", "No table with that code.");
    const me = playerForToken(row.state, tokenFrom(req));
    if (!me) return ok({ error: { code: "UNAUTHORISED", message: "You are not seated at this table." } }, { status: 401 });

    const { row: after, result } = await runAction(row.id, { actionId: body.actionId, playerId: me, action: body.action });
    spawnBots(after.id);
    return ok({ view: viewFor(after, me), me, note: result.note ?? null });
  } catch (e) {
    return fail(e);
  }
}
