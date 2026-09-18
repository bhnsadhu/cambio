import { randomBytes, randomInt } from "node:crypto";
import type { EngineCtx } from "@/lib/game/engine";

/** Unambiguous alphabet: no 0/O, 1/I. 32^5 ≈ 33M codes. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 5;

export function newCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export function normaliseCode(raw: string): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
}

export function newId(): string {
  return randomBytes(9).toString("base64url");
}

export function engineCtx(): EngineCtx {
  return {
    now: Date.now(),
    rng: () => randomInt(0, 2 ** 31) / 2 ** 31,
    newId,
  };
}
