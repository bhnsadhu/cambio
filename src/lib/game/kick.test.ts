import { describe, expect, it } from "vitest";
import { applyAction } from "./engine";
import { act, makeCtx, started, table } from "./testkit";
import { projectFor } from "./view";
import type { Phase } from "./types";

describe("Host player removal", () => {
  it("allows only the host to remove another human", () => {
    const ctx = makeCtx();
    const t = started(ctx, 2);
    expect(() => act(t.state, t.ids[1], { type: "kickPlayer", playerId: t.hostId }, ctx)).toThrow(/Only the host/);
    for (const id of [t.hostId, t.state.players.find((p) => p.isBot)!.id, "missing"]) {
      expect(() => act(t.state, t.hostId, { type: "kickPlayer", playerId: id }, ctx)).toThrow(/Choose another player/);
    }
  });
  it.each<Phase>(["lobby", "scoring"])("removes a player in %s, revokes their hand, and leaves a playable lobby", (phase) => {
    const ctx = makeCtx();
    const t = phase === "lobby" ? table(ctx, 3) : started(ctx, 3);
    t.state.phase = phase;
    t.state.paused = true;
    t.state.pausedAt = ctx.now;
    t.state.pausedBy = t.ids[1];
    t.state.pauseVote = { kind: "resume", byId: t.ids[1], agreed: [t.ids[1]], at: ctx.now };
    t.state.stickWindowUntil = ctx.now + 1000;
    const before = structuredClone(t.state);
    const env = { actionId: "kick-once", playerId: t.hostId, action: { type: "kickPlayer" as const, playerId: t.ids[1] } };
    const removed = applyAction(t.state, env, ctx).state;
    expect(t.state).toEqual(before);
    expect(removed.players.map((p) => p.id)).toEqual([t.hostId, t.ids[2]]);
    expect(removed.players.map((p) => p.seat)).toEqual([0, 1]);
    expect(removed).toMatchObject({ phase: "lobby", hostId: t.hostId, paused: false, pauseVote: null,
      pausedAt: null, pausedBy: null, stickWindowUntil: null, turn: null, pendingPower: null,
      pendingGives: [], readyIds: [], readyDeadline: null, replayVotes: [], reveals: [], tally: {},
    });
    expect(removed.results).toEqual(before.results);
    expect(projectFor(removed, 2, t.ids[1], ctx.now).private).toBeNull();
    expect(() => act(removed, t.ids[1], { type: "ready" }, ctx)).toThrow(/not seated/);
    expect(applyAction(removed, env, ctx).changed).toBe(false);
    expect(removed.log.at(-1)).toMatchObject({ kind: "kick", actorId: t.hostId, subjectIds: [t.ids[1]] });
    const next = act(removed, t.hostId, { type: "start" }, ctx);
    expect(next.phase).toBe("ready");
    expect(next.players).toHaveLength(4);
    expect(new Set(next.players.flatMap((p) => p.hand)).size).toBe(16);
  });

  it.each<Phase>(["ready", "peek", "playing", "final"])("replaces a removed player in %s without changing their cards or cancelling the round", (phase) => {
    const ctx = makeCtx();
    const t = started(ctx, 3);
    t.state.phase = phase;
    t.state.paused = true;
    t.state.pausedAt = ctx.now;
    t.state.pausedBy = t.ids[1];
    const before = structuredClone(t.state);
    const env = { actionId: "kick-once", playerId: t.hostId, action: { type: "kickPlayer" as const, playerId: t.ids[1] } };
    const removed = applyAction(t.state, env, ctx).state;
    expect(t.state).toEqual(before);
    const bot = removed.players[1];
    expect(bot).toMatchObject({ seat: 1, isBot: true, difficulty: "medium", hand: before.players[1].hand });
    expect(removed.players.filter((p) => p.id !== bot.id)).toEqual(before.players.filter((p) => p.id !== t.ids[1]));
    expect(removed).toMatchObject({ phase, round: before.round, hostId: t.hostId, paused: true, pausedBy: bot.id,
      cards: before.cards, deck: before.deck, discard: before.discard, turn: before.turn, results: before.results });
    expect(projectFor(removed, 2, t.ids[1], ctx.now).private).toBeNull();
    expect(removed.players.some((p) => p.id === t.ids[1] || p.token === before.players[1].token)).toBe(false);
    expect(applyAction(removed, env, ctx).changed).toBe(false);
    expect(removed.log.at(-1)).toMatchObject({ kind: "kick", actorId: t.hostId, subjectIds: [t.ids[1]] });
  });
});
