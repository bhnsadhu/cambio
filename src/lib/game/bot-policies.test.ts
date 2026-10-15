import { describe, expect, it } from "vitest";
import { playRound, type SeatSpec } from "./bot-harness";
import { callPolicyOf, actionPolicyOf, LIVE_ACTION_POLICY, LIVE_CALL_POLICY } from "./bot-policies";
import type { BotDifficulty, BotStrategy } from "./types";

const LEVELS: BotDifficulty[] = ["hard", "medium", "hard", "easy"];
const FROZEN: BotStrategy = { callPolicy: "gate_v1", actionPolicy: "rules_v1" };

describe("frozen bot policies", () => {
  it("live tables play the frozen policies", () => {
    expect(LIVE_CALL_POLICY).toBe("gate_v1");
    expect(LIVE_ACTION_POLICY).toBe("rules_v1");
    expect(callPolicyOf(undefined)).toBe(LIVE_CALL_POLICY);
    expect(actionPolicyOf({})).toBe(LIVE_ACTION_POLICY);
  });

  it("naming the frozen policies plays exactly the rounds the shipped bots play", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const plain = playRound(seed, LEVELS);
      const named = playRound(seed, LEVELS.map((difficulty): SeatSpec => ({ difficulty, strategy: { ...FROZEN } })));
      expect(named.steps, `seed ${seed}`).toBe(plain.steps);
      expect(named.calls, `seed ${seed}`).toEqual(plain.calls);
      expect(named.state.results, `seed ${seed}`).toEqual(plain.state.results);
      expect(named.state.log, `seed ${seed}`).toEqual(plain.state.log);
    }
  });
});
