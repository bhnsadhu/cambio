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
