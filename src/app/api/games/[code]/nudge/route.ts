import { loadByCode } from "@/lib/server/store";
import { spawnBots } from "@/lib/server/runner";
import { normaliseCode } from "@/lib/server/ids";
import { fail, ok } from "@/lib/server/http";
import { GameError } from "@/lib/game/engine";

/** Client watchdog: if the bots look stalled, ask the server to run them. */
export async function POST(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const row = await loadByCode(normaliseCode(code));
    if (!row) throw new GameError("NOT_FOUND", "No table with that code.");
    spawnBots(row.id);
    return ok({ ok: true }, { status: 202 });
  } catch (e) {
    return fail(e);
  }
}
