/**
 * Saved profiles, friends and everything a client shows about them.
 *
 * A profile is identity without an account: the browser keeps a secret token,
 * the server keeps its hash. Nothing here is secret — a profile's record is
 * meant to be shown to the table — so these types travel freely to clients.
 */

export interface ProfileStats {
  roundsPlayed: number;
  roundsWon: number;
  tablesPlayed: number;
  scoreTotal: number;
  /** the lowest hand ever scored; null until a first round is played */
  bestScore: number | null;
  cambioCalls: number;
  cambioWins: number;
  sticksHit: number;
  sticksMissed: number;
  currentStreak: number;
  bestStreak: number;
}

export interface Profile extends ProfileStats {
  id: string;
  handle: string;
  displayName: string;
  createdAt: string;
  lastSeenAt: string;
  lastPlayedAt: string | null;
  /** what the ladder is ordered by */
  points: number;
  /** standing among every saved profile, 1 is first */
  rank: number;
  totalPlayers: number;
}

/** Where a friend is playing right now. */
export interface LiveGame {
  code: string;
  phase: string;
  openSeats: number;
}

export interface Friend {
  id: string;
  handle: string;
  displayName: string;
  points: number;
  roundsWon: number;
  roundsPlayed: number;
  since: string | null;
  /** null unless their client has checked in within the last two minutes */
  playing: LiveGame | null;
  /** rounds the two of you have played at the same table */
  playedTogether: number;
  /** of those, the ones they took off you */
  lostToThem: number;
}

export interface PendingFriend {
  id: string;
  handle: string;
  displayName: string;
  at: string;
}

export interface Invite {
  id: string;
  code: string;
  at: string;
  from: { id: string; handle: string; displayName: string };
}

export interface Opponent {
  id: string;
  handle: string;
  displayName: string;
  rounds: number;
  wins: number;
  lastPlayedAt: string;
}

/** Everything one client needs about its own corner of the game, in one read. */
export interface Social {
  friends: Friend[];
  incoming: PendingFriend[];
  outgoing: PendingFriend[];
  invites: Invite[];
  opponents: Opponent[];
}
