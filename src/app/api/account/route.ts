import {
  accountFor, accountView, deleteAccount, registerAccount, requireAccount,
  sameOrigin, setSessionCookie, updateAccount, verifyCurrentPassword,
} from "@/lib/server/account";
import { AccountError } from "@/lib/account/validation";
import { fail, ok } from "@/lib/server/http";
import { claimGuestSeats, syncProfileGames } from "@/lib/server/store";

export async function GET(req: Request) {
  try {
    const account = await accountFor(req);
    return ok(account ? accountView(account) : { profile: null, username: null });
  } catch (error) { return fail(error); }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { account, token } = await registerAccount(req, body);
    // An upgrade retains its original profile ID and any existing seats.
    const warning = await refreshIdentity(account.profile.id, account.profile.display_name, account.profile.avatar_id, body.guestSeats);
    return setSessionCookie(ok({ ...accountView(account), warning }, { status: 201 }), token);
  } catch (error) { return fail(error); }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { account, token } = await updateAccount(req, body);
    const warning = await refreshIdentity(account.profile.id, account.profile.display_name, account.profile.avatar_id, body.guestSeats);
    const response = ok({ ...accountView(account), warning });
    return token ? setSessionCookie(response, token) : response;
  } catch (error) { return fail(error); }
}

export async function DELETE(req: Request) {
  try {
    sameOrigin(req);
    const body = await req.json();
    if (body.confirmation !== "DELETE") throw new AccountError("CONFIRM", "Type DELETE to confirm account deletion.");
    const account = await requireAccount(req);
    await verifyCurrentPassword(req, account, body.currentPassword);
    await syncProfileGames(account.profile.id, null);
    await deleteAccount(req, account);
    return setSessionCookie(ok({ ok: true }), null);
  } catch (error) { return fail(error); }
}

async function refreshIdentity(id: string, name: string, avatarId?: number | null, guestSeats?: unknown): Promise<string | null> {
  try {
    await claimGuestSeats(guestSeats, id, name, avatarId);
    await syncProfileGames(id, name, avatarId);
    return null;
  }
  catch (error) {
    console.error("[account identity sync]", error);
    // Credentials are already saved. Always deliver the rotated session cookie.
    return "Your account is saved. A table could not refresh your profile. Save your profile again to retry.";
  }
}
