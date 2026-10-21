/**
 * Which decision rules a bot plays by. A seat with no strategy override, as
 * at every live table, uses the live policies below; the evaluation can set
 * either one per seat. The call policy is one constant for every level; the
 * action policy and its mix are set per level, so a level can be switched or
 * reverted on its own.
 *
 * The learned models are per level: each was trained only on that level's
 * own decisions, with features built from that level's own observation.
 */
import type { DecisionKind } from "./bot-features";
import type { Model } from "./bot-models";
import type { ActionPolicy, BotDifficulty, BotStrategy, CallPolicy } from "./types";
import callEasy from "./models/call-easy.json" with { type: "json" };
import callMedium from "./models/call-medium.json" with { type: "json" };
import callHard from "./models/call-hard.json" with { type: "json" };
import actionEasy from "./models/action-easy.json" with { type: "json" };
import actionMedium from "./models/action-medium.json" with { type: "json" };
import actionHard from "./models/action-hard.json" with { type: "json" };
import actionMix from "./models/action-mix.json" with { type: "json" };

export const LIVE_CALL_POLICY: CallPolicy = "gate_v1";

/**
 * The live action policy per level, and for a level on model_v1 its action
 * mix: the share of its focused decisions that use the learned action model,
 * with rules_v1 on the rest. A level on rules_v1 ignores its mix.
 */
export const LIVE_ACTION_POLICY: Record<BotDifficulty, ActionPolicy> = { easy: "rules_v1", medium: "rules_v1", hard: "rules_v1" };
export const LIVE_ACTION_MIX: Record<BotDifficulty, number> = { easy: 0, medium: 0, hard: 0 };

export function callPolicyOf(strategy?: BotStrategy): CallPolicy {
  return strategy?.callPolicy ?? LIVE_CALL_POLICY;
}

export function actionPolicyOf(difficulty: BotDifficulty, strategy?: BotStrategy): ActionPolicy {
  return strategy?.actionPolicy ?? LIVE_ACTION_POLICY[difficulty];
}

export const CALL_MODELS: Record<BotDifficulty, Model> = {
  easy: callEasy as Model, medium: callMedium as Model, hard: callHard as Model,
};

/** A level's action model, and the decisions it makes; every other decision keeps rules_v1. */
export interface ActionModel { kinds: DecisionKind[]; model: Model }

export const ACTION_MODELS: Record<BotDifficulty, ActionModel> = {
  easy: { kinds: actionEasy.kinds as DecisionKind[], model: actionEasy as Model },
  medium: { kinds: actionMedium.kinds as DecisionKind[], model: actionMedium as Model },
  hard: { kinds: actionHard.kinds as DecisionKind[], model: actionHard as Model },
};

/**
 * Call boldness: model_v1 calls when the model's chance of winning by
 * calling now is at least this. Tuned on validation seeds only; see
 * ml/README.md.
 */
export const CALL_THRESHOLDS: Record<BotDifficulty, number> = { easy: 0.6, medium: 0.45, hard: 0.55 };

/**
 * Action sharpness: model_v1 picks at random among this many of its best
 * moves, so a level can be made less sharp on purpose. Tuned on validation
 * seeds only; 1 always plays the model's top move.
 */
export const ACTION_TOP_K: Record<BotDifficulty, number> = { easy: 1, medium: 1, hard: 1 };

/**
 * Also action sharpness: the share of a level's focused decisions that use
 * the model, with rules_v1 on the rest, for a seat that names model_v1 in
 * its strategy. These are the settings tested in H5 to H9; a live seat uses
 * LIVE_ACTION_MIX instead. Tuned on validation seeds only.
 */
export const ACTION_MODEL_SHARE: Record<BotDifficulty, number> = { easy: 1, medium: 0.5, hard: 1 };

export function callThresholdOf(difficulty: BotDifficulty, strategy?: BotStrategy): number {
  return strategy?.callThreshold ?? CALL_THRESHOLDS[difficulty];
}

export function actionTopKOf(difficulty: BotDifficulty, strategy?: BotStrategy): number {
  return strategy?.actionTopK ?? ACTION_TOP_K[difficulty];
}

export function actionModelShareOf(difficulty: BotDifficulty, strategy?: BotStrategy): number {
  if (strategy?.actionModelShare !== undefined) return strategy.actionModelShare;
  return strategy?.actionPolicy === "model_v1" ? ACTION_MODEL_SHARE[difficulty] : LIVE_ACTION_MIX[difficulty];
}

/**
 * The action mix per level chosen by npm run ml:tune-mix on validation seeds
 * (H10 to H15 in docs/experiments/bot-evaluation.md). It only selects
 * configuration A* in tests and the evaluation; live tables read the
 * constants above.
 */
export const TUNED_ACTION_MIX: Record<BotDifficulty, number> = actionMix.mix;

/** Both frozen policies, named explicitly. */
export const FROZEN_POLICIES: BotStrategy = { callPolicy: "gate_v1", actionPolicy: "rules_v1" };

/**
 * C0: the frozen bots. A*: learned actions on a level's mix of its focused
 * decisions, rules_v1 on the rest, and rules_v1 alone at a mix of 0. Learned
 * calls are off in both.
 */
export type PolicyConfig = "C0" | "A*";

export function configStrategy(config: PolicyConfig, difficulty: BotDifficulty, mix: Record<BotDifficulty, number> = TUNED_ACTION_MIX): BotStrategy {
  const share = config === "A*" ? mix[difficulty] : 0;
  return share > 0 ? { callPolicy: "gate_v1", actionPolicy: "model_v1", actionModelShare: share } : { ...FROZEN_POLICIES };
}
