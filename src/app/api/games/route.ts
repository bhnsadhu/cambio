import { createGame } from "@/lib/server/store";
import { profileByToken } from "@/lib/server/social";
import { fail, ok, profileTokenFrom } from "@/lib/server/http";
import { isAvatarId } from "@/lib/avatars";
import { GameError } from "@/lib/game/engine";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: string; avatarId?: unknown };
    const profile = await profileByToken(profileTokenFrom(req));
    let avatarId = profile?.avatarId;
    if (!profile && body.avatarId !== undefined) {
      if (!isAvatarId(body.avatarId)) throw new GameError("INVALID_TARGET", "Choose a valid avatar.");
      avatarId = body.avatarId;
    }
    const { row, playerId, token } = await createGame(profile?.displayName ?? body.name ?? "", profile?.id, avatarId);
    return ok({ code: row.code, playerId, token });
  } catch (e) {
    return fail(e);
  }
}
