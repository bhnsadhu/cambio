import { profileByToken, socialFor } from "@/lib/server/social";
import { fail, ok, profileTokenFrom } from "@/lib/server/http";

/** Friends, requests in both directions, open invites and past opponents. */
export async function GET(req: Request) {
  try {
    const me = await profileByToken(profileTokenFrom(req));
    if (!me) return ok({ profile: null, social: null });
    return ok({ profile: me, social: await socialFor(me.id) });
  } catch (e) {
    return fail(e);
  }
}
