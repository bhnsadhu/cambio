import {
  accountFor, accountView, deleteAccount, registerAccount, requireAccount,
  sameOrigin, setSessionCookie, updateAccount, verifyCurrentPassword,
} from "@/lib/server/account";
import { AccountError } from "@/lib/account/validation";
import { fail, ok } from "@/lib/server/http";
import { syncProfileGames } from "@/lib/server/store";

export async function GET(req: Request) {
  try {
    const account = await accountFor(req);
    return ok(account ? accountView(account) : { profile: null, username: null });
  } catch (error) { return fail(error); }
}

export async function POST(req: Request) {
  try {
    const { account, token } = await registerAccount(req, await req.json());
    // An upgrade retains its original profile ID and any existing seats.
    const warning = await refreshNames(account.profile.id, account.profile.display_name);
    return setSessionCookie(ok({ ...accountView(account), warning }, { status: 201 }), token);
  } catch (error) { return fail(error); }
}

export async function PATCH(req: Request) {
  try {
    const { account, token } = await updateAccount(req, await req.json());
    const warning = await refreshNames(account.profile.id, account.profile.display_name);
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

async function refreshNames(id: string, name: string): Promise<string | null> {
  try { await syncProfileGames(id, name); return null; }
  catch (error) {
    console.error("[account name sync]", error);
    // Credentials are already saved. Always deliver the rotated session cookie.
    return "Your account is saved. A table could not refresh its name. Save your display name again to retry.";
  }
}
