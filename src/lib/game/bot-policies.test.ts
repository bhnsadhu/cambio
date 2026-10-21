import { describe, expect, it } from "vitest";
import { playRound, type SeatSpec } from "./bot-harness";
import { actionModelShareOf, actionPolicyOf, callPolicyOf, configStrategy, FROZEN_POLICIES, LIVE_ACTION_MIX, LIVE_ACTION_POLICY, LIVE_CALL_POLICY, TUNED_ACTION_MIX } from "./bot-policies";
import { BOT_DIFFICULTIES, type BotDifficulty, type BotStrategy } from "./types";

const LEVELS: BotDifficulty[] = ["hard", "medium", "hard", "easy"];
const FROZEN: BotStrategy = { callPolicy: "gate_v1", actionPolicy: "rules_v1" };

/** What a live seat of this level plays, spelled out as a strategy object. */
const liveStrategy = (level: BotDifficulty): BotStrategy => ({ callPolicy: LIVE_CALL_POLICY, actionPolicy: LIVE_ACTION_POLICY[level], actionModelShare: LIVE_ACTION_MIX[level] });

describe("frozen bot policies", () => {
  it("live tables play the frozen policies", () => {
    expect(LIVE_CALL_POLICY).toBe("gate_v1");
    expect(LIVE_ACTION_POLICY).toEqual({ easy: "rules_v1", medium: "rules_v1", hard: "rules_v1" });
    expect(callPolicyOf(undefined)).toBe(LIVE_CALL_POLICY);
    for (const level of BOT_DIFFICULTIES) {
      expect(actionPolicyOf(level, {})).toBe(LIVE_ACTION_POLICY[level]);
      expect(actionModelShareOf(level, {})).toBe(LIVE_ACTION_MIX[level]);
    }
  });

  it("naming the frozen policies plays exactly the rounds the frozen bots play", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const named = playRound(seed, LEVELS.map((difficulty): SeatSpec => ({ difficulty, strategy: { ...FROZEN } })));
      const c0 = playRound(seed, LEVELS.map((difficulty): SeatSpec => ({ difficulty, strategy: configStrategy("C0", difficulty) })));
      expect(c0.steps, `seed ${seed}`).toBe(named.steps);
      expect(c0.calls, `seed ${seed}`).toEqual(named.calls);
      expect(c0.state.log, `seed ${seed}`).toEqual(named.state.log);
    }
  });

  it("a live seat plays exactly the rounds its live constants name", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const plain = playRound(seed, LEVELS);
      const named = playRound(seed, LEVELS.map((difficulty): SeatSpec => ({ difficulty, strategy: liveStrategy(difficulty) })));
      expect(named.steps, `seed ${seed}`).toBe(plain.steps);
      expect(named.calls, `seed ${seed}`).toEqual(plain.calls);
      expect(named.state.results, `seed ${seed}`).toEqual(plain.state.results);
      expect(named.state.log, `seed ${seed}`).toEqual(plain.state.log);
    }
  });
});

describe("the C0 and A* configurations", () => {
  it("C0 is both frozen policies for every level, whatever the mix", () => {
    for (const level of BOT_DIFFICULTIES) expect(configStrategy("C0", level, { easy: 1, medium: 1, hard: 1 })).toEqual(FROZEN_POLICIES);
  });

  it("A* keeps learned calls off and stays frozen at a mix of 0", () => {
    for (const level of BOT_DIFFICULTIES) {
      expect(configStrategy("A*", level, { easy: 0, medium: 0, hard: 0 })).toEqual(FROZEN_POLICIES);
      expect(configStrategy("A*", level, { easy: 0.25, medium: 0.25, hard: 0.25 })).toEqual({ callPolicy: "gate_v1", actionPolicy: "model_v1", actionModelShare: 0.25 });
      expect(configStrategy("A*", level).callPolicy).toBe("gate_v1");
    }
  });

  it("reads the tuned mix from the config file, one value per level from the pre-registered grid", () => {
    for (const level of BOT_DIFFICULTIES) expect([0, 0.25, 0.5, 0.75, 1]).toContain(TUNED_ACTION_MIX[level]);
  });

  it("mixes the same way every time for a seed", () => {
    const mixed = LEVELS.map((difficulty): SeatSpec => ({ difficulty, strategy: configStrategy("A*", difficulty, { easy: 0.5, medium: 0.5, hard: 0.5 }) }));
    for (const seed of [3, 4]) expect(playRound(seed, mixed).state.log).toEqual(playRound(seed, mixed).state.log);
  });
});
