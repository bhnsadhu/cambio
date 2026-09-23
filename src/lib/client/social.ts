"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InviteAnswer, InviteOutcome, JoinRequestOutcome, Profile, Social } from "@/lib/social/types";
import { callProfile, profileGeneration, saveStoredProfile, storedProfile, useStoredProfile } from "./profile";
import { subscribeSocial } from "./realtime";

/**
 * Friends, requests, invites and who is playing right now.
 *
 * Presence changes invalidate the authenticated snapshot over realtime.
 * A short polling fallback keeps it accurate if the stream is unavailable.
 */

const POLL_MS = 10_000;
const FALLBACK_MS = 2000;

export const EMPTY_SOCIAL: Social = { friends: [], incoming: [], outgoing: [], invites: [], sent: [], joinRequests: [], sentJoinRequests: [], opponents: [] };

export interface SocialHook {
  profile: Profile | null;
  social: Social;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addFriend: (username: string) => Promise<string>;
  respond: (profileId: string, accept: boolean) => Promise<void>;
  remove: (profileId: string) => Promise<void>;
  invite: (profileId: string, code: string) => Promise<InviteOutcome>;
  answerInvite: (inviteId: string, accept: boolean) => Promise<InviteAnswer>;
  askToJoin: (profileId: string, tableId: string) => Promise<JoinRequestOutcome>;
  answerJoinRequest: (requestId: string, accept: boolean) => Promise<JoinRequestOutcome>;
}

/** What the last read returned, tagged with the profile it was read for. */
interface Fetched { token: string; profile: Profile | null; social: Social; channel: string | null }

export function useSocial(): SocialHook {
  const stored = useStoredProfile();
  const identity = stored?.token;
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const streaming = useRef(false);
  const lastRead = useRef(0);
  const readSequence = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Everything is derived from the stored profile and the last read, so
  // signing out or switching profiles needs no effect to tidy up after it.
  const fresh = stored && fetched && fetched.token === stored.token ? fetched : null;
  const profile = stored?.profile ?? null;
  const social = fresh?.social ?? EMPTY_SOCIAL;
  const loading = !!stored && !fresh && error === null;

  const refresh = useCallback(async () => {
    const held = storedProfile();
    if (!held) return;
    const gen = profileGeneration();
    const request = ++readSequence.current;
    try {
      const res = await callProfile<{ profile: Profile | null; social: Social | null; channel?: string | null }>("/api/social");
      // Whoever is signed in now may not be who this read was for: a sign-out
      // or a switch while it was in flight makes the answer somebody else's.
      const still = storedProfile();
      if (!alive.current || request !== readSequence.current || gen !== profileGeneration() || still?.token !== held.token) return;
      lastRead.current = Date.now();
      setFetched({ token: held.token, profile: res.profile, social: res.social ?? EMPTY_SOCIAL, channel: res.channel ?? null });
      // The record moves while you play; keep the cached copy in step. The
      // generation keeps a read that outlived a sign-out from bringing the
      // profile back.
      if (res.profile) saveStoredProfile({ ...held, profile: res.profile, ...(held.username ? { username: res.profile.handle } : {}) }, gen);
      else saveStoredProfile(null, gen);
      setError(null);
    } catch (e) {
      if (alive.current && request === readSequence.current && gen === profileGeneration()) setError(e instanceof Error ? e.message : "Could not reach the friends list.");
    }
  }, []);

  useEffect(() => {
    if (!identity) return;
    const first = window.setTimeout(() => { void refresh(); }, 0);
    const id = setInterval(() => { if (!streaming.current || Date.now() - lastRead.current >= POLL_MS) void refresh(); }, FALLBACK_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const onOnline = () => { void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearTimeout(first);
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [identity, refresh]);

  const channel = fresh?.channel;
  useEffect(() => {
    if (!channel) return;
    let active = true;
    const stop = subscribeSocial(channel, () => { if (active) void refresh(); }, (status) => {
      if (!active) return;
      streaming.current = status === "live";
      // A fresh read closes the gap between the first snapshot and subscription.
      if (status === "live") void refresh();
    });
    return () => { active = false; streaming.current = false; stop(); };
  }, [channel, identity, refresh]);

  const addFriend = useCallback(async (username: string) => {
    const res = await callProfile<{ outcome: string }>("/api/social/friends", {
      method: "POST",
      body: JSON.stringify({ username }),
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

  const joinRequest = useCallback(async (path: string, body: object): Promise<JoinRequestOutcome> => {
    try {
      const res = await callProfile<{ outcome: JoinRequestOutcome }>(path, { method: "POST", body: JSON.stringify(body) });
      await refresh();
      return res.outcome;
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Could not update that request." };
    }
  }, [refresh]);
  const askToJoin = useCallback((profileId: string, tableId: string) =>
    joinRequest("/api/social/join-requests", { profileId, tableId }), [joinRequest]);
  const answerJoinRequest = useCallback((requestId: string, accept: boolean) =>
    joinRequest("/api/social/join-requests/respond", { requestId, accept }), [joinRequest]);

  return useMemo(
    () => ({ profile, social, loading, error, refresh, addFriend, respond, remove, invite, answerInvite, askToJoin, answerJoinRequest }),
    [profile, social, loading, error, refresh, addFriend, respond, remove, invite, answerInvite, askToJoin, answerJoinRequest],
  );
}
