import { joinGame } from "@/lib/server/store";
import { profileIdForToken } from "@/lib/server/social";
import { normaliseCode } from "@/lib/server/ids";
import { fail, ok, profileTokenFrom } from "@/lib/server/http";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const profileId = await profileIdForToken(profileTokenFrom(req));
    const { row, playerId, token } = await joinGame(normaliseCode(code), body.name ?? "", profileId);
    return ok({ code: row.code, playerId, token });
  } catch (e) {
    return fail(e);
  }
}
