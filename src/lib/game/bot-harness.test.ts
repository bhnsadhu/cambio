import { describe, expect, it } from "vitest";
import { jitterFor, playOut, playRound, type SeatSpec } from "./bot-harness";
import { FROZEN_POLICIES } from "./bot-policies";
import { makeCtx } from "./testkit";
import type { GameState } from "./types";

describe("the seeded harness", () => {
  it("plays the same rounds it always has", () => {
    // Recorded before playOut was split out of playRound, on the frozen policies.
    const recorded: [number, number, number, string][] = [[1, 52, 1, "6 16 20 0"], [2, 62, 1, "0 23 8 4"], [3, 71, 1, "3 8 18 0"], [4, 42, 1, "8 16 14 3"]];
    for (const [seed, steps, calls, scores] of recorded) {
      const round = playRound(seed, (["hard", "medium", "easy", "hard"] as const).map((difficulty): SeatSpec => ({ difficulty, strategy: { ...FROZEN_POLICIES } })));
      expect([seed, round.steps, round.calls.length, round.state.results[0].scores.map((s) => s.score).join(" ")]).toEqual([seed, steps, calls, scores]);
    }
  });

  it("plays a copied mid round state to the end with legal moves and every card accounted for", () => {
    const snapshots: GameState[] = [];
    const original = playRound(5, ["easy", "hard", "medium", "hard"], (state) => { snapshots.push(structuredClone(state)); });
    const middle = snapshots[Math.floor(snapshots.length / 2)];
    const before = structuredClone(middle);
    for (const seed of [1, 2]) {
      const copy = structuredClone(middle);
      const ctx = makeCtx(seed, copy.updatedAt);
      ctx.newId = (() => { let n = 0; return () => `copy${seed}-${++n}`; })();
      const played = playOut(copy, ctx, { jitter: jitterFor(seed), label: `copy ${seed}`, actionId: (step) => `copy-${seed}-${step}` });
      expect(played.state.phase).toBe("scoring");
      expect(played.state.results).toHaveLength(1);
    }
    expect(middle).toEqual(before);
    expect(original.state.phase).toBe("scoring");
  });
});
