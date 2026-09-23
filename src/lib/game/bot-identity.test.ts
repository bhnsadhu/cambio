import { describe, expect, it } from "vitest";
import { act, card, makeCtx, rig, rigDeck, settleFinalTurns, started, table } from "./testkit";
import { projectPublic } from "./view";

const expected = [
  { name: "Cameron", avatarId: 0 },
  { name: "Camila", avatarId: 1 },
  { name: "Cami", avatarId: 5 },
];

describe("house bot identities", () => {
  it("assigns fixed avatars when bots fill seats, independent of player ids and table", () => {
    const botIds = [];
    for (const offset of [0, 13]) {
      const ctx = makeCtx(7);
      for (let i = 0; i < offset; i++) ctx.newId();
      const t = table(ctx, 1);
      const state = act(t.state, t.hostId, { type: "start" }, ctx);
      const bots = state.players.filter((p) => p.isBot);
      expect(bots.map(({ name, avatarId }) => ({ name, avatarId }))).toEqual(expected);
      botIds.push(bots.map((p) => p.id));
    }
    expect(botIds[0]).not.toEqual(botIds[1]);
  });

  it("repairs display of older saved bot seats without changing human choices or stored state", () => {
    const ctx = makeCtx();
    const { state, hostId } = started(ctx, 1);
    for (const bot of state.players.filter((p) => p.isBot)) delete bot.avatarId;
    // The fixed identity also replaces an old arbitrary bot avatar.
    state.players.find((p) => p.name === "Camila")!.avatarId = 22;
    const human = state.players.find((p) => p.id === hostId)!;
    human.name = "Cameron";
    human.avatarId = 35;
    const before = structuredClone(state);
    const view = projectPublic(state, 1, ctx.now);
    expect(view.players.filter((p) => p.isBot).map(({ name, avatarId }) => ({ name, avatarId }))).toEqual(expected);
    expect(view.players.find((p) => p.id === hostId)!.avatarId).toBe(35);
    expect(state).toEqual(before);
  });

  it("preserves each bot's face after scoring and dealing the next round", () => {
    const ctx = makeCtx(7);
    const t = started(ctx, 1);
    let state = rig(t.state, t.hostId, [card("host-nine", "9")]);
    state = act(state, t.hostId, { type: "callCambio" }, ctx);
    for (const bot of state.players.filter((p) => p.isBot)) {
      state = rigDeck(state, [card(`last-${bot.id}`, "2")]);
      state = act(state, bot.id, { type: "draw" }, ctx);
      state = act(state, bot.id, { type: "place" }, ctx);
    }
    state = settleFinalTurns(state, ctx);
    expect(state.phase).toBe("scoring");
    state = act(state, t.hostId, { type: "playAgain" }, ctx);
    expect(state.phase).toBe("ready");
    expect(state.round).toBe(2);
    expect(state.players.filter((p) => p.isBot).map(({ name, avatarId }) => ({ name, avatarId }))).toEqual(expected);
    expect(projectPublic(state, 2, ctx.now).players.filter((p) => p.isBot).map(({ name, avatarId }) => ({ name, avatarId }))).toEqual(expected);
  });
});
