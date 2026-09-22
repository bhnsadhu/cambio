import { peekInvite, presenceOf, profileByToken, respondToInvite } from "@/lib/server/social";
import { joinGame, loadByCode } from "@/lib/server/store";
import { fail, ok, requireProfileToken } from "@/lib/server/http";
import { GameError, SEATS } from "@/lib/game/engine";
import type { InviteAnswer } from "@/lib/social/types";

/**
 * Answer an invite. Accepting does not just acknowledge it — it takes the
 * seat and hands back the credentials for it, so the friend who said yes
 * lands *in* the game rather than at its front door, where the seat they were
 * offered may well have gone by the time they arrive.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { inviteId?: string; accept?: boolean };
    const me = await profileByToken(requireProfileToken(req));
    if (!me || !body.inviteId) throw new GameError("NOT_FOUND", "That invite is no longer open.");

    const refuse = (reason: Extract<InviteAnswer, { ok: false }>["reason"], message: string) =>
      ok({ answer: { ok: false, reason, message } satisfies InviteAnswer });

    if (body.accept !== true) {
      await respondToInvite(me.id, body.inviteId, false);
      return ok({ answer: { ok: true, code: "", seat: null } satisfies InviteAnswer });
    }

    const invite = await peekInvite(me.id, body.inviteId);
    if (!invite || invite.status !== "pending") return refuse("expired", "That invite is no longer open.");

    const row = await loadByCode(invite.code);
    if (!row) {
      await respondToInvite(me.id, body.inviteId, false);
      return refuse("gone", "That table is gone.");
    }

    // Already sitting there — nothing to join, just go.
    const seated = row.state.players.find((p) => p.profileId === me.id);
    if (seated) {
      await respondToInvite(me.id, body.inviteId, true);
      return ok({ answer: { ok: true, code: invite.code, seat: seated.token ? { playerId: seated.id, token: seated.token, name: seated.name } : null } satisfies InviteAnswer });
    }

    if (!row.state.players.some((p) => p.profileId === invite.from.id && !p.isBot)) {
      await respondToInvite(me.id, body.inviteId, false);
      return refuse("expired", "Your friend has left that table. Ask for a new invitation.");
    }

    // One seat at a time: leave the table you are at before taking another.
    const where = await presenceOf(me.id);
    if (where.code && where.code !== invite.code) {
      return refuse("busy", `Leave table ${where.code} first, then accept.`);
    }

    if (row.state.phase !== "lobby") return refuse("started", "That round has already started.");
    if (row.state.players.filter((p) => !p.isBot).length >= SEATS) {
      return refuse("full", "That table filled up.");
    }

    // Take the seat, then mark the invite answered: an invite is only spent
    // once it has actually put someone in a chair.
    const { row: after, playerId, token } = await joinGame(invite.code, me.displayName, me.id);
    await respondToInvite(me.id, body.inviteId, true);
    return ok({
      answer: {
        ok: true,
        code: after.code,
        seat: { playerId, token, name: me.displayName },
      } satisfies InviteAnswer,
    });
  } catch (e) {
    return fail(e);
  }
}
