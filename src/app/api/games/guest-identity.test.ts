import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionEnvelope } from "@/lib/game/types";
import type { GameRow } from "@/lib/server/store";
import { applyAction } from "@/lib/game/engine";
import { projectFor } from "@/lib/game/view";
import { makeCtx, started } from "@/lib/game/testkit";

const mock = vi.hoisted(() => ({
  createGame: vi.fn(), joinGame: vi.fn(), loadByCode: vi.fn(), runAction: vi.fn(), viewFor: vi.fn(),
  profileByToken: vi.fn(), spawnBots: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/store", () => mock);
vi.mock("@/lib/server/social", () => ({ profileByToken: mock.profileByToken }));
vi.mock("@/lib/server/runner", () => ({ spawnBots: mock.spawnBots }));
import { POST as create } from "./route";
import { POST as join } from "./[code]/join/route";
import { POST as action } from "./[code]/actions/route";

const params = { params: Promise.resolve({ code: "TEST1" }) };
const ctx = makeCtx();
let row: GameRow;
function request(path: string, body: object, token?: string) {
  return new Request(`http://localhost/api/games${path}`, {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-cambio-token": token } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  const game = started(ctx, 2);
  row = { id: "game", code: "TEST1", version: 1, state: game.state, botLockUntil: null };
  const seat = { row, playerId: game.hostId, token: row.state.players[0].token };
  mock.profileByToken.mockResolvedValue(null);
  mock.createGame.mockResolvedValue(seat);
  mock.joinGame.mockResolvedValue(seat);
  mock.loadByCode.mockImplementation(async () => row);
  mock.runAction.mockImplementation(async (_id: string, envelope: ActionEnvelope) => {
    const result = applyAction(row.state, envelope, ctx);
    row = { ...row, state: result.state };
    return { row, result };
  });
  mock.viewFor.mockImplementation((value: GameRow, me: string | null) => projectFor(value.state, value.version, me, ctx.now));
});

describe.each(["create", "join"] as const)("guest avatar on %s", (kind) => {
  const send = (body: object) => kind === "create" ? create(request("", body)) : join(request("/TEST1/join", body, "saved-seat"), params);
  const mutation = () => kind === "create" ? mock.createGame : mock.joinGame;
  const args = (name: string, profileId: string | undefined, avatarId: number | null | undefined) => kind === "create"
    ? [name, profileId, avatarId] : ["TEST1", name, profileId, avatarId, "saved-seat"];

  it.each([0, 17, 35])("passes selected avatar %i to the guest seat", async (avatarId) => {
    expect((await send({ name: "Guest", avatarId })).status).toBe(200);
    expect(mutation()).toHaveBeenCalledExactlyOnceWith(...args("Guest", undefined, avatarId));
  });

  it("keeps omitted avatars backward compatible", async () => {
    expect((await send({ name: "Guest" })).status).toBe(200);
    expect(mutation()).toHaveBeenCalledExactlyOnceWith(...args("Guest", undefined, undefined));
  });

  it.each([null, -1, 36, 0.5, "3", {}])("rejects invalid guest avatar %j before saving a game", async (avatarId) => {
    expect((await send({ name: "Guest", avatarId })).status).toBe(409);
    expect(mutation()).not.toHaveBeenCalled();
  });

  it.each([null, 35])("uses an account's saved identity, including avatar %j, over the request body", async (avatarId) => {
    mock.profileByToken.mockResolvedValue({ id: "account", displayName: "Account name", avatarId });
    expect((await send({ name: "Spoofed name", avatarId: "invalid guest input" })).status).toBe(200);
    expect(mutation()).toHaveBeenCalledExactlyOnceWith(...args("Account name", "account", avatarId));
  });
});

describe("guest identity action authorization", () => {
  const edit = (token?: string, extra: object = {}) => action(request("/TEST1/actions", {
    actionId: "guest-edit", action: { type: "setGuestIdentity", name: "New Guest", avatarId: 35, ...extra },
  }, token), params);

  it("uses only the requesting token's seat even if another player id is supplied", async () => {
    const before = structuredClone(row.state);
    const response = await edit(before.players[1].token, { playerId: before.players[0].id });
    expect(response.status).toBe(200);
    expect(row.state.players[0]).toEqual(before.players[0]);
    expect(row.state.players[1]).toEqual({ ...before.players[1], name: "New Guest", avatarId: 35 });
    expect(row.state.turn).toEqual(before.turn);
    expect(mock.runAction).toHaveBeenCalledWith(row.id, expect.objectContaining({ playerId: before.players[1].id }));
  });

  it.each([undefined, "wrong-token"])("rejects unauthorized token %j before applying an action", async (token) => {
    expect((await edit(token)).status).toBe(401);
    expect(mock.runAction).not.toHaveBeenCalled();
  });

  it("cannot use an account's old guest token after signup", async () => {
    row.state.players[0].profileId = "account";
    expect((await edit(row.state.players[0].token)).status).toBe(401);
    expect(mock.runAction).not.toHaveBeenCalled();
  });

  it("requires account profile editing even when the account session is valid", async () => {
    row.state.players[0].profileId = "account";
    mock.profileByToken.mockResolvedValue({ id: "account" });
    const response = await edit(row.state.players[0].token);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_TARGET" } });
    expect(row.state.players[0].name).toBe("Host");
  });
});
