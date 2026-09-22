import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { GameError } from "@/lib/game/engine";
import type { GameState, RoundResult } from "@/lib/game/types";
import type { Friend, Invite, Opponent, PendingFriend, Profile, Social } from "@/lib/social/types";
import { rpc } from "./db";

/**
 * Profiles, friends, invites and presence.
 *
 * The browser holds a profile token; the server only ever holds its hash, in
 * the same way a seat at a table is held. Every call below goes through a
 * SECURITY DEFINER RPC gated by the server secret, so the anon key can no
 * more read a profile than it can read a hand of cards.
 */

export function newProfileToken(): string {
  return randomBytes(24).toString("base64url");
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The name a friend types to find you. Derived from the display name rather
 * than asked for, and made unique by the database if it is taken.
 */
export function handleFrom(displayName: string): string {
  const base = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16);
  return base.length >= 3 ? base : `${base}player`.slice(0, 16);
}

export function cleanDisplayName(raw: string): string {
  const name = (raw ?? "").trim().replace(/\s+/g, " ").slice(0, 18);
  if (name.length < 1) throw new GameError("BAD_NAME", "Enter a name for your profile.");
  return name;
}

export function normaliseHandle(raw: string): string {
  return (raw ?? "").trim().toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]/g, "").slice(0, 18);
}

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

interface RawProfile {
  id: string; handle: string; display_name: string;
  created_at: string; last_seen_at: string; last_played_at: string | null;
  rounds_played: number; rounds_won: number; tables_played: number;
  score_total: number; best_score: number | null;
  cambio_calls: number; cambio_wins: number;
  sticks_hit: number; sticks_missed: number;
  current_streak: number; best_streak: number;
  points: number; rank: number; total_players: number;
}

function toProfile(r: RawProfile): Profile {
  return {
    id: r.id,
    handle: r.handle,
    displayName: r.display_name,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    lastPlayedAt: r.last_played_at,
    roundsPlayed: r.rounds_played,
    roundsWon: r.rounds_won,
    tablesPlayed: r.tables_played,
    scoreTotal: r.score_total,
    bestScore: r.best_score,
    cambioCalls: r.cambio_calls,
    cambioWins: r.cambio_wins,
    sticksHit: r.sticks_hit,
    sticksMissed: r.sticks_missed,
    currentStreak: r.current_streak,
    bestStreak: r.best_streak,
    points: r.points,
    rank: r.rank,
    totalPlayers: r.total_players,
  };
}

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

export async function createProfile(rawName: string): Promise<{ profile: Profile; token: string }> {
  const displayName = cleanDisplayName(rawName);
  const token = newProfileToken();
  const row = await rpc<RawProfile>("profile_create", {
    p_handle: handleFrom(displayName),
    p_display_name: displayName,
    p_token_hash: hash(token),
  });
  return { profile: toProfile(row), token };
}

export async function profileByToken(token: string | null): Promise<Profile | null> {
  if (!token) return null;
  const row = await rpc<RawProfile | null>("profile_by_token", { p_token_hash: hash(token) });
  return row ? toProfile(row) : null;
}

export async function profileByHandle(handle: string): Promise<Profile | null> {
  const clean = normaliseHandle(handle);
  if (!clean) return null;
  const row = await rpc<RawProfile | null>("profile_by_handle", { p_handle: clean });
  return row ? toProfile(row) : null;
}

export async function renameProfile(id: string, rawName: string): Promise<Profile> {
  const row = await rpc<RawProfile>("profile_rename", { p_id: id, p_display_name: cleanDisplayName(rawName) });
  return toProfile(row);
}

/** The id behind a profile token, for stamping onto a seat. */
export async function profileIdForToken(token: string | null): Promise<string | null> {
  const profile = await profileByToken(token);
  return profile ? profile.id : null;
}

/* ------------------------------------------------------------------ */
/* Friends and invites                                                 */
/* ------------------------------------------------------------------ */

export type FriendRequestOutcome = "sent" | "pending" | "accepted" | "friends" | "self";

export async function requestFriend(from: string, to: string): Promise<FriendRequestOutcome> {
  return rpc<FriendRequestOutcome>("friend_request", { p_from: from, p_to: to });
}

export async function respondToFriend(me: string, other: string, accept: boolean): Promise<string> {
  return rpc<string>("friend_respond", { p_me: me, p_other: other, p_accept: accept });
}

export async function removeFriend(me: string, other: string): Promise<void> {
  await rpc<null>("friend_remove", { p_me: me, p_other: other });
}

export async function createInvite(from: string, to: string, code: string): Promise<string> {
  return rpc<string>("invite_create", { p_from: from, p_to: to, p_code: code });
}

/** Returns the table code when an invite was accepted, null otherwise. */
export async function respondToInvite(me: string, inviteId: string, accept: boolean): Promise<string | null> {
  return rpc<string | null>("invite_respond", { p_me: me, p_id: inviteId, p_accept: accept });
}

export async function setPresence(id: string, code: string | null, phase: string | null, openSeats: number): Promise<void> {
  await rpc<null>("presence_set", { p_id: id, p_code: code, p_phase: phase, p_open_seats: openSeats });
}

/* ------------------------------------------------------------------ */
/* One read for a whole client                                         */
/* ------------------------------------------------------------------ */

interface RawSocial {
  friends: {
    id: string; handle: string; display_name: string; points: number;
    rounds_won: number; rounds_played: number; since: string | null;
    playing: { code: string; phase: string; open_seats: number } | null;
    played_together: number; your_wins: number; their_wins: number;
  }[];
  incoming: { id: string; handle: string; display_name: string; at: string }[];
  outgoing: { id: string; handle: string; display_name: string; at: string }[];
  invites: { id: string; code: string; at: string; from: { id: string; handle: string; display_name: string } }[];
  opponents: { id: string; handle: string; display_name: string; rounds: number; wins: number; last_played_at: string }[];
}

export async function socialFor(id: string): Promise<Social> {
  const raw = await rpc<RawSocial>("social_snapshot", { p_id: id });
  const pending = (r: { id: string; handle: string; display_name: string; at: string }): PendingFriend =>
    ({ id: r.id, handle: r.handle, displayName: r.display_name, at: r.at });
  const friends: Friend[] = (raw.friends ?? []).map((f) => ({
    id: f.id,
    handle: f.handle,
    displayName: f.display_name,
    points: f.points,
    roundsWon: f.rounds_won,
    roundsPlayed: f.rounds_played,
    since: f.since,
    playing: f.playing ? { code: f.playing.code, phase: f.playing.phase, openSeats: f.playing.open_seats } : null,
    playedTogether: f.played_together,
    yourWins: f.your_wins,
    theirWins: f.their_wins,
  }));
  const invites: Invite[] = (raw.invites ?? []).map((i) => ({
    id: i.id,
    code: i.code,
    at: i.at,
    from: { id: i.from.id, handle: i.from.handle, displayName: i.from.display_name },
  }));
  const opponents: Opponent[] = (raw.opponents ?? []).map((o) => ({
    id: o.id,
    handle: o.handle,
    displayName: o.display_name,
    rounds: o.rounds,
    wins: o.wins,
    lastPlayedAt: o.last_played_at,
  }));
  return {
    friends,
    incoming: (raw.incoming ?? []).map(pending),
    outgoing: (raw.outgoing ?? []).map(pending),
    invites,
    opponents,
  };
}

/* ------------------------------------------------------------------ */
/* Writing a round into the record books                               */
/* ------------------------------------------------------------------ */

/**
 * Called once per scored round, by whichever server invocation committed the
 * scoring. Seats without a saved profile are simply skipped, so a table of
 * strangers records nothing and costs nothing.
 */
export async function recordRound(state: GameState, result: RoundResult): Promise<void> {
  const seated = state.players.filter((p) => !p.isBot && p.profileId);
  if (seated.length === 0) return;
  const profileIds = seated.map((p) => p.profileId!);
  const rows = seated.map((p) => {
    const score = result.scores.find((s) => s.playerId === p.id);
    const tally = result.tally?.[p.id];
    return {
      profile_id: p.profileId,
      won: result.winnerIds.includes(p.id),
      score: score ? score.score : 0,
      sticks: tally ? tally.sticks : 0,
      misses: tally ? tally.misses : 0,
      called: result.callerId === p.id,
      first_round: result.round === 1,
      opponents: profileIds.filter((id) => id !== p.profileId),
    };
  });
  await rpc<null>("profile_record_round", { p_rows: rows });
}
