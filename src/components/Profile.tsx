"use client";

import Link from "next/link";
import { type ReactNode } from "react";
import { standingFor, standingLine, stickRate, winRate } from "@/lib/social/rank";
import type { Profile } from "@/lib/social/types";
import { buttonClass, Chip } from "./ui";

/**
 * A player's standing, after the way a phone game shows it: the number that
 * matters is enormous and at the top, the rank sits above it as a name rather
 * than a number, and everything else is a quiet row underneath.
 */
export function ProfileCard({ profile, compact = false }: { profile: Profile; compact?: boolean }) {
  const standing = standingFor(profile.points);
  const rate = winRate(profile);
  return (
    <section className="rounded-panel bg-surface p-6 hairline" aria-label={`${profile.displayName}'s record`}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="t-caption text-accent">{standing.tier.name}</p>
          <h1 className="t-title2 mt-1 truncate">{profile.displayName}</h1>
          <p className="t-footnote mt-0.5 text-ink-3">@{profile.handle}</p>
        </div>
        <Chip tone="neutral">{standingLine(profile)}</Chip>
      </header>

      <div className="mt-6 flex items-end gap-4">
        <span className="t-money block text-[64px] leading-[0.9] tracking-[-0.03em] text-accent">{profile.roundsWon}</span>
        <span className="t-caption pb-2 text-ink-3">{profile.roundsWon === 1 ? "win" : "wins"}</span>
      </div>

      <div className="mt-5">
        <div className="h-[5px] w-full overflow-hidden rounded-full bg-surface-2">
          <span className="block h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round(standing.progress * 100)}%` }} />
        </div>
        <p className="t-footnote mt-2 text-ink-3">
          {standing.next
            ? <>{profile.points} points · {standing.toNext} more to {standing.next.name}</>
            : <>{profile.points} points · top of the ladder</>}
        </p>
      </div>

      {compact ? null : (
        <>
          <dl className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Stat k="Played" v={profile.roundsPlayed} />
            <Stat k="Win rate" v={profile.roundsPlayed ? `${Math.round(rate * 100)}%` : "N/A"} />
            <Stat k="Streak" v={profile.currentStreak} sub={profile.bestStreak ? `Best ${profile.bestStreak}` : undefined} />
          </dl>
          <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Stat k="Tables" v={profile.tablesPlayed} />
            <Stat k="Cambio" v={`${profile.cambioWins}/${profile.cambioCalls}`} sub="Made / called" />
            <Stat k="Sticks" v={`${profile.sticksHit}/${profile.sticksHit + profile.sticksMissed}`} sub={stickRate(profile) === null ? "None yet" : `${Math.round(stickRate(profile)! * 100)}% landed`} />
          </dl>
        </>
      )}
    </section>
  );
}

function Stat({ k, v, sub, accent }: { k: string; v: ReactNode; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-[16px] bg-surface-2 px-3.5 py-3">
      <dt className="t-caption text-ink-3">{k}</dt>
      <dd className={`t-money mt-1 text-[22px] leading-none ${accent ? "text-accent" : "text-ink"}`}>{v}</dd>
      {sub ? <p className="t-footnote mt-1 text-ink-3">{sub}</p> : null}
    </div>
  );
}

/** Account navigation stays the same across screens, without repeating stats. */
export function AccountLink({ from = "/" }: { from?: string }) {
  return (
    <Link href={from === "/" ? "/me" : `/me?${new URLSearchParams({ from })}`} aria-label="Account settings" className={buttonClass({ size: "sm" })}>Account</Link>
  );
}
