import { logoutAccount, setSessionCookie } from "@/lib/server/account";
import { fail, ok } from "@/lib/server/http";

export async function POST(req: Request) {
  try {
    await logoutAccount(req);
    return setSessionCookie(ok({ ok: true }), null);
  } catch (error) { return fail(error); }
}
