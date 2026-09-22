"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { ProfileCard } from "@/components/Profile";
import { Button, Wordmark } from "@/components/ui";
import { callProfile } from "@/lib/client/profile";
import { useSocial } from "@/lib/client/social";
import type { Profile } from "@/lib/social/types";

type Relation = "self" | "friends" | "incoming" | "outgoing" | "none";

/** Anyone's record, and the one button that matters on it. */
export default function PlayerPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  const social = useSocial();
  const [state, setState] = useState<{ profile: Profile; relation: Relation; playedTogether: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await callProfile<{ profile: Profile; relation: Relation; playedTogether: number }>(`/api/profile/${handle}`);
      setState(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not find that player.");
    }
  }, [handle]);

  useEffect(() => {
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const friend = state ? social.social.friends.find((f) => f.id === state.profile.id) ?? null : null;

  return (
    <main className="mx-auto min-h-screen w-full max-w-[620px] px-8 pb-20">
      <header className="flex h-14 items-center justify-between">
        <Link href="/" aria-label="Cambio home"><Wordmark /></Link>
        <Link href="/me"><Button variant="ghost" size="sm">Your profile</Button></Link>
      </header>

      {error ? (
        <div className="pt-16 animate-rise">
          <h1 className="t-title">{error}</h1>
          <p className="t-body mt-2 text-ink-2">Check the handle with whoever sent it.</p>
        </div>
      ) : !state ? (
        <div className="skeleton mt-8 h-[320px] rounded-panel" aria-busy />
      ) : (
        <div className="flex flex-col gap-4 pt-8 animate-rise">
          <ProfileCard profile={state.profile} />
          {friend?.playing ? (
            <div className="flex items-center justify-between gap-3 rounded-panel bg-surface-2 px-5 py-4 hairline">
              <p className="t-sub">
                Playing table <span className="tnum font-semibold tracking-[0.06em]">{friend.playing.code}</span> right now
                {friend.playing.openSeats > 0 ? <> · {friend.playing.openSeats} {friend.playing.openSeats === 1 ? "seat" : "seats"} open</> : null}
              </p>
              <Link href={`/g/${friend.playing.code}`}>
                <Button variant={friend.playing.openSeats > 0 ? "accent" : "secondary"} size="sm">
                  {friend.playing.openSeats > 0 ? "Take a seat" : "Watch"}
                </Button>
              </Link>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            {state.relation === "self" ? (
              <Link href="/me"><Button variant="secondary">This is you</Button></Link>
            ) : state.relation === "friends" ? (
              <Button variant="ghost" onClick={async () => { await social.remove(state.profile.id); await load(); }}>Remove friend</Button>
            ) : state.relation === "incoming" ? (
              <>
                <Button variant="accent" onClick={async () => { await social.respond(state.profile.id, true); await load(); }}>Accept request</Button>
                <Button variant="ghost" onClick={async () => { await social.respond(state.profile.id, false); await load(); }}>Decline</Button>
              </>
            ) : state.relation === "outgoing" ? (
              <Button variant="secondary" disabled>Request sent</Button>
            ) : (
              <Button variant="primary" onClick={async () => { await social.addFriend(state.profile.handle); await load(); }}>Add friend</Button>
            )}
            {state.playedTogether > 0 ? (
              <span className="t-footnote text-ink-3">
                {state.playedTogether} {state.playedTogether === 1 ? "round" : "rounds"} across the table from you
              </span>
            ) : null}
          </div>
        </div>
      )}
    </main>
  );
}
