/**
 * Standing.
 *
 * Points come from the database (a stored column, so the ladder can be
 * ordered in SQL): a round won is worth four times a round played, and
 * calling Cambio and making it stick is worth more again. The tiers below
 * turn that number into something a player recognises at a glance.
 */

import type { Profile, ProfileStats } from "./types";

export interface Tier {
  name: string;
  /** points needed to reach it */
  at: number;
}

export const TIERS: Tier[] = [
  { name: "Rookie", at: 0 },
  { name: "Bronze", at: 60 },
  { name: "Silver", at: 180 },
  { name: "Gold", at: 400 },
  { name: "Platinum", at: 800 },
  { name: "Diamond", at: 1500 },
  { name: "Cambio Master", at: 3000 },
];

export interface Standing {
  tier: Tier;
  index: number;
  next: Tier | null;
  /** 0..1 through the current tier; 1 at the top of the ladder */
  progress: number;
  toNext: number;
}

export function standingFor(points: number): Standing {
  let index = 0;
  for (let i = 0; i < TIERS.length; i++) if (points >= TIERS[i].at) index = i;
  const tier = TIERS[index];
  const next = TIERS[index + 1] ?? null;
  if (!next) return { tier, index, next: null, progress: 1, toNext: 0 };
  const span = next.at - tier.at;
  return {
    tier,
    index,
    next,
    progress: Math.max(0, Math.min(1, (points - tier.at) / span)),
    toNext: Math.max(0, next.at - points),
  };
}

export function winRate(stats: ProfileStats): number {
  return stats.roundsPlayed === 0 ? 0 : stats.roundsWon / stats.roundsPlayed;
}

export function averageScore(stats: ProfileStats): number | null {
  return stats.roundsPlayed === 0 ? null : stats.scoreTotal / stats.roundsPlayed;
}

export function stickRate(stats: ProfileStats): number | null {
  const tried = stats.sticksHit + stats.sticksMissed;
  return tried === 0 ? null : stats.sticksHit / tried;
}

/** "3rd of 128" — where this profile sits on the ladder. */
export function standingLine(profile: Profile): string {
  return `${ordinal(profile.rank)} of ${profile.totalPlayers}`;
}

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}
