import { profileByToken, socialChannel, socialFor } from "@/lib/server/social";
import { fail, ok, profileTokenFrom } from "@/lib/server/http";

/** Friends, requests in both directions, open invites and past opponents. */
export async function GET(req: Request) {
  try {
    const me = await profileByToken(profileTokenFrom(req));
    if (!me) return ok({ profile: null, social: null });
    const [social, channel] = await Promise.all([socialFor(me.id), socialChannel(me.id)]);
    return ok({ profile: me, social, channel });
  } catch (e) {
    return fail(e);
  }
}
