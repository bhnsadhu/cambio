import type { RoundResult } from "./types";

/** A seat's completed rounds at one table, including shared wins. */
export function tableStats(results: readonly RoundResult[], playerId: string) {
  const stats = { roundsPlayed: 0, roundsWon: 0, bestScore: null as number | null, sticksHit: 0, cambioCalls: 0, cambioWins: 0 };
  for (const result of results) {
    const score = result.scores.find((entry) => entry.playerId === playerId);
    if (!score) continue;
    const won = result.winnerIds.includes(playerId);
    stats.roundsPlayed++;
    stats.roundsWon += Number(won);
    stats.bestScore = stats.bestScore === null ? score.score : Math.min(stats.bestScore, score.score);
    stats.sticksHit += result.tally?.[playerId]?.sticks ?? 0;
    if (result.callerId === playerId) {
      stats.cambioCalls++;
      stats.cambioWins += Number(won);
    }
  }
  return stats;
}
