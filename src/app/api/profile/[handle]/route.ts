import { profileByHandle, profileByToken, socialFor } from "@/lib/server/social";
import { fail, ok, profileTokenFrom } from "@/lib/server/http";
import { GameError } from "@/lib/game/engine";

export type Relation = "self" | "friends" | "incoming" | "outgoing" | "none";

/** Anyone's profile by @handle, plus where the viewer stands with them. */
export async function GET(req: Request, { params }: { params: Promise<{ handle: string }> }) {
  try {
    const { handle } = await params;
    const profile = await profileByHandle(handle);
    if (!profile) throw new GameError("NOT_FOUND", "No player with that handle.");
    const me = await profileByToken(profileTokenFrom(req));
    let relation: Relation = "none";
    let playedTogether = 0;
    if (me) {
      if (me.id === profile.id) relation = "self";
      else {
        const social = await socialFor(me.id);
        const friend = social.friends.find((f) => f.id === profile.id);
        if (friend) { relation = "friends"; playedTogether = friend.playedTogether; }
        else if (social.incoming.some((f) => f.id === profile.id)) relation = "incoming";
        else if (social.outgoing.some((f) => f.id === profile.id)) relation = "outgoing";
        if (!playedTogether) {
          playedTogether = social.opponents.find((o) => o.id === profile.id)?.rounds ?? 0;
        }
      }
    }
    return ok({ profile, relation, playedTogether });
  } catch (e) {
    return fail(e);
  }
}
