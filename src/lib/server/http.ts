import "server-only";
import { NextResponse } from "next/server";
import { GameError } from "@/lib/game/engine";

export function ok(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { "cache-control": "no-store", ...(init?.headers ?? {}) } });
}

export function fail(e: unknown) {
  if (e instanceof GameError) {
    const status = e.code === "NOT_FOUND" ? 404 : 409;
    return ok({ error: { code: e.code, message: e.message } }, { status });
  }
  console.error(e);
  return ok({ error: { code: "SERVER", message: "Something went wrong on the server." } }, { status: 500 });
}

export function tokenFrom(req: Request): string | null {
  return req.headers.get("x-cambio-token");
}
