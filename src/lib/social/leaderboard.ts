export type LeaderboardScope = "all" | "friends";

export interface LeaderboardEntry {
  id: string;
  handle: string;
  displayName: string;
  points: number;
  roundsWon: number;
  roundsPlayed: number;
  rank: number;
}

export interface LeaderboardSnapshot {
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
  total: number;
  offset: number;
  nextOffset: number | null;
}
