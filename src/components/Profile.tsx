"use client";

import { Avatar } from "./Avatar";
import Link from "next/link";
import { type ReactNode } from "react";
import { standingFor, standingLine, stickRate, winRate } from "@/lib/social/rank";
import type { Profile } from "@/lib/social/types";
import { RankBadge } from "./RankBadge";
import { buttonClass } from "./ui";

/** Compact outlined metric groups, following Offsuit's statistics screen. */
export function ProfileCard({ profile, compact = false }: { profile: Profile; compact?: boolean }) {
  const standing = standingFor(profile.points);
  const rate = winRate(profile);
  const sticks = stickRate(profile);
  return (
    <section aria-label={`${profile.displayName}'s record`}>
      <header className="flex items-center gap-3 pb-7">
        <Avatar identity={profile.id} size={68} />
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-[26px] font-medium leading-tight tracking-[-0.025em]"><span className="min-w-0 break-words">{profile.displayName}</span><RankBadge points={profile.points} size={22} decorative /></h1>
          <p className="mt-1 text-sm text-ink-3">@{profile.handle}</p>
        </div>
      </header>

      <div className="rounded-2xl border border-line-strong bg-[#111113] px-5 py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <RankBadge points={profile.points} size={36} decorative />
            <div><p className="text-base font-medium">{standing.tier.name}</p><p className="mt-0.5 text-xs text-ink-3">{standingLine(profile)}</p></div>
          </div>
          <div className="shrink-0 text-right"><p className="tnum text-[24px] font-medium leading-tight">{profile.points.toLocaleString()}</p><p className="mt-0.5 text-xs text-ink-3">Points</p></div>
        </div>
        <div className="mt-5 h-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Progress to next rank" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(standing.progress * 100)}>
          <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(standing.progress * 100)}%` }} />
        </div>
        <p className="mt-2 text-xs text-ink-3">{standing.next ? `${standing.toNext} points to ${standing.next.name}` : "Highest rank reached"}</p>
      </div>

      {compact ? null : <>
        <h2 className="mt-8 mb-4 text-[18px] font-normal">Statistics</h2>
        <dl className="grid grid-cols-2 gap-3">
          <div className="stat-group"><Stat k="Tables played" v={profile.tablesPlayed} /></div>
          <div className="stat-group"><Stat k="Current streak" v={profile.currentStreak} /></div>
        </dl>
        <dl className="stat-group mt-3 grid grid-cols-3 gap-3">
          <Stat k="Rounds played" v={profile.roundsPlayed} />
          <Stat k="Rounds won" v={profile.roundsWon} />
          <Stat k="Win rate" v={profile.roundsPlayed ? `${Math.round(rate * 100)}%` : "N/A"} />
        </dl>
        <dl className="stat-group mt-3 grid grid-cols-3 gap-3">
          <Stat k="Sticks landed" v={profile.sticksHit} />
          <Stat k="Stick attempts" v={profile.sticksHit + profile.sticksMissed} />
          <Stat k="Stick rate" v={sticks === null ? "N/A" : `${Math.round(sticks * 100)}%`} />
        </dl>
        <dl className="stat-group mt-3 grid grid-cols-3 gap-3">
          <Stat k="Cambio calls" v={profile.cambioCalls} />
          <Stat k="Cambio wins" v={profile.cambioWins} />
          <Stat k="Best streak" v={profile.bestStreak} />
        </dl>
      </>}
    </section>
  );
}

function Stat({ k, v }: { k: string; v: ReactNode }) {
  return <div className="flex min-w-0 flex-col-reverse gap-1">
    <dt className="text-[11px] leading-snug text-ink-3 sm:text-xs">{k}</dt>
    <dd className="tnum break-words text-[17px] font-medium leading-tight">{v}</dd>
  </div>;
}

/** Account navigation stays the same across screens, without repeating stats. */
export function AccountLink({ from = "/" }: { from?: string }) {
  return (
    <Link href={from === "/" ? "/me" : `/me?${new URLSearchParams({ from })}`} aria-label="Account settings" className={buttonClass({ size: "sm" })}>Account</Link>
  );
}
