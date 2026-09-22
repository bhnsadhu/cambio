import { createGame } from "@/lib/server/store";
import { profileByToken } from "@/lib/server/social";
import { fail, ok, profileTokenFrom } from "@/lib/server/http";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const profile = await profileByToken(profileTokenFrom(req));
    const { row, playerId, token } = await createGame(profile?.displayName ?? body.name ?? "", profile?.id);
    return ok({ code: row.code, playerId, token });
  } catch (e) {
    return fail(e);
  }
}
