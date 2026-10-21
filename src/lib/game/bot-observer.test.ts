import { describe, expect, it } from "vitest";
import { playRound, type SeatSpec } from "./bot-harness";
import { configStrategy } from "./bot-policies";
import type { BotObserver } from "./bots";
import type { BotDifficulty } from "./types";

const LINEUPS: BotDifficulty[][] = [["hard", "medium", "easy", "hard"], ["easy", "easy", "medium", "hard"]];

/** An observer that records every event it is told about. */
function recorder() {
  const events: Record<string, number> = {};
  const count = (name: string) => () => { events[name] = (events[name] ?? 0) + 1; };
  const observer: BotObserver = {
    effort: count("effort"), memory: count("memory"), stick: count("stick"), power: count("power"),
    lapseKeep: count("lapseKeep"), plan: count("plan"), modelDecision: count("modelDecision"),
  };
  return { events, observer };
}

describe("observe only instrumentation", () => {
  it.each([["C0"], ["A*"]] as const)("instrumented bots make identical decisions in %s", (config) => {
    const mix = { easy: 0.5, medium: 0.5, hard: 0.5 };
    const totals: Record<string, number> = {};
    for (const lineup of LINEUPS) for (let seed = 1; seed <= 3; seed++) {
      const specs = lineup.map((difficulty): SeatSpec => ({ difficulty, strategy: configStrategy(config, difficulty, mix) }));
      const plain = playRound(seed, specs);
      const { events, observer } = recorder();
      const watched = playRound(seed, specs, undefined, { observer });
      expect(watched.steps, `seed ${seed}`).toBe(plain.steps);
      expect(watched.calls, `seed ${seed}`).toEqual(plain.calls);
      expect(watched.state.log, `seed ${seed}`).toEqual(plain.state.log);
      expect(watched.state.results, `seed ${seed}`).toEqual(plain.state.results);
      expect(watched.state.botKnown, `seed ${seed}`).toEqual(plain.state.botKnown);
      for (const [name, n] of Object.entries(events)) totals[name] = (totals[name] ?? 0) + n;
    }
    for (const name of ["effort", "memory", "stick", "power", "lapseKeep", "plan"]) expect(totals[name], name).toBeGreaterThan(0);
    if (config === "A*") expect(totals.modelDecision).toBeGreaterThan(0);
    else expect(totals.modelDecision).toBeUndefined();
  }, 60_000);
});
