import { loadByCode, playerForToken, viewFor } from "@/lib/server/store";
import { normaliseCode } from "@/lib/server/ids";
import { fail, ok, tokenFrom } from "@/lib/server/http";
import { GameError } from "@/lib/game/engine";

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const row = await loadByCode(normaliseCode(code));
    if (!row) throw new GameError("NOT_FOUND", "No table with that code.");
    const me = playerForToken(row.state, tokenFrom(req));
    return ok({ view: viewFor(row, me), me });
  } catch (e) {
    return fail(e);
  }
}
