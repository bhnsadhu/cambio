import { sessionTokenFrom } from "@/lib/server/account";
import { tokenHash } from "@/lib/server/passwords";
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
    const body = (await req.json().catch(() => ({}))) as { code?: string | null; token?: string; profileId?: string; tabId?: string; sequence?: number; online?: boolean };
    // A `sendBeacon` on the way out cannot set headers, so the token may
    // arrive in the body instead.
    const me = await profileByToken(profileTokenFrom(req) ?? body.token ?? null);
    if (!me) return ok({ ok: true });
    // A queued heartbeat/beacon from the previous account can arrive after
    // the cookie has switched. It must never update the new account's tabs.
    if ((body.profileId && body.profileId !== me.id)
      || (body.token?.startsWith("account:") && body.token !== `account:${me.id}`)) return ok({ ok: true });
    if (typeof body.tabId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.tabId) || !Number.isSafeInteger(body.sequence) || body.sequence! < 1 || typeof body.online !== "boolean") {
      return ok({ error: { message: "Invalid presence update." } }, { status: 400 });
    }
    const session = sessionTokenFrom(req);
    const update = (code: string | null, phase: string | null, seats: number) =>
      setPresence(me.id, body.tabId!, body.sequence!, body.online!, session ? tokenHash(session) : null, code, phase, seats);
    if (!body.online) {
      await update(null, null, 0);
      return ok({ ok: true });
    }
    const code = body.code ? normaliseCode(body.code) : null;
    if (!code) {
      await update(null, null, 0);
      return ok({ ok: true });
    }
    const row = await loadByCode(code);
    if (!row || !row.state.players.some((p) => p.profileId === me.id && !p.isBot)) {
      await update(null, null, 0);
      return ok({ ok: true });
    }
    const humans = row.state.players.filter((p) => !p.isBot).length;
    // Seats only open up in the lobby: once a round is dealt they are set.
    const openSeats = row.state.phase === "lobby" ? Math.max(0, SEATS - humans) : 0;
    await update(code, row.state.phase, openSeats);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
