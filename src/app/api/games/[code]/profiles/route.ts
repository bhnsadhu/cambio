import { GameError } from "@/lib/game/engine";
import { normaliseCode } from "@/lib/server/ids";
import { fail, ok } from "@/lib/server/http";
import { loadByCode, viewFor } from "@/lib/server/store";
import { profilesForPlayers } from "@/lib/server/table-profiles";

/** Account tiers and usernames are public; friendship stays in the viewer's social snapshot. */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const row = await loadByCode(normaliseCode(code));
    if (!row) throw new GameError("NOT_FOUND", "No table with that code.");
    const profiles = await profilesForPlayers(viewFor(row, null).public.players);
    return ok({ profiles });
  } catch (error) { return fail(error); }
}
