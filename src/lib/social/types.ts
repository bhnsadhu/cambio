/** Public profiles and social records. Credentials live separately on the server. */

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
  avatarId?: number | null;
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
  tableId: string;
  together: boolean;
  doNotDisturb: boolean;
  phase: string;
  openSeats: number;
}

export interface Friend {
  id: string;
  handle: string;
  displayName: string;
  avatarId?: number | null;
  points: number;
  roundsWon: number;
  roundsPlayed: number;
  since: string | null;
  /** their client has checked in recently: the app is open somewhere */
  online: boolean;
  /** when they were last seen, for a friend who is not online now */
  lastSeenAt: string | null;
  /** online *and* sitting at a table; null when they are just about */
  playing: LiveGame | null;
  /** rounds the two of you have played at the same table */
  playedTogether: number;
  /** of those, the ones you won and the ones they won */
  yourWins: number;
  theirWins: number;
}

export interface PendingFriend {
  id: string;
  handle: string;
  displayName: string;
  avatarId?: number | null;
  at: string;
}

export interface Invite {
  id: string;
  code: string;
  tableId: string;
  at: string;
  from: { id: string; handle: string; displayName: string; avatarId?: number | null };
  requested: boolean;
}

export interface TableJoinRequest {
  id: string;
  tableId: string;
  at: string;
  from: { id: string; handle: string; displayName: string; avatarId?: number | null };
}

export interface SentJoinRequest {
  id: string;
  at: string;
  tableId: string;
  toId: string;
  status: "pending" | "declined";
}

export type JoinRequestOutcome = { ok: true } | { ok: false; message: string };

export interface Opponent {
  id: string;
  handle: string;
  displayName: string;
  avatarId?: number | null;
  rounds: number;
  wins: number;
  lastPlayedAt: string;
}

/** The latest invitation sent to a friend at a table, including answered ones. */
export interface SentInvite {
  id: string;
  code: string;
  at: string;
  toId: string;
}

/** Everything one client needs about its own corner of the game, in one read. */
export interface Social {
  friends: Friend[];
  incoming: PendingFriend[];
  outgoing: PendingFriend[];
  /** invites waiting on an answer from you */
  invites: Invite[];
  /** invites you have sent and are waiting on */
  sent: SentInvite[];
  joinRequests: TableJoinRequest[];
  sentJoinRequests: SentJoinRequest[];
  opponents: Opponent[];
}

/** How an attempt to invite someone to a table turned out. */
export type InviteOutcome =
  | { ok: true }
  | { ok: false; reason: "not-friends" | "table-gone" | "table-started" | "table-full" | "not-seated" | "busy" | "here" | "cooldown"; message: string };

/** How answering an invite turned out. */
export type InviteAnswer =
  | { ok: true; code: string; seat: { playerId: string; token: string; name: string } | null }
  | { ok: false; reason: "gone" | "started" | "full" | "busy" | "expired"; message: string };
