"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { Notifications } from "@/components/Friends";
import { ProfileCard } from "@/components/Profile";
import { Button, Wordmark } from "@/components/ui";
import { callProfile } from "@/lib/client/profile";
import { usePresence, useSocial } from "@/lib/client/social";
import type { Profile } from "@/lib/social/types";

type Relation = "self" | "friends" | "incoming" | "outgoing" | "none";

/** Anyone's record, and the one button that matters on it. */
export default function PlayerPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  const social = useSocial();
  usePresence(null);
  const [state, setState] = useState<{ profile: Profile; relation: Relation; playedTogether: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const perform = async (work: () => Promise<unknown>) => {
    setBusy(true); setActionError(null);
    try { await work(); await load(); }
    catch (error) { setActionError(error instanceof Error ? error.message : "Could not update this friendship."); }
    finally { setBusy(false); }
  };
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
          {actionError ? <p role="alert" className="t-sub text-red">{actionError}</p> : null}
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
            {!social.profile ? (
              <Link href="/me"><Button variant="primary">Log in to add friends</Button></Link>
            ) : state.relation === "self" ? (
              <Link href="/me"><Button variant="secondary">This is you</Button></Link>
            ) : state.relation === "friends" ? (
              <Button variant="ghost" disabled={busy} onClick={() => void perform(() => social.remove(state.profile.id))}>Remove friend</Button>
            ) : state.relation === "incoming" ? (
              <>
                <Button variant="accent" disabled={busy} onClick={() => void perform(() => social.respond(state.profile.id, true))}>Accept request</Button>
                <Button variant="ghost" disabled={busy} onClick={() => void perform(() => social.respond(state.profile.id, false))}>Decline</Button>
              </>
            ) : state.relation === "outgoing" ? (
              <Button variant="secondary" disabled>Request sent</Button>
            ) : (
              <Button variant="primary" disabled={busy} onClick={() => void perform(() => social.addFriend(state.profile.handle))}>Add friend</Button>
            )}
            {state.playedTogether > 0 ? (
              <span className="t-footnote text-ink-3">
                {state.playedTogether} {state.playedTogether === 1 ? "round" : "rounds"} across the table from you
              </span>
            ) : null}
          </div>
        </div>
      )}
      <Notifications social={social} />
    </main>
  );
}
