import { profileByToken, setPresence } from "@/lib/server/social";
import { loadByCode } from "@/lib/server/store";
import { normaliseCode } from "@/lib/server/ids";
import { fail, ok, profileTokenFrom } from "@/lib/server/http";
import { SEATS } from "@/lib/game/engine";

/**
 * Where this profile is playing, refreshed by its own client every so often.
 * The client only says which table; the phase and the open seats are read
 * from the table itself, so a friend's "join them" is never a guess.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { code?: string | null; token?: string };
    // A `sendBeacon` on the way out cannot set headers, so the token may
    // arrive in the body instead.
    const me = await profileByToken(profileTokenFrom(req) ?? body.token ?? null);
    if (!me) return ok({ ok: true });
    const code = body.code ? normaliseCode(body.code) : null;
    if (!code) {
      await setPresence(me.id, null, null, 0);
      return ok({ ok: true });
    }
    const row = await loadByCode(code);
    if (!row || !row.state.players.some((p) => p.profileId === me.id && !p.isBot)) {
      await setPresence(me.id, null, null, 0);
      return ok({ ok: true });
    }
    const humans = row.state.players.filter((p) => !p.isBot).length;
    // Seats only open up in the lobby: once a round is dealt they are set.
    const openSeats = row.state.phase === "lobby" ? Math.max(0, SEATS - humans) : 0;
    await setPresence(me.id, code, row.state.phase, openSeats);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
