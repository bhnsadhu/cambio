import { createProfile, profileByToken, renameProfile } from "@/lib/server/social";
import { fail, ok, profileTokenFrom, requireProfileToken } from "@/lib/server/http";
import { GameError } from "@/lib/game/engine";

/** Save a profile on this device. The token it returns is the only key to it. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const { profile, token } = await createProfile(body.name ?? "");
    return ok({ profile, token });
  } catch (e) {
    return fail(e);
  }
}

export async function GET(req: Request) {
  try {
    const profile = await profileByToken(profileTokenFrom(req));
    return ok({ profile });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const me = await profileByToken(requireProfileToken(req));
    if (!me) throw new GameError("NOT_FOUND", "That profile no longer exists.");
    return ok({ profile: await renameProfile(me.id, body.name ?? "") });
  } catch (e) {
    return fail(e);
  }
}
