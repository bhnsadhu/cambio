import { describe, expect, it } from "vitest";
import { applyAction } from "./engine";
import { makeCtx, started } from "./testkit";

describe("Account identity maintenance", () => {
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
  it("removes a deleted player's account link, name, and seat credential", () => {
    const ctx = makeCtx();
    const { state } = started(ctx);
    state.players[0].profileId = "account";
    const next = applyAction(state, { actionId: "delete", playerId: null, action: { type: "syncIdentity", profileId: "account", displayName: null } }, ctx).state;
    expect(next.players[0].name).toBe("Deleted player");
    expect(next.players[0].token).toBeUndefined();
    expect(next.players[0].profileId).toBeNull();
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
