/**
 * Which decision rules a bot plays by. A seat with no strategy override, as
 * at every live table, uses the live policies below; the evaluation can set
 * either one per seat. Each live choice is a single constant, so switching
 * or reverting it is a one line change.
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

export const LIVE_CALL_POLICY: CallPolicy = "gate_v1";
export const LIVE_ACTION_POLICY: ActionPolicy = "rules_v1";

export function callPolicyOf(strategy?: BotStrategy): CallPolicy {
  return strategy?.callPolicy ?? LIVE_CALL_POLICY;
}

export function actionPolicyOf(strategy?: BotStrategy): ActionPolicy {
  return strategy?.actionPolicy ?? LIVE_ACTION_POLICY;
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
 * the model, with rules_v1 on the rest. Tuned on validation seeds only.
 */
export const ACTION_MODEL_SHARE: Record<BotDifficulty, number> = { easy: 1, medium: 0.5, hard: 1 };

export function callThresholdOf(difficulty: BotDifficulty, strategy?: BotStrategy): number {
  return strategy?.callThreshold ?? CALL_THRESHOLDS[difficulty];
}

export function actionTopKOf(difficulty: BotDifficulty, strategy?: BotStrategy): number {
  return strategy?.actionTopK ?? ACTION_TOP_K[difficulty];
}

export function actionModelShareOf(difficulty: BotDifficulty, strategy?: BotStrategy): number {
  return strategy?.actionModelShare ?? ACTION_MODEL_SHARE[difficulty];
}
