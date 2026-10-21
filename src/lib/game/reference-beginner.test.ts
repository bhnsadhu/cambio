import { describe, expect, it } from "vitest";
import { playRound, type SeatSpec } from "./bot-harness";
import { configStrategy } from "./bot-policies";
import { BEGINNER_CALL_TOTAL } from "./reference-beginner";
import type { BotDifficulty, GameState } from "./types";

const seats = (level: BotDifficulty): SeatSpec[] => [
  { difficulty: level, strategy: configStrategy("C0", level) }, { difficulty: "easy", beginner: true },
  { difficulty: level, strategy: configStrategy("C0", level) }, { difficulty: "easy", beginner: true },
];

describe("the beginner reference player", () => {
  it("is fixed at the pre-registered call total", () => {
    expect(BEGINNER_CALL_TOTAL).toBe(2);
  });

  it.each([["easy"], ["medium"], ["hard"]] as const)("finishes legal rounds against %s, never sticking or using a power", (level) => {
    let calls = 0, swaps = 0;
    for (let seed = 1; seed <= 6; seed++) {
      let last: GameState | null = null;
      const round = playRound(seed, seats(level), (state) => { last = state; });
      const beginners = round.state.players.filter((p) => p.seat % 2 === 1).map((p) => p.id);
      expect(round.state.players.filter((p) => beginners.includes(p.id)).every((p) => !p.isBot)).toBe(true);
      const own = last!.log.filter((entry) => entry.actorId && beginners.includes(entry.actorId));
      expect(own.filter((entry) => ["stick", "stickMiss", "peekOwn", "peekOther", "blindSwap", "kingLook", "kingSwap", "kingLeave", "give"].includes(entry.kind))).toEqual([]);
      calls += own.filter((entry) => entry.kind === "cambio").length;
      swaps += own.filter((entry) => entry.kind === "swap").length;
      // Bot calls are recorded with their belief; the beginner's are not bot calls.
      expect(round.calls.every((call) => !beginners.includes(call.playerId))).toBe(true);
    }
    expect(swaps).toBeGreaterThan(0);
    expect(calls).toBeGreaterThanOrEqual(0);
  }, 60_000);
});
