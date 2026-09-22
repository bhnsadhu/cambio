"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { averageScore, standingFor, standingLine, stickRate, winRate } from "@/lib/social/rank";
import type { Profile } from "@/lib/social/types";
import { Button, Chip, Field, inputClass } from "./ui";

/**
 * A player's standing, after the way a phone game shows it: the number that
 * matters is enormous and at the top, the rank sits above it as a name rather
 * than a number, and everything else is a quiet row underneath.
 */
export function ProfileCard({ profile, compact = false }: { profile: Profile; compact?: boolean }) {
  const standing = standingFor(profile.points);
  const rate = winRate(profile);
  const avg = averageScore(profile);
  return (
    <section className="rounded-panel bg-surface p-6 hairline" aria-label={`${profile.displayName}'s record`}>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="t-caption text-accent">{standing.tier.name}</p>
          <h2 className="t-title2 mt-1 truncate">{profile.displayName}</h2>
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
          <dl className="mt-6 grid grid-cols-4 gap-3">
            <Stat k="Played" v={profile.roundsPlayed} />
            <Stat k="Win rate" v={profile.roundsPlayed ? `${Math.round(rate * 100)}%` : "—"} />
            <Stat k="Best hand" v={profile.bestScore ?? "—"} accent={profile.bestScore !== null} />
            <Stat k="Streak" v={profile.currentStreak} sub={profile.bestStreak ? `best ${profile.bestStreak}` : undefined} />
          </dl>
          <dl className="mt-3 grid grid-cols-4 gap-3">
            <Stat k="Tables" v={profile.tablesPlayed} />
            <Stat k="Avg hand" v={avg === null ? "—" : avg.toFixed(1)} />
            <Stat k="Cambio" v={`${profile.cambioWins}/${profile.cambioCalls}`} sub="made / called" />
            <Stat k="Sticks" v={`${profile.sticksHit}/${profile.sticksHit + profile.sticksMissed}`} sub={stickRate(profile) === null ? "none yet" : `${Math.round(stickRate(profile)! * 100)}% landed`} />
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

/** The one-line version for a header: rank, wins, and a way in. */
export function ProfileBadge({ profile }: { profile: Profile }) {
  const standing = standingFor(profile.points);
  return (
    <Link href="/me" className="press inline-flex items-center gap-2 rounded-full bg-surface-2 py-1 pl-3 pr-1.5 text-[13px] hover:bg-surface-3">
      <span className="font-medium text-ink">{profile.displayName}</span>
      <span className="text-ink-3">{standing.tier.name}</span>
      <span className="t-money inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-accent px-1.5 text-[12px] font-semibold text-black">
        {profile.roundsWon}
      </span>
    </Link>
  );
}

/**
 * Saving a profile is one field and one button: no password, no email. The
 * device holds the key, the same way it holds a seat at a table.
 */
export function SaveProfile({ initialName = "", onSaved }: { initialName?: string; onSaved: (name: string) => Promise<unknown> }) {
  // The remembered name arrives after hydration, so the field follows it
  // until it is typed in rather than freezing on an empty first render.
  const [typed, setTyped] = useState<string | null>(null);
  const name = typed ?? initialName;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSaved(name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that profile.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-panel bg-surface p-6 hairline">
      <div>
        <h2 className="t-headline">Save a profile</h2>
        <p className="t-sub mt-1 text-ink-2">
          Keeps your wins, your rank and your friends across games. No password: this browser holds the key.
        </p>
      </div>
      <Field label="Your name">
        <input className={inputClass} value={name} onChange={(e) => setTyped(e.target.value)} placeholder="What the table calls you" maxLength={18} />
      </Field>
      {error ? <p className="t-sub text-accent-ink">{error}</p> : null}
      <Button type="submit" variant="primary" size="lg" disabled={busy || !name.trim()}>
        {busy ? "Saving" : "Save profile"}
      </Button>
    </form>
  );
}
