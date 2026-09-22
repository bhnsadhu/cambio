import { playerForRequest } from "@/lib/server/identity";
import { loadByCode, viewFor } from "@/lib/server/store";
import { normaliseCode } from "@/lib/server/ids";
import { fail, ok } from "@/lib/server/http";
import { GameError } from "@/lib/game/engine";

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const row = await loadByCode(normaliseCode(code));
    if (!row) throw new GameError("NOT_FOUND", "No table with that code.");
    const player = await playerForRequest(row.state, req);
    const me = player?.id ?? null;
    return ok({ view: viewFor(row, me), me, seat: player ? { playerId: player.id, token: player.token, name: player.name } : null });
  } catch (e) {
    return fail(e);
  }
}
