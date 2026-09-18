import { joinGame } from "@/lib/server/store";
import { normaliseCode } from "@/lib/server/ids";
import { fail, ok } from "@/lib/server/http";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const { row, playerId, token } = await joinGame(normaliseCode(code), body.name ?? "");
    return ok({ code: row.code, playerId, token });
  } catch (e) {
    return fail(e);
  }
}
