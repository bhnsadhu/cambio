import "server-only";
import type { NextResponse } from "next/server";
import { isAvatarId } from "@/lib/avatars";
import { AccountError, displayNameValue, passwordValue, usernameValue } from "@/lib/account/validation";
import { rpc } from "./db";
import { toProfile, type RawProfile } from "./social";
import { hashPassword, newSessionToken, tokenHash, verifyPassword } from "./passwords";

export const SESSION_COOKIE = "cambio_session";
interface RawAccount { profile: RawProfile; username: string; password_hash?: string }
interface Credentials { profile_id: string; username: string; password_hash: string }

export function sessionTokenFrom(req: Request): string | null {
  const value = req.headers.get("cookie")?.split(/;\s*/).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export function sameOrigin(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin || req.headers.get("sec-fetch-site") === "cross-site") {
    throw new AccountError("ORIGIN", "Open Cambio in this browser and try again.", 403);
  }
}

export function setSessionCookie(response: NextResponse, token: string | null) {
  response.cookies.set(SESSION_COOKIE, token ?? "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/",
    maxAge: token ? 60 * 60 * 24 * 30 : 0,
  });
  return response;
}

export function accountView(account: RawAccount) {
  return { profile: toProfile(account.profile), username: account.username };
}

async function accountRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  try { return await rpc<T>(fn, args); } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("accounts_username_key") || message.includes("profiles_handle_key")) throw new AccountError("USERNAME_TAKEN", "That username is already taken.", 409);
    if (message.includes("legacy_expired")) throw new AccountError("SESSION", "This saved profile is no longer available. Log in to your account.", 401);
    if (message.includes("session_expired")) throw new AccountError("SESSION", "Your session has ended. Log in again.", 401);
    throw error;
  }
}

export async function limitAccountRequests(req: Request, username?: string) {
  // Vercel supplies this header at its trusted edge. Never use an arbitrary
  // client supplied forwarded header as the sole password guessing limit.
  const ip = process.env.VERCEL ? req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ?? "unknown" : "local";
  const keys: [string, number][] = [[`ip:${ip}`, 80]];
  if (username) keys.push([`username:${username}`, 30]);
  for (const [key, limit] of keys) {
    const allowed = await rpc<boolean>("account_rate_limit", { p_key: tokenHash(key), p_limit: limit });
    if (!allowed) throw new AccountError("RATE_LIMIT", "Too many attempts. Try again in 15 minutes.", 429);
  }
}

export async function accountFor(req: Request): Promise<RawAccount | null> {
  const token = sessionTokenFrom(req);
  return token ? accountRpc<RawAccount | null>("account_session", { p_session_hash: tokenHash(token) }) : null;
}

export async function requireAccount(req: Request): Promise<RawAccount> {
  const account = await accountFor(req);
  if (!account) throw new AccountError("SESSION", "Log in to manage your account.", 401);
  return account;
}

export async function registerAccount(req: Request, body: Record<string, unknown>) {
  sameOrigin(req);
  const username = usernameValue(body.username);
  const name = displayNameValue(body.displayName);
  const password = passwordValue(body.password);
  if (body.avatarId !== undefined && !isAvatarId(body.avatarId)) {
    throw new AccountError("AVATAR", "Choose one of the available avatars.");
  }
  await limitAccountRequests(req, username);
  if (await accountFor(req)) throw new AccountError("SIGNED_IN", "Sign out before creating another account.", 409);
  const legacy = req.headers.get("x-cambio-profile");
  const token = newSessionToken();
  const passwordHash = await hashPassword(password);
  let account = await accountRpc<RawAccount>("account_register", {
    p_username: username, p_display_name: name, p_handle: username,
    p_password_hash: passwordHash, p_session_hash: tokenHash(token),
    p_legacy_hash: legacy ? tokenHash(legacy) : null,
  });
  let warning: string | null = null;
  if (body.avatarId !== undefined) {
    try {
      account = await accountRpc<RawAccount>("account_update", {
        p_session_hash: tokenHash(token), p_expected_hash: passwordHash,
        p_display_name: null, p_username: null, p_password_hash: null,
        p_next_session_hash: null, p_avatar_id: body.avatarId,
      });
    } catch (error) {
      console.error("[account signup avatar]", error);
      // Registration already committed. Deliver its session even if this
      // optional customization failed, so the new account remains accessible.
      warning = "Your account is created, but your avatar could not be saved. Choose your avatar again in your account.";
    }
  }
  return { account, token, warning };
}

export async function loginAccount(req: Request, body: Record<string, unknown>) {
  sameOrigin(req);
  const username = usernameValue(body.username);
  const password = passwordValue(body.password, false);
  await limitAccountRequests(req, username);
  const credentials = await accountRpc<Credentials | null>("account_credentials", { p_username: username });
  const valid = await verifyPassword(password, credentials?.password_hash ?? null);
  if (!credentials || !valid) throw new AccountError("CREDENTIALS", "Incorrect username or password.", 401);
  const token = newSessionToken();
  const account = await accountRpc<RawAccount>("account_session_create", {
    p_id: credentials.profile_id, p_expected_hash: credentials.password_hash, p_session_hash: tokenHash(token),
  });
  // Switching accounts must not leave the previous session usable.
  const previous = sessionTokenFrom(req);
  if (previous) await rpc("account_logout", { p_session_hash: tokenHash(previous) });
  return { account, token };
}

export async function verifyCurrentPassword(req: Request, account: RawAccount, raw: unknown) {
  await limitAccountRequests(req, account.username);
  if (!await verifyPassword(passwordValue(raw, false), account.password_hash ?? null)) {
    throw new AccountError("PASSWORD", "Your current password is incorrect.", 403);
  }
}

export async function updateAccount(req: Request, body: Record<string, unknown>) {
  sameOrigin(req);
  const account = await requireAccount(req);
  const name = body.displayName === undefined ? null : displayNameValue(body.displayName);
  const username = body.username === undefined ? null : usernameValue(body.username);
  const password = body.password === undefined ? null : passwordValue(body.password);
  if (body.avatarId !== undefined && !isAvatarId(body.avatarId)) {
    throw new AccountError("AVATAR", "Choose one of the available avatars.");
  }
  if (password !== null || (username !== null && username !== account.username)) await verifyCurrentPassword(req, account, body.currentPassword);
  const token = password === null ? null : newSessionToken();
  const updated = await accountRpc<RawAccount>("account_update", {
    p_session_hash: tokenHash(sessionTokenFrom(req)!), p_expected_hash: account.password_hash,
    p_display_name: name, p_username: username, p_password_hash: password === null ? null : await hashPassword(password),
    p_next_session_hash: token ? tokenHash(token) : null,
    p_avatar_id: body.avatarId ?? null,
  });
  return { account: updated, token };
}

export async function deleteAccount(req: Request, account: RawAccount) {
  await accountRpc("account_delete", { p_session_hash: tokenHash(sessionTokenFrom(req)!), p_expected_hash: account.password_hash });
}

export async function logoutAccount(req: Request) {
  sameOrigin(req);
  const token = sessionTokenFrom(req);
  if (token) await rpc("account_logout", { p_session_hash: tokenHash(token) });
}
