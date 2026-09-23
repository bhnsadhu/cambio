import { joinGame } from "@/lib/server/store";
import { profileByToken } from "@/lib/server/social";
import { normaliseCode } from "@/lib/server/ids";
import { fail, ok, profileTokenFrom, tokenFrom } from "@/lib/server/http";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const profile = await profileByToken(profileTokenFrom(req));
    const { row, playerId, token } = await joinGame(normaliseCode(code), profile?.displayName ?? body.name ?? "", profile?.id, profile?.avatarId, tokenFrom(req));
    return ok({ code: row.code, playerId, token });
  } catch (e) {
    return fail(e);
  }
}
