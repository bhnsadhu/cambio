"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Profile, Social } from "@/lib/social/types";
import { callProfile, saveStoredProfile, storedProfile, useStoredProfile } from "./profile";

/**
 * Friends, requests, invites and who is playing right now.
 *
 * One read covers all of it, and it is polled rather than streamed: a friends
 * list that is a few seconds stale costs nothing, and the game itself already
 * owns the realtime connection.
 */

const POLL_MS = 15_000;

export const EMPTY_SOCIAL: Social = { friends: [], incoming: [], outgoing: [], invites: [], opponents: [] };

export interface SocialHook {
  profile: Profile | null;
  social: Social;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addFriend: (handle: string) => Promise<string>;
  respond: (profileId: string, accept: boolean) => Promise<void>;
  remove: (profileId: string) => Promise<void>;
  invite: (profileId: string, code: string) => Promise<void>;
  answerInvite: (inviteId: string, accept: boolean) => Promise<string | null>;
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
    try {
      const res = await callProfile<{ profile: Profile | null; social: Social | null }>("/api/social");
      if (!alive.current) return;
      setFetched({ token: held.token, profile: res.profile, social: res.social ?? EMPTY_SOCIAL });
      // The record moves while you play; keep the cached copy in step.
      if (res.profile) saveStoredProfile({ token: held.token, profile: res.profile });
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

  const invite = useCallback(async (profileId: string, code: string) => {
    await callProfile("/api/social/invites", { method: "POST", body: JSON.stringify({ profileId, code }) });
  }, []);

  const answerInvite = useCallback(async (inviteId: string, accept: boolean) => {
    const res = await callProfile<{ code: string | null }>("/api/social/invites/respond", {
      method: "POST",
      body: JSON.stringify({ inviteId, accept }),
    });
    await refresh();
    return res.code;
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
export function usePresence(code: string | null) {
  const stored = useStoredProfile();
  useEffect(() => {
    if (!stored) return;
    let stopped = false;
    const beat = () => {
      if (stopped) return;
      void callProfile("/api/presence", { method: "POST", body: JSON.stringify({ code }) }).catch(() => {});
    };
    beat();
    const id = setInterval(beat, 45_000);
    return () => {
      stopped = true;
      clearInterval(id);
      // Leaving the table clears the light straight away.
      void callProfile("/api/presence", { method: "POST", body: JSON.stringify({ code: null }) }).catch(() => {});
    };
  }, [stored, code]);
}
