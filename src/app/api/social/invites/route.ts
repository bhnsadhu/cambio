import { createInvite, profileByToken, socialFor } from "@/lib/server/social";
import { loadByCode } from "@/lib/server/store";
import { normaliseCode } from "@/lib/server/ids";
import { fail, ok, requireProfileToken } from "@/lib/server/http";
import { GameError, SEATS } from "@/lib/game/engine";
import type { InviteOutcome } from "@/lib/social/types";

/**
 * Ask a friend to the table you are sitting at.
 *
 * Every reason an invite would be pointless is checked here rather than left
 * for the other side to discover: the table has to still exist, still be open
 * and still have a seat. Friends at other tables can choose whether to join.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { profileId?: string; code?: string };
    const me = await profileByToken(requireProfileToken(req));
    if (!me) throw new GameError("NOT_FOUND", "That profile no longer exists.");
    const code = normaliseCode(body.code ?? "");
    if (!body.profileId || !code) throw new GameError("INVALID_TARGET", "Pick a friend and a table.");

    const refuse = (reason: Extract<InviteOutcome, { ok: false }>["reason"], message: string) =>
      ok({ outcome: { ok: false, reason, message } satisfies InviteOutcome });

    // You can only hand out a table you are actually sitting at.
    const row = await loadByCode(code);
    if (!row) return refuse("table-gone", "That table is gone.");
    if (!row.state.players.some((p) => p.profileId === me.id)) {
      return refuse("not-seated", "You are not seated at that table.");
    }
    // And only to someone you have actually added.
    const social = await socialFor(me.id);
    const friend = social.friends.find((f) => f.id === body.profileId);
    if (!friend) return refuse("not-friends", "You can only invite friends.");

    if (row.state.players.some((p) => p.profileId === friend.id)) {
      return refuse("here", `${friend.displayName} is already at this table.`);
    }
    if (row.state.phase !== "lobby") {
      return refuse("table-started", "This round has already started. Seats open up again between rounds.");
    }
    const humans = row.state.players.filter((p) => !p.isBot).length;
    if (humans >= SEATS) return refuse("table-full", "Every seat at this table is taken.");

    return ok({ outcome: await createInvite(me.id, friend.id, code) });
  } catch (e) {
    return fail(e);
  }
}
