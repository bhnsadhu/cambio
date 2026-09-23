"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { AskToJoin, Notifications } from "@/components/Friends";
import { ProfileCard } from "@/components/Profile";
import { Button, buttonClass } from "@/components/ui";
import { callProfile, profileGeneration, useAccountReady, useStoredProfile } from "@/lib/client/profile";
import { loginHref } from "@/lib/account/navigation";
import { useSocial } from "@/lib/client/social";
import { AppHeader } from "@/components/AppHeader";
import type { Profile } from "@/lib/social/types";

type Relation = "self" | "friends" | "incoming" | "outgoing" | "none";

/** Anyone's record, and the one button that matters on it. */
export default function PlayerPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  const stored = useStoredProfile();
  // Friendship and shared-round information belong to this viewer. Changing
  // account or profile route discards the previous viewer's loaded details.
  return <PlayerRecord key={`${handle}:${stored?.token ?? "guest"}`} handle={handle} />;
}

function PlayerRecord({ handle }: { handle: string }) {
  const social = useSocial();
  const accountReady = useAccountReady();
  const [state, setState] = useState<{ profile: Profile; relation: Relation; playedTogether: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    const generation = profileGeneration();
    try {
      const res = await callProfile<{ profile: Profile; relation: Relation; playedTogether: number }>(`/api/profile/${handle}`);
      if (id !== requestId.current || generation !== profileGeneration()) return;
      setState(res);
      setError(null);
    } catch (e) {
      if (id !== requestId.current || generation !== profileGeneration()) return;
      setError(e instanceof Error ? e.message : "Could not find that player.");
    }
  }, [handle]);

  useEffect(() => {
    if (!accountReady) return;
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [load, accountReady, social.profile?.id]);

  const perform = async (work: () => Promise<unknown>) => {
    setBusy(true); setActionError(null);
    try { await work(); await load(); }
    catch (error) { setActionError(error instanceof Error ? error.message : "Could not update this friendship."); }
    finally { setBusy(false); }
  };
  const friend = state ? social.social.friends.find((f) => f.id === state.profile.id) ?? null : null;

  return (
    <main className="site-shell min-h-screen pb-20">
      <AppHeader active={state?.relation === "self" ? "profile" : undefined} accountFrom={state?.relation === "self" ? "record" : `/p/${handle}`} loginNext={`/p/${handle}`} />

      {error ? (
        <div className="pt-16 animate-rise">
          <h1 className="t-title">{error}</h1>
          <p className="t-body mt-2 text-ink-2">Check the username with whoever sent it.</p>
          <div className="mt-5 flex flex-wrap gap-3"><Button onClick={() => void load()}>Try again</Button><Link href="/" className={buttonClass({ variant: "ghost" })}>Back to play</Link></div>
        </div>
      ) : !state ? (
        <div className="skeleton mt-8 h-[320px] rounded-panel" aria-busy />
      ) : (
        <div className="pt-8 animate-rise lg:pt-12">
          <p className="t-overline mb-6 text-ink-3">Player record</p>
          <ProfileCard profile={state.profile} actions={<>
          {actionError ? <p role="alert" className="t-sub text-red">{actionError}</p> : null}
          {friend?.playing ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel bg-surface-2 px-5 py-4 hairline">
              <p className="t-sub">
                {friend.playing.doNotDisturb ? "Do not disturb. Join requests are off."
                  : friend.playing.together ? "At your table" : "Playing at a table"}
                {!friend.playing.doNotDisturb && friend.playing.openSeats > 0 ? <> · {friend.playing.openSeats} {friend.playing.openSeats === 1 ? "seat" : "seats"} open</> : null}
              </p>
              <AskToJoin friend={friend} social={social} />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {!social.profile ? (
              <Link href={loginHref(`/p/${handle}`)} className={buttonClass({ variant: "primary" })}>Log in to add friends</Link>
            ) : state.relation === "self" ? (
              <Link href="/" className={buttonClass({ variant: "primary" })}>Find a table</Link>
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
              <Button variant="primary" disabled={busy} onClick={() => void perform(() => social.addFriend(state.profile.handle, state.profile.id))}>Add friend</Button>
            )}
            {state.playedTogether > 0 ? (
              <span className="t-footnote text-ink-3">
                {state.playedTogether} {state.playedTogether === 1 ? "round" : "rounds"} across the table from you
              </span>
            ) : null}
          </div>
          </>} />
        </div>
      )}
      <Notifications social={social} />
    </main>
  );
}
