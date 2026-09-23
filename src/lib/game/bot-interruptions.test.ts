import { describe, expect, it } from "vitest";
import { planBots } from "./bots";
import { act, card, makeCtx, rig, started } from "./testkit";
import type { BotDifficulty } from "./types";

describe("sticks are independent of turn powers", () => {
  for (const level of ["medium", "hard"] as BotDifficulty[]) {
    it(`${level} can stick its match while its own power is pending`, () => {
      const ctx = makeCtx(7);
      let { state } = started(ctx, 1);
      const bot = state.players[1];
      bot.difficulty = level;
      state = rig(state, bot.id, [card("own-seven", "7"), card("own-five", "5")]);
      state.cards["top-seven"] = card("top-seven", "7");
      state.discard.push("top-seven");
      state.botKnown[bot.id] = ["own-seven"];
      state.pendingPower = { playerId: bot.id, kind: "peekOwn" };
      const plans = planBots(state, ctx.now, () => 0.5).filter((plan) => plan.playerId === bot.id);
      expect(plans.some((plan) => plan.action.type === "peekOwn")).toBe(true);
      const stick = plans.find((plan) => plan.action.type === "stick")!;
      expect(stick.action).toEqual({ type: "stick", cardId: "own-seven" });
      state = act(state, bot.id, stick.action, ctx);
      expect(state.pendingPower?.kind).toBe("peekOwn");
      const peek = planBots(state, ctx.now, () => 0.5).find((plan) => plan.playerId === bot.id && plan.action.type === "peekOwn")!;
      expect(peek.action).toEqual({ type: "peekOwn", cardId: "own-five" });
      expect(act(state, bot.id, peek.action, ctx).pendingPower).toBeNull();
    });
  }
  it("easy learns not to repeat a wrong guess against an unchanged discard", () => {
    const ctx = makeCtx(8);
    let { state } = started(ctx, 1);
    const bot = state.players[1];
    bot.difficulty = "easy";
    state = rig(state, bot.id, [card("blind-five", "5")]);
    state.cards["top-two"] = card("top-two", "2");
    state.discard.push("top-two");
    state.botKnown[bot.id] = [];
    const jitter = (key: string) => key.includes(":guess:") ? 0 : 0.6;
    const guess = planBots(state, ctx.now, jitter).find((plan) => plan.playerId === bot.id && plan.action.type === "stick")!;
    expect(guess.action).toEqual({ type: "stick", cardId: "blind-five" });
    state = act(state, bot.id, guess.action, ctx);
    expect(state.botMissedTop?.[bot.id]).toBe("top-two");
    expect(planBots(state, ctx.now, jitter).some((plan) => plan.playerId === bot.id && plan.action.type === "stick")).toBe(false);
  });
  it("hard retains a negative king and declines a stick that only improves the opponent", () => {
    const ctx = makeCtx(9);
    let { state } = started(ctx, 1);
    const bot = state.players[1];
    bot.difficulty = "hard";
    state = rig(state, bot.id, [card("negative", "K", "H")]);
    state = rig(state, state.players[2].id, [card("opponent-king", "K", "S")]);
    state.cards["top-king"] = card("top-king", "K", "C");
    state.discard.push("top-king");
    state.botKnown[bot.id] = ["negative", "opponent-king"];
    expect(planBots(state, ctx.now, () => 0.5).some((plan) => plan.playerId === bot.id && plan.action.type === "stick")).toBe(false);
  });
});


describe("authoritative Cambio revalidation", () => {
  for (const difficulty of ["easy", "medium", "hard"] as const) {
    it(`${difficulty} cancels an otherwise legal planned call if a stick removes its lead`, () => {
      const ctx = makeCtx(23);
      const t = started(ctx, 4);
      let state = t.state;
      const caller = state.players[0];
      caller.isBot = true;
      caller.difficulty = difficulty;
      state = rig(state, caller.id, [card("caller-five", "5")]);
      state = rig(state, t.ids[1], [card("opponent-eight", "8"), card("opponent-nine", "9")]);
      state = rig(state, t.ids[2], [card("third-ten", "10"), card("third-jack", "J"), card("third-queen", "Q")]);
      state = rig(state, t.ids[3], [card("fourth-ten", "10"), card("fourth-jack", "J"), card("fourth-queen", "Q")]);
      state.cards["top-eight"] = card("top-eight", "8");
      state.discard.push("top-eight");
      state.turnsTaken = 8;
      state.botKnown[caller.id] = state.players.flatMap((p) => p.hand.filter((id): id is string => !!id));
      const call = planBots(state, ctx.now, () => 0.5).find((plan) => plan.playerId === caller.id && plan.action.type === "callCambio")!;
      expect(call).toBeDefined();
      expect(act(state, caller.id, call.action, ctx).phase).toBe("final");
      state = act(state, t.ids[1], { type: "stick", cardId: "opponent-eight" }, ctx);
      expect(state.phase).toBe("playing");
      expect(state.turn?.playerId).toBe(caller.id);
      expect(() => act(state, caller.id, call.action, ctx)).toThrow(/Reconsider Cambio/);
      expect(planBots(state, ctx.now, () => 0.5).some((plan) => plan.playerId === caller.id && plan.action.type === "draw")).toBe(true);
      // Humans retain the right to call according to their own judgment.
      state.players[0].isBot = false;
      expect(act(state, caller.id, call.action, ctx).phase).toBe("final");
    });
  }
});
