import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// OWASP scrypt parameters: N=2^15, r=8, p=3 (32 MiB).
const PARAMS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const PREFIX = "scrypt$32768$8$3";
const DUMMY = `${PREFIX}$${"00".repeat(16)}$${"00".repeat(64)}`;

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, Buffer.from(salt, "hex"), 64, PARAMS, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return `${PREFIX}$${salt}$${(await derive(password, salt)).toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
  const valid = typeof encoded === "string" && /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded);
  const parts = (valid ? encoded : DUMMY).split("$");
  const candidate = await derive(password, parts[4]);
  const matches = timingSafeEqual(candidate, Buffer.from(parts[5], "hex"));
  return valid && matches;
}

export function newSessionToken(): string { return randomBytes(32).toString("base64url"); }
export function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
