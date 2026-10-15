/**
 * Which decision rules a bot plays by. A seat with no strategy override, as
 * at every live table, uses the live policies below; the evaluation can set
 * either one per seat. Each live choice is a single constant, so switching
 * or reverting it is a one line change.
 */
import type { ActionPolicy, BotStrategy, CallPolicy } from "./types";

export const LIVE_CALL_POLICY: CallPolicy = "gate_v1";
export const LIVE_ACTION_POLICY: ActionPolicy = "rules_v1";

export function callPolicyOf(strategy?: BotStrategy): CallPolicy {
  return strategy?.callPolicy ?? LIVE_CALL_POLICY;
}

export function actionPolicyOf(strategy?: BotStrategy): ActionPolicy {
  return strategy?.actionPolicy ?? LIVE_ACTION_POLICY;
}
