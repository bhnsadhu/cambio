import { createGame } from "@/lib/server/store";
import { fail, ok } from "@/lib/server/http";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const { row, playerId, token } = await createGame(body.name ?? "");
    return ok({ code: row.code, playerId, token });
  } catch (e) {
    return fail(e);
  }
}
