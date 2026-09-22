import type { Action, PlayerView } from "@/lib/game/types";
import { profileToken } from "./profile";

export interface ApiError { code: string; message: string }

export class RequestError extends Error {
  code: string;
  status: number;
  constructor(status: number, err: ApiError) {
    super(err.message);
    this.code = err.code;
    this.status = status;
  }
}

async function call<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.token) headers["x-cambio-token"] = init.token;
  // A saved profile rides along, so the seat it takes is recorded under it.
  const profile = profileToken();
  if (profile) headers["x-cambio-profile"] = profile;
  const res = await fetch(path, { ...init, headers, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { error?: ApiError } & T;
  if (!res.ok || body.error) {
    throw new RequestError(res.status, body.error ?? { code: "HTTP", message: `Request failed (${res.status})` });
  }
  return body;
}

export interface Seat { code: string; playerId: string; token: string }
export interface StateResponse { view: PlayerView; me: string | null }
export interface ActionResponse extends StateResponse { note: { kind: "stick"; correct: boolean } | { kind: "cambio" } | null }

export const api = {
  create: (name: string) => call<Seat>("/api/games", { method: "POST", body: JSON.stringify({ name }) }),
  join: (code: string, name: string) => call<Seat>(`/api/games/${code}/join`, { method: "POST", body: JSON.stringify({ name }) }),
  state: (code: string, token: string | null) => call<StateResponse>(`/api/games/${code}/state`, { token }),
  action: (code: string, token: string, actionId: string, action: Action) =>
    call<ActionResponse>(`/api/games/${code}/actions`, { method: "POST", token, body: JSON.stringify({ actionId, action }) }),
  nudge: (code: string) => call<{ ok: true }>(`/api/games/${code}/nudge`, { method: "POST" }),
};
