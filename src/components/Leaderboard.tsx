"use client";

import { Avatar } from "./Avatar";
import Link from "next/link";
import { useEffect, useState } from "react";
import { loginHref } from "@/lib/account/navigation";
import { callProfile, profileGeneration, useAccountReady, useStoredProfile } from "@/lib/client/profile";
import { useSocial } from "@/lib/client/social";
import type { LeaderboardScope, LeaderboardSnapshot } from "@/lib/social/leaderboard";
import { ordinal } from "@/lib/social/rank";
import { RankBadge } from "./RankBadge";
import { Notifications } from "./Friends";
import { AccountLink } from "./Profile";
import { Button, buttonClass, Wordmark } from "./ui";

export function Leaderboard({ initialScope }: { initialScope: LeaderboardScope | null }) {
  const ready = useAccountReady();
  const stored = useStoredProfile();
  const social = useSocial();
  const scope = initialScope ?? (stored ? "friends" : "all");
  const path = `/leaderboard?scope=${scope}`;
  return (
    <main className="mx-auto min-h-screen w-full max-w-[620px] px-5 pb-16 sm:px-8">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 py-3">
        <Link href="/" aria-label="Cambio home"><Wordmark /></Link>
        <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-3">
          <Link href="/" className="t-sub text-ink-2 hover:text-ink">Back to play</Link>
          {ready ? stored ? <AccountLink from={path} /> : <Link href={loginHref(path)} className="t-sub text-ink-2 hover:text-ink">Log in</Link> : null}
        </nav>
      </header>
      <div className="pt-10 pb-7">
        <h1 className="text-[30px] font-normal leading-tight tracking-[-0.025em] text-ink-2">Leaderboard</h1>
      </div>
      <nav className="mb-6 flex gap-2" aria-label="Leaderboard views">
        {(["friends", "all"] as const).map((value) => (
          <Link key={value} href={`/leaderboard?scope=${value}`} aria-current={scope === value ? "page" : undefined}
            className={buttonClass({ variant: scope === value ? "primary" : "secondary" })}>
            {value === "friends" ? "Friends" : "All players"}
          </Link>
        ))}
      </nav>
      {!ready ? <p role="status" className="t-sub text-ink-2">Loading the leaderboard</p>
        : scope === "friends" && !stored ? <section className="rounded-panel bg-surface p-6 hairline">
          <h2 className="t-headline">Compare scores with your friends</h2>
          <p className="t-body mt-2 text-ink-2">Log in or create an account to add friends and see your rank together.</p>
          <div className="mt-5 flex flex-wrap gap-4">
            <Link href={loginHref(path)} className="t-sub font-medium text-accent">Log in</Link>
            <Link href={loginHref(path, "register")} className="t-sub font-medium text-ink">Create account</Link>
          </div>
        </section> : <Standings key={`${stored?.token ?? "guest"}:${scope}`} scope={scope} />}
      <Notifications social={social} />
    </main>
  );
}

function Standings({ scope }: { scope: LeaderboardScope }) {
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<LeaderboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = snapshot?.offset === offset ? snapshot : null;
  useEffect(() => {
    let active = true;
    const load = async () => {
      const generation = profileGeneration();
      try {
        const result = await callProfile<LeaderboardSnapshot>(`/api/leaderboard?scope=${scope}&offset=${offset}`);
        if (active && generation === profileGeneration()) { setSnapshot(result); setError(null); }
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : "Could not load the leaderboard. Try again.");
      }
    };
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 30_000);
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; window.clearTimeout(first); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [scope, offset, attempt]);

  const changePage = (next: number) => { setError(null); setOffset(next); };
  return (
    <section aria-label={scope === "friends" ? "Friends standings" : "All player standings"}>
      {error ? <div className="mb-4 flex flex-wrap items-center gap-3">
        <p role="alert" className="t-sub text-red">{error}</p>
        <Button size="sm" onClick={() => { setError(null); setAttempt((value) => value + 1); }}>Try again</Button>
      </div> : null}
      {!data ? !error ? <p role="status" className="t-sub text-ink-2">Loading the leaderboard</p> : null : <>
        {data.me ? <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line px-1 pb-5" aria-label="Your standing">
          <div>
            <p className="text-xs text-ink-3">Your rank {scope === "friends" ? "among friends" : "among all players"}</p>
            <p className="mt-1 text-xl font-medium">{ordinal(data.me.rank)} <span className="t-body text-ink-2">of {data.total}</span></p>
          </div>
          <Link href={`/p/${data.me.handle}`} className="t-sub font-medium text-accent">Your record</Link>
        </div> : <p className="t-sub mb-5 text-ink-2"><Link href={loginHref(`/leaderboard?scope=${scope}`, "register")} className="font-medium text-ink hover:text-accent">Create an account</Link> to appear here and save your results.</p>}
        <table className="w-full table-fixed border-separate border-spacing-x-0 border-spacing-y-1 text-left">
          <caption className="sr-only">{scope === "friends" ? "You and your friends" : "All players"}, ranked by points</caption>
          <thead className="sr-only"><tr><th scope="col">Rank</th><th scope="col">Player and points</th></tr></thead>
          <tbody>{data.entries.map((entry) => <tr key={entry.id} aria-label={entry.id === data.me?.id ? "Your leaderboard row" : undefined} className={entry.id === data.me?.id ? "bg-surface-2" : ""}>
            <td className="w-12 rounded-l-2xl py-4 pl-3 pr-2 align-middle text-center sm:w-16 sm:pl-5">
              {entry.rank <= 3 ? <Placement rank={entry.rank} /> : <span className="tnum text-lg text-ink-2">{entry.rank}</span>}
            </td>
            <th scope="row" className="rounded-r-2xl py-4 pl-2 pr-5 font-normal sm:pr-6">
              <Link href={`/p/${entry.handle}`} className="flex min-w-0 items-center gap-3 hover:text-accent sm:gap-4">
                <Avatar identity={entry.id} size={52} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[17px] font-medium leading-snug"><span className="min-w-0 break-words">{entry.displayName}</span><RankBadge points={entry.points} size={18} /></span>
                  <span className="tnum mt-1 block text-[14px] text-ink-3">{entry.points.toLocaleString()} points{entry.id === data.me?.id ? " · You" : ""}</span>
                </span>
              </Link>
            </th>
          </tr>)}</tbody>
        </table>
        {!data.entries.length ? <p className="t-body px-3 py-6 text-ink-2">{offset ? "No more players on this page." : "No players yet. Be the first to join."}</p> : null}
        {offset > 0 || data.nextOffset !== null ? <nav aria-label="Leaderboard pages" className="mt-4 flex items-center justify-between gap-3">
          <Button size="sm" disabled={offset === 0} onClick={() => changePage(Math.max(0, offset - 50))}>Previous</Button>
          <span className="t-sub text-ink-3">Page {Math.floor(offset / 50) + 1}</span>
          <Button size="sm" disabled={data.nextOffset === null} onClick={() => changePage(data.nextOffset!)}>Next</Button>
        </nav> : null}
        {scope === "friends" && data.total <= 1 ? <p className="t-sub mt-4 text-ink-2">Your friends will appear here once they accept. <Link href="/#friends" className="font-medium text-ink hover:text-accent">Add friends</Link></p> : null}
        <p className="t-footnote mt-5 text-ink-3">Ranked by lifetime points. Equal points share a rank. {scope === "friends" ? "Includes you and your accepted friends." : "Includes all saved player accounts."}</p>
        <details className="mt-3 text-ink-2">
          <summary className="t-sub cursor-pointer">How points work</summary>
          <p className="t-sub mt-2">Earn 12 points for a win or 3 for any other completed round, plus 5 extra when you call Cambio and win. Rounds with house bots count too.</p>
        </details>
      </>}
    </section>
  );
}

function Placement({ rank }: { rank: number }) {
  const color = ["#dfb75d", "#c1c4d2", "#bd8961"][rank - 1];
  return <svg width="26" height="32" viewBox="0 0 26 32" className="mx-auto" role="img" aria-label={`${ordinal(rank)} place`}>
    <path d="m3 1 5 12h10L23 1h-7l-3 6-3-6Z" fill="#5382cb" />
    <circle cx="13" cy="20" r="10" fill={color} />
    <circle cx="13" cy="20" r="7.5" fill="none" stroke="#000" strokeOpacity=".15" />
    <text x="13" y="24" textAnchor="middle" fill="#372b1f" fontSize="12" fontWeight="600">{rank}</text>
  </svg>;
}
