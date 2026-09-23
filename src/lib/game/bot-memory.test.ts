import { describe, expect, it } from "vitest";
import { act, makeCtx, started } from "./testkit";
import type { BotDifficulty } from "./types";

describe("difficulty-specific legitimate memory", () => {
  for (const difficulty of ["easy", "medium", "hard"] as BotDifficulty[]) {
    it(`${difficulty} learns a draw with its own memory capacity`, () => {
      const ctx = makeCtx(17);
      let { state } = started(ctx, 1);
      const bot = state.players[1];
      bot.difficulty = difficulty;
      const opening = bot.hand.slice(2) as string[];
      const others = state.players[2].hand.filter((id): id is string => !!id);
      state.botKnown[bot.id] = [...opening, ...others];
      state.turn = { playerId: bot.id, stage: "draw", drawnCardId: null, startedAt: ctx.now };
      state = act(state, bot.id, { type: "draw" }, ctx);
      const drawn = state.turn!.drawnCardId!;
      const remembered = state.botKnown[bot.id];
      expect(remembered).toContain(drawn);
      if (difficulty === "easy") expect(remembered).toEqual([others.at(-1), drawn]);
      else {
        expect(remembered).toEqual(expect.arrayContaining(opening));
        expect(remembered.filter((id) => others.includes(id))).toHaveLength(difficulty === "hard" ? 4 : 2);
      }
    });
  }
  it("records only the public keep/push behavior and clears it on discard", () => {
    const ctx = makeCtx(19);
    const t = started(ctx, 1);
    const hostId = t.hostId;
    let state = t.state;
    state.turn = { playerId: hostId, stage: "draw", drawnCardId: null, startedAt: ctx.now };
    state = act(state, hostId, { type: "draw" }, ctx);
    const drawn = state.turn!.drawnCardId!;
    state = act(state, hostId, { type: "swap", cardId: state.players[1].hand[0]! }, ctx);
    expect(state.botHints?.[drawn]).toBe("pushed");
    state.turn = { playerId: hostId, stage: "draw", drawnCardId: null, startedAt: ctx.now };
    state = act(state, hostId, { type: "draw" }, ctx);
    state = act(state, hostId, { type: "swap", cardId: drawn }, ctx);
    expect(state.botHints?.[drawn]).toBeUndefined();
  });
});
