import { createGame } from "@/lib/server/store";
import { profileIdForToken } from "@/lib/server/social";
import { fail, ok, profileTokenFrom } from "@/lib/server/http";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const profileId = await profileIdForToken(profileTokenFrom(req));
    const { row, playerId, token } = await createGame(body.name ?? "", profileId);
    return ok({ code: row.code, playerId, token });
  } catch (e) {
    return fail(e);
  }
}
