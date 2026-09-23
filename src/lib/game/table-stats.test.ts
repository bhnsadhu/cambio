import { describe, expect, it } from "vitest";
import { tableStats } from "./table-stats";
import type { RoundResult } from "./types";

describe("current table statistics", () => {
  it("has no record before this seat completes a round", () => {
    const result: RoundResult = { round: 1, scores: [{ playerId: "other", score: 3, cards: [] }], winnerIds: ["other"], nextLeadSeat: 0 };
    expect(tableStats([], "guest")).toEqual(tableStats([result], "guest"));
    expect(tableStats([result], "guest")).toEqual({ roundsPlayed: 0, roundsWon: 0, bestScore: null, sticksHit: 0, cambioCalls: 0, cambioWins: 0 });
  });

  it("counts only scored rounds for this seat, including ties, negative hands and older results", () => {
    const results: RoundResult[] = [
      { round: 1, scores: [{ playerId: "guest", score: 4, cards: [] }, { playerId: "other", score: 4, cards: [] }],
        winnerIds: ["guest", "other"], nextLeadSeat: 0, callerId: "guest", tally: { guest: { sticks: 2, misses: 1 }, other: { sticks: 7, misses: 0 } } },
      { round: 2, scores: [{ playerId: "guest", score: -2, cards: [] }], winnerIds: ["guest"], nextLeadSeat: 0 },
      { round: 3, scores: [{ playerId: "guest", score: 25, cards: [] }], winnerIds: ["other"], nextLeadSeat: 1,
        callerId: "guest", tally: { guest: { sticks: 1, misses: 2 } } },
      { round: 4, scores: [{ playerId: "replacement", score: 0, cards: [] }], winnerIds: ["replacement"], nextLeadSeat: 0,
        callerId: "replacement", tally: { replacement: { sticks: 9, misses: 0 } } },
    ];
    const before = structuredClone(results);
    expect(tableStats(results, "guest")).toEqual({ roundsPlayed: 3, roundsWon: 2, bestScore: -2, sticksHit: 3, cambioCalls: 2, cambioWins: 1 });
    expect(results).toEqual(before);
  });
});
