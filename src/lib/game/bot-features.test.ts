import { describe, expect, it } from "vitest";
import { assessObservedCambio } from "./bot-beliefs";
import { ACTION_FEATURES, actionKey, CALL_FEATURES, callFeatures, decisionCandidates, decisionKind, MAX_CANDIDATES, stickTop } from "./bot-features";
import { playRound, type SeatSpec } from "./bot-harness";
import { FROZEN_POLICIES } from "./bot-policies";
import { observeBot } from "./bot-observation";
import { rulesV1Choice } from "./bots";
import { applyAction, canStick } from "./engine";
import { forbidSecrets, makeCtx, permuteUnseen } from "./testkit";
import type { GameState } from "./types";

/** Every state of a few seeded frozen rounds, with each seat's decision there, if any. */
function decisionStates() {
  const found: { state: GameState; botId: string; kind: ReturnType<typeof decisionKind> | "stick" }[] = [];
  for (const seed of [1, 2, 3]) {
    playRound(seed, (["hard", "medium", "easy", "hard"] as const).map((difficulty): SeatSpec => ({ difficulty, strategy: { ...FROZEN_POLICIES } })), (state) => {
      if (state.phase !== "playing" && state.phase !== "final") return;
      for (const bot of state.players) {
        const observed = observeBot(state, bot.id);
        const kind = decisionKind(observed, bot.id);
        if (kind) found.push({ state: structuredClone(state), botId: bot.id, kind });
        if (canStick(state, bot.id) && stickTop(observed, bot.id)) found.push({ state: structuredClone(state), botId: bot.id, kind: "stick" });
      }
    });
  }
  return found;
}

const points = decisionStates();

describe("model features", () => {
  it("covers every kind of decision in a few seeded rounds", () => {
    expect(new Set(points.map((point) => point.kind))).toEqual(new Set(["decide", "peekOwn", "peekOther", "blindSwap", "kingLook", "kingDecide", "stick", "give"]));
  });

  it("offers only legal candidates, always including the frozen rule's choice", () => {
    for (const { state, botId, kind } of points) {
      const observed = observeBot(state, botId);
      const rule = rulesV1Choice(observed, botId, kind!);
      const decision = decisionCandidates(observed, botId, kind!, rule);
      expect(decision.candidates.length).toBeGreaterThan(0);
      expect(decision.candidates.length).toBeLessThanOrEqual(MAX_CANDIDATES);
      expect(decision.legal).toBeGreaterThanOrEqual(decision.candidates.length);
      expect(decision.candidates.filter((candidate) => candidate.rule).map((candidate) => actionKey(candidate.action))).toEqual([actionKey(rule)]);
      for (const candidate of decision.candidates) {
        expect(candidate.features).toHaveLength(ACTION_FEATURES.length);
        expect(candidate.features.every(Number.isFinite)).toBe(true);
        if (!candidate.action) continue;
        expect(() => applyAction(state, { actionId: "check", playerId: botId, action: candidate.action! }, makeCtx(1, state.updatedAt + 1000))).not.toThrow();
      }
    }
  });

  it("are identical in every hidden world that looks the same to the seat, and never read a secret", () => {
    for (const [index, { state, botId, kind }] of points.entries()) {
      if (index % 3) continue;
      const features = (world: GameState) => {
        const observed = observeBot(world, botId);
        const belief = assessObservedCambio(observed, botId);
        return {
          call: callFeatures(observed, botId, belief),
          action: decisionCandidates(observed, botId, kind!, rulesV1Choice(observed, botId, kind!)),
        };
      };
      const expected = features(state);
      expect(expected.call).toHaveLength(CALL_FEATURES.length);
      expect(features(forbidSecrets(state, botId))).toEqual(expected);
      for (const seed of [301, 302]) expect(features(permuteUnseen(state, botId, seed))).toEqual(expected);
    }
  });
});
