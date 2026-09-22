"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InviteAnswer, InviteOutcome, Profile, Social } from "@/lib/social/types";
import { callProfile, profileGeneration, saveStoredProfile, storedProfile, useStoredProfile } from "./profile";

/**
 * Friends, requests, invites and who is playing right now.
 *
 * One read covers all of it, and it is polled rather than streamed: a friends
 * list that is a few seconds stale costs nothing, and the game itself already
 * owns the realtime connection.
 */

const POLL_MS = 10_000;
/** Three of these inside the 75 seconds the server calls a row stale. */
const PRESENCE_BEAT_MS = 25_000;

export const EMPTY_SOCIAL: Social = { friends: [], incoming: [], outgoing: [], invites: [], sent: [], opponents: [] };

export interface SocialHook {
  profile: Profile | null;
  social: Social;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addFriend: (handle: string) => Promise<string>;
  respond: (profileId: string, accept: boolean) => Promise<void>;
  remove: (profileId: string) => Promise<void>;
  invite: (profileId: string, code: string) => Promise<InviteOutcome>;
  answerInvite: (inviteId: string, accept: boolean) => Promise<InviteAnswer>;
}

/** What the last read returned, tagged with the profile it was read for. */
interface Fetched { token: string; profile: Profile | null; social: Social }

export function useSocial(): SocialHook {
  const stored = useStoredProfile();
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Everything is derived from the stored profile and the last read, so
  // signing out or switching profiles needs no effect to tidy up after it.
  const fresh = stored && fetched && fetched.token === stored.token ? fetched : null;
  const profile = stored ? fresh?.profile ?? stored.profile : null;
  const social = fresh?.social ?? EMPTY_SOCIAL;
  const loading = !!stored && !fresh && error === null;

  const refresh = useCallback(async () => {
    const held = storedProfile();
    if (!held) return;
    const gen = profileGeneration();
    try {
      const res = await callProfile<{ profile: Profile | null; social: Social | null }>("/api/social");
      if (!alive.current || gen !== profileGeneration()) return;
      setFetched({ token: held.token, profile: res.profile, social: res.social ?? EMPTY_SOCIAL });
      // The record moves while you play; keep the cached copy in step. The
      // generation keeps a read that outlived a sign-out from bringing the
      // profile back.
      if (res.profile) saveStoredProfile({ token: held.token, profile: res.profile }, gen);
      setError(null);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Could not reach the friends list.");
    }
  }, []);

  useEffect(() => {
    if (!stored) return;
    const first = window.setTimeout(() => { void refresh(); }, 0);
    const id = setInterval(() => void refresh(), POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [stored, refresh]);

  const addFriend = useCallback(async (handle: string) => {
    const res = await callProfile<{ outcome: string }>("/api/social/friends", {
      method: "POST",
      body: JSON.stringify({ handle }),
    });
    await refresh();
    return res.outcome;
  }, [refresh]);

  const respond = useCallback(async (profileId: string, accept: boolean) => {
    await callProfile("/api/social/friends/respond", { method: "POST", body: JSON.stringify({ profileId, accept }) });
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (profileId: string) => {
    await callProfile("/api/social/friends/remove", { method: "POST", body: JSON.stringify({ profileId }) });
    await refresh();
  }, [refresh]);

  const invite = useCallback(async (profileId: string, code: string): Promise<InviteOutcome> => {
    try {
      const res = await callProfile<{ outcome: InviteOutcome }>("/api/social/invites", {
        method: "POST",
        body: JSON.stringify({ profileId, code }),
      });
      await refresh();
      return res.outcome;
    } catch (e) {
      return { ok: false, reason: "table-gone", message: e instanceof Error ? e.message : "Could not send that invite." };
    }
  }, [refresh]);

  const answerInvite = useCallback(async (inviteId: string, accept: boolean): Promise<InviteAnswer> => {
    try {
      const res = await callProfile<{ answer: InviteAnswer }>("/api/social/invites/respond", {
        method: "POST",
        body: JSON.stringify({ inviteId, accept }),
      });
      await refresh();
      return res.answer;
    } catch (e) {
      return { ok: false, reason: "gone", message: e instanceof Error ? e.message : "Could not answer that invite." };
    }
  }, [refresh]);

  return useMemo(
    () => ({ profile, social, loading, error, refresh, addFriend, respond, remove, invite, answerInvite }),
    [profile, social, loading, error, refresh, addFriend, respond, remove, invite, answerInvite],
  );
}

/**
 * Tells the server which table this browser is sitting at, so friends can see
 * the game and join an open seat. Clears itself when the page goes away.
 */
/**
 * Tells the server where this browser is, so friends can see it: a table code
 * while seated at one, null while just about. Called from every page, so
 * "online" means the app is open rather than "happens to be mid game".
 *
 * Keyed on the token rather than the stored object: the profile object is
 * replaced on every poll, and depending on it tore this effect down and set
 * it up again every few seconds — each teardown blanking the row for as long
 * as it took the next beat to land, which is what made a friend flicker
 * between online and offline.
 */
export function usePresence(code: string | null) {
  const token = useStoredProfile()?.token ?? null;
  useEffect(() => {
    if (!token) return;
    let stopped = false;
    const beat = () => {
      if (stopped) return;
      void callProfile("/api/presence", { method: "POST", body: JSON.stringify({ code }) }).catch(() => {});
    };
    beat();
    const id = setInterval(beat, PRESENCE_BEAT_MS);
    // A closed tab should go dark at once rather than linger until the row
    // goes stale; `sendBeacon` is the one send that survives an unload. This
    // is `pagehide` rather than `visibilitychange`, because switching tabs is
    // not leaving — the beat carries on in the background.
    const onLeave = () => {
      try {
        navigator.sendBeacon?.("/api/presence", new Blob(
          [JSON.stringify({ code: null, token })],
          { type: "application/json" },
        ));
      } catch { /* best effort */ }
    };
    // Coming back to a backgrounded tab checks in at once rather than waiting
    // out the rest of a throttled interval.
    const onVisible = () => { if (document.visibilityState === "visible") beat(); };
    window.addEventListener("pagehide", onLeave);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(id);
      window.removeEventListener("pagehide", onLeave);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, code]);
}
