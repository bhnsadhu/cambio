import { describe, expect, it } from "vitest";
import { applyAction, createGame, joinGame } from "./engine";
import { projectPublic } from "./view";
import { makeCtx, started } from "./testkit";

describe("Account identity maintenance", () => {
  it("claims a guest's existing hand during a paused round without creating another player", () => {
    const ctx = makeCtx();
    const { state, ids } = started(ctx);
    state.paused = true;
    const guest = state.players[1];
    const envelope = { actionId: "signup", playerId: null, action: {
      type: "claimIdentity" as const, token: guest.token!, profileId: "new-account", displayName: "New name", avatarId: 25,
    } };
    const result = applyAction(state, envelope, ctx);
    expect(result.changed).toBe(true);
    expect(result.state).toEqual({
      ...state,
      players: state.players.map((p) => p.id === ids[1] ? { ...p, profileId: "new-account", name: "New name", avatarId: 25 } : p),
      appliedActionIds: [...state.appliedActionIds, "signup"],
      updatedAt: ctx.now,
    });
    expect(applyAction(result.state, { ...envelope, actionId: "signup-retry" }, ctx).changed).toBe(false);
    const updated = applyAction(result.state, { actionId: "avatar-after-signup", playerId: null,
      action: { type: "syncIdentity", profileId: "new-account", displayName: "New name", avatarId: 33 } }, ctx).state;
    expect(updated.players).toHaveLength(4);
    expect(updated.players[1]).toEqual({ ...result.state.players[1], avatarId: 33 });
    expect(state.players[1].profileId).toBeNull();
  });
  it("cannot claim seats with another account, an invalid token, or an already seated profile", () => {
    const ctx = makeCtx();
    const { state } = started(ctx);
    state.players[0].profileId = "existing-account";
    for (const [token, profileId] of [["wrong-token", "new-account"], [state.players[0].token!, "new-account"], [state.players[1].token!, "existing-account"]]) {
      expect(applyAction(state, { actionId: ctx.newId(), playerId: null,
        action: { type: "claimIdentity", token, profileId, displayName: "Player" } }, ctx)).toEqual({ state, changed: false });
    }
  });
  it("updates a name even while paused without changing cards or timers", () => {
    const ctx = makeCtx();
    const { state } = started(ctx);
    state.players[0].profileId = "account";
    state.paused = true;
    const next = applyAction(state, { actionId: "rename", playerId: null, action: { type: "syncIdentity", profileId: "account", displayName: "McKenzie" } }, ctx).state;
    expect(next.players[0].name).toBe("McKenzie");
    expect(next.players[0].hand).toEqual(state.players[0].hand);
    expect(next.turn).toEqual(state.turn);
    expect(next.paused).toEqual(state.paused);
    expect(state.players[0].name).toBe("Host");
  });
  it("updates only the avatar during a paused game and publishes it without altering gameplay", () => {
    const ctx = makeCtx();
    const { state } = started(ctx);
    state.players[0].profileId = "account";
    state.players[0].avatarId = 1;
    state.paused = true;
    const result = applyAction(state, { actionId: "avatar", playerId: null, action: { type: "syncIdentity", profileId: "account", displayName: "Host", avatarId: 0 } }, ctx);
    expect(result.changed).toBe(true);
    expect(result.state.players[0]).toEqual({ ...state.players[0], avatarId: 0 });
    expect(result.state.turn).toEqual(state.turn);
    expect(result.state.paused).toBe(true);
    expect(projectPublic(result.state, 2, ctx.now).players[0].avatarId).toBe(0);
    expect(state.players[0].avatarId).toBe(1);
    expect(applyAction(result.state, { actionId: "same-avatar", playerId: null, action: { type: "syncIdentity", profileId: "account", displayName: "Host", avatarId: 0 } }, ctx).changed).toBe(false);
  });
  it("carries selected heads into created and joined seats while guests retain the default", () => {
    const ctx = makeCtx();
    const { state } = createGame("ABC123", "Host", ctx, "account", 5);
    const joined = joinGame(state, "Friend", ctx, "friend-account", 0).state;
    const guest = joinGame(joined, "Guest", ctx).state;
    expect(guest.players.map((p) => p.avatarId)).toEqual([5, 0, null]);
    expect(projectPublic(guest, 1, ctx.now).players.map((p) => p.avatarId)).toEqual([5, 0, null]);
  });
  it("preserves the head on name-only identity updates", () => {
    const ctx = makeCtx();
    const { state } = createGame("ABC123", "Host", ctx, "account", 3);
    const next = applyAction(state, { actionId: "rename", playerId: null, action: { type: "syncIdentity", profileId: "account", displayName: "New name" } }, ctx).state;
    expect(next.players[0].avatarId).toBe(3);
  });
  it("removes a deleted player's account link, name, and seat credential", () => {
    const ctx = makeCtx();
    const { state } = started(ctx);
    state.players[0].profileId = "account";
    const next = applyAction(state, { actionId: "delete", playerId: null, action: { type: "syncIdentity", profileId: "account", displayName: null } }, ctx).state;
    expect(next.players[0].name).toBe("Deleted player");
    expect(next.players[0].token).toBeUndefined();
    expect(next.players[0].profileId).toBeNull();
    expect(next.players[0].avatarId).toBeNull();
    expect(next.log.every((entry) => !entry.text.includes("Host"))).toBe(true);
    expect(next.players[0].hand).toEqual(state.players[0].hand);
  });
  it("scrubs the deleted name as a name, not as a substring of other words", () => {
    const ctx = makeCtx();
    const { state } = started(ctx);
    // Short names are legal, and this one sits inside words the log already uses.
    state.players[0].profileId = "account";
    state.players[0].name = "Al";
    state.log = [{ ...state.log[0], text: "Al called Cambio. Almost all of Alice's hand is down." }];
    const next = applyAction(state, { actionId: "delete", playerId: null, action: { type: "syncIdentity", profileId: "account", displayName: null } }, ctx).state;
    expect(next.log[0].text).toBe("Deleted player called Cambio. Almost all of Alice's hand is down.");
  });
});
