import { profileByToken } from "@/lib/server/social";
import { fail, ok, profileTokenFrom } from "@/lib/server/http";

/** Read old browser profiles so their owners can add permanent credentials. */
export async function GET(req: Request) {
  try { return ok({ profile: await profileByToken(profileTokenFrom(req)) }); }
  catch (error) { return fail(error); }
}

/** Old clients must not create new accounts with unrecoverable browser keys. */
export async function POST() {
  return ok({ error: { code: "UPGRADE", message: "Refresh Cambio to create an account with a username and password." } }, { status: 410 });
}
