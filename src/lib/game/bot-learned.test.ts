import { describe, expect, it } from "vitest";
import { assessCambio, planBots } from "./bots";
import { ACTION_FEATURES, CALL_FEATURES } from "./bot-features";
import { jitterFor, playRound, type SeatSpec } from "./bot-harness";
import { predict, type Model } from "./bot-models";
import { observeBot } from "./bot-observation";
import { ACTION_MODELS, CALL_MODELS } from "./bot-policies";
import { forbidSecrets, permuteUnseen } from "./testkit";
import type { BotDifficulty, BotStrategy, GameState } from "./types";
import callFixtures from "./models/fixtures-call.json" with { type: "json" };
import actionFixtures from "./models/fixtures-action.json" with { type: "json" };

const LEVELS: BotDifficulty[] = ["easy", "medium", "hard"];
const CONFIGS: Record<string, BotStrategy> = {
  C: { callPolicy: "model_v1", actionPolicy: "rules_v1" },
  A: { callPolicy: "gate_v1", actionPolicy: "model_v1" },
  CA: { callPolicy: "model_v1", actionPolicy: "model_v1" },
};
const lineup = (strategy: BotStrategy): SeatSpec[] => (["hard", "medium", "easy", "medium"] as BotDifficulty[]).map((difficulty) => ({ difficulty, strategy: { ...strategy } }));

describe("the exported models", () => {
  it("every level's models take the same features, built only from that level's observation", () => {
    for (const level of LEVELS) {
      expect(CALL_MODELS[level].features).toEqual(CALL_FEATURES);
      expect(ACTION_MODELS[level].model.features).toEqual(ACTION_FEATURES);
    }
  });

  it("the TypeScript forward pass matches the Python predictions on a fixed sample", () => {
    const check = (model: Model, fixture: { features: number[][]; predictions: number[] }) => {
      expect(fixture.features.length).toBeGreaterThan(0);
      fixture.features.forEach((x, index) => expect(Math.abs(predict(model, x) - fixture.predictions[index])).toBeLessThan(1e-9));
    };
    for (const level of LEVELS) {
      check(CALL_MODELS[level], (callFixtures as Record<string, { features: number[][]; predictions: number[] }>)[level]);
      check(ACTION_MODELS[level].model, (actionFixtures as Record<string, { features: number[][]; predictions: number[] }>)[level]);
    }
  });
});

describe.each(Object.entries(CONFIGS))("learned configuration %s", (_, strategy) => {
  it("finishes every round with only legal moves and all 54 cards accounted for", () => {
    // playRound throws on an illegal move, a lost or duplicated card, or an unfinished round.
    for (let seed = 1; seed <= 6; seed++) expect(playRound(seed, lineup(strategy)).state.phase).toBe("scoring");
  });

  it("keeps each level's memory limit", () => {
    for (let seed = 1; seed <= 3; seed++) {
      playRound(seed, lineup(strategy), (state) => {
        for (const p of state.players) {
          const known = state.botKnown[p.id] ?? [];
          if (p.difficulty === "easy") expect(known.length).toBeLessThanOrEqual(2);
          if (p.difficulty === "medium") expect(known.filter((id) => !p.hand.includes(id) && state.turn?.drawnCardId !== id).length).toBeLessThanOrEqual(6);
        }
      });
    }
  });

  it("never reads a secret, and plays the same in every hidden world that looks the same to the seat", () => {
    const states: GameState[] = [];
    for (const seed of [1, 2]) playRound(seed, lineup(strategy), (state) => { if (state.phase === "playing" || state.phase === "final") states.push(structuredClone(state)); });
    const jitter = jitterFor(23);
    for (const [index, state] of states.entries()) {
      if (index % 2) continue;
      for (const seat of state.players) {
        const me = seat.id;
        // Only this seat plans, so other seats' private memories stay out of reach, as in bot-strength.test.ts.
        const own = structuredClone(state);
        for (const other of own.players) if (other.id !== me) other.isBot = false;
        const expected = planBots(own, own.updatedAt, jitter).filter((plan) => plan.playerId === me);
        const belief = assessCambio(own, me);
        expect(planBots(forbidSecrets(own, me), own.updatedAt, jitter).filter((plan) => plan.playerId === me)).toEqual(expected);
        expect(assessCambio(forbidSecrets(own, me), me)).toEqual(belief);
        const hidden = permuteUnseen(own, me, 400 + index);
        expect(observeBot(hidden, me)).toEqual(observeBot(own, me));
        expect(planBots(hidden, own.updatedAt, jitter).filter((plan) => plan.playerId === me)).toEqual(expected);
        expect(assessCambio(hidden, me)).toEqual(belief);
      }
    }
  }, 60_000);
});
