import { accountView, loginAccount, setSessionCookie } from "@/lib/server/account";
import { fail, ok } from "@/lib/server/http";

export async function POST(req: Request) {
  try {
    const { account, token } = await loginAccount(req, await req.json());
    return setSessionCookie(ok(accountView(account)), token);
  } catch (error) { return fail(error); }
}
