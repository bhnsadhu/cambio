"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Action, PlayerView, PublicView } from "@/lib/game/types";
import { profileGeneration, storedProfile, useStoredProfile } from "./profile";
import { api, RequestError, type ActionResponse } from "./api";
import { useNotify } from "@/components/Notification";
import { subscribeGame, type ConnectionStatus } from "./realtime";
import { forgetRecentTable, getServerSessionSnapshot, getSessionSnapshot, recentTable, rememberTable, setSessionValue, subscribeSession, type Session } from "./session";

export interface GameHook {
  status: "loading" | "ready" | "notfound" | "error";
  view: PlayerView | null;
  me: string | null;
  session: Session | null;
  connection: ConnectionStatus;
  busy: boolean;
  removed: boolean;
  /** milliseconds to add to Date.now() to get the server's clock */
  skew: number;
  send: (action: Action) => Promise<ActionResponse | null>;
  refresh: () => Promise<void>;
  setSession: (s: Session | null) => void;
  toast: (text: string, tone?: "neutral" | "good" | "bad") => void;
}

const POLL_MS = 5000;
// The fallback must be quicker than the final sticking window, including
// when a realtime connection silently stops delivering table updates.
const PLAY_POLL_MS = 1000;
const NUDGE_AFTER_MS = 6000;

interface ViewerIdentity { accountToken: string | null; seatToken: string | null }
interface ViewSnapshot { view: PlayerView; me: string | null; identity: ViewerIdentity | null }
const sameViewer = (a: ViewerIdentity | null | undefined, b: ViewerIdentity) =>
  !!a && a.accountToken === b.accountToken && a.seatToken === b.seatToken;

export function useGame(code: string): GameHook {
  const account = useStoredProfile();
  const session = useSyncExternalStore(subscribeSession, () => getSessionSnapshot(code), getServerSessionSnapshot);
  const [snapshot, setSnapshot] = useState<ViewSnapshot | null>(null);
  const authorised = sameViewer(snapshot?.identity, { accountToken: account?.token ?? null, seatToken: session?.token ?? null });
  // Already-rendered private cards belong to the identity that fetched them.
  // Revoke them immediately on logout/seat changes, even while offline.
  const view = useMemo(() => snapshot ? { ...snapshot.view, private: authorised ? snapshot.view.private : null } : null, [snapshot, authorised]);
  const me = authorised ? snapshot?.me ?? null : null;
  const [status, setStatus] = useState<GameHook["status"]>("loading");
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState(false);
  const toast = useNotify();
  const [skewState, setSkewState] = useState(0);
  const skew = useRef(0);
  const lastChange = useRef(0);
  const lastNudge = useRef(0);
  const advancedFor = useRef<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const viewRef = useRef<PlayerView | null>(null);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { sessionRef.current = session; }, [session]);

  const setSession = useCallback((s: Session | null) => {
    if (s) setRemoved(false);
    sessionRef.current = s;
    setSessionValue(code, s);
  }, [code]);

  /** Merge a public view if it is newer than what we have. */
  const acceptPublic = useCallback((pub: PublicView) => {
    setSnapshot((cur) => {
      if (cur && cur.view.public.version >= pub.version) return cur;
      lastChange.current = Date.now();
      // Private data can only change through our own actions or a new deal; keep it.
      const privateView = cur?.view.private;
      return {
        view: { public: pub, private: privateView && pub.players.some((p) => p.id === privateView.playerId) ? privateView : null },
        me: cur?.me ?? null, identity: cur?.identity ?? null,
      };
    });
  }, []);

  const acceptFull = useCallback((full: PlayerView, who: string | null, identity: ViewerIdentity) => {
    skew.current = full.public.serverNow - Date.now();
    setSkewState((cur) => (Math.abs(cur - skew.current) > 250 ? skew.current : cur));
    setSnapshot((cur) => {
      const newerPublic = cur && cur.view.public.version > full.public.version;
      const pub = newerPublic ? cur.view.public : full.public;
      // A newer public update may outlive an account switch. Never tag the
      // previous account's retained private view as belonging to the new one.
      const privateView = newerPublic && sameViewer(cur.identity, identity) ? cur.view.private : full.private;
      if (!cur || cur.view.public.version < full.public.version) lastChange.current = Date.now();
      return {
        view: { public: pub, private: privateView && pub.players.some((p) => p.id === privateView.playerId) ? privateView : null },
        me: who && pub.players.some((p) => p.id === who && !p.isBot) ? who : null,
        identity,
      };
    });
  }, []);

  const refresh = useCallback(async () => {
    const gen = profileGeneration();
    const accountToken = storedProfile()?.token ?? null;
    const token = sessionRef.current?.token ?? null;
    try {
      const res = await api.state(code, token);
      // A response for a different seat than the one we hold now is stale
      // (hydration fires one fetch before the stored seat is known).
      if (gen !== profileGeneration() || (sessionRef.current?.token ?? null) !== token) return;
      acceptFull(res.view, res.me, { accountToken, seatToken: res.seat?.token ?? (res.me ? token : null) });
      if (!res.me && sessionRef.current && res.view.public.log.some((entry) => entry.kind === "kick" && entry.subjectIds?.includes(sessionRef.current!.playerId))) setRemoved(true);
      if (res.seat && (sessionRef.current?.playerId !== res.seat.playerId || sessionRef.current?.token !== res.seat.token || sessionRef.current?.name !== res.seat.name)) setSession(res.seat);
      else if (token && !res.me) { setSession(null); forgetRecentTable(code); }
      setStatus("ready");
    } catch (e) {
      if (gen !== profileGeneration() || (sessionRef.current?.token ?? null) !== token) return;
      if (e instanceof RequestError && e.status === 404) setStatus("notfound");
      else if (!viewRef.current) setStatus("error");
    }
  }, [code, acceptFull, setSession]);

  // Initial load (and reload whenever the seat changes).
  useEffect(() => {
    sessionRef.current = session;
    const t = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(t);
  }, [session, account?.token, refresh]);

  // Only real, foreground table use renews the home shortcut. An older tab's
  // polling must never take it back from a more recently visited table.
  useEffect(() => {
    if (status !== "ready" || !me || session?.playerId !== me) return;
    const visible = () => document.visibilityState === "visible" && document.hasFocus();
    const visit = () => { if (visible()) rememberTable(code); };
    visit();
    window.addEventListener("focus", visit);
    document.addEventListener("visibilitychange", visit);
    const timer = window.setInterval(() => {
      if (visible() && recentTable()?.code === code) rememberTable(code);
    }, 15_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", visit);
      document.removeEventListener("visibilitychange", visit);
    };
  }, [code, me, status, session?.playerId]);

  // Realtime subscription and reconnect refresh.
  useEffect(() => {
    const stop = subscribeGame(
      code,
      (pub) => {
        const prev = viewRef.current?.public;
        acceptPublic(pub);
        // A fresh deal is the one private change that comes from someone
        // else's action (the host's): fetch our opening peek right away.
        if (sessionRef.current && prev && (pub.round !== prev.round || (pub.phase === "peek" && prev.phase !== "peek")
          || !pub.players.some((p) => p.id === sessionRef.current!.playerId))) {
          void refresh();
        }
      },
      (s) => {
        setConnection(s);
        if (s === "live") void refresh();
      },
    );
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [code, acceptPublic, refresh]);

  const activeRound = view?.public.phase === "playing" || view?.public.phase === "final";
  useEffect(() => {
    const poll = setInterval(() => void refresh(), activeRound ? PLAY_POLL_MS : POLL_MS);
    return () => clearInterval(poll);
  }, [activeRound, refresh]);

  const send = useCallback(async (action: Action): Promise<ActionResponse | null> => {
    const s = sessionRef.current;
    if (!s) return null;
    const gen = profileGeneration();
    const accountToken = storedProfile()?.token ?? null;
    const actionId = crypto.randomUUID();
    setBusy(true);
    try {
      let res: ActionResponse;
      try {
        res = await api.action(code, s.token, actionId, action);
      } catch (e) {
        if (e instanceof RequestError) throw e;
        // Network hiccup: the action id makes a retry safe.
        res = await api.action(code, s.token, actionId, action);
      }
      if (gen !== profileGeneration() || sessionRef.current?.token !== s.token) return null;
      acceptFull(res.view, res.me, { accountToken, seatToken: res.me ? s.token : null });
      return res;
    } catch (e) {
      if (gen !== profileGeneration() || sessionRef.current?.token !== s.token) return null;
      if (e instanceof RequestError) {
        if (e.status === 401) setSession(null);
        toast(e.message, "bad");
        void refresh();
      } else {
        toast("Lost the connection for a moment. Try again.", "bad");
      }
      return null;
    } finally {
      setBusy(false);
    }
  }, [code, acceptFull, refresh, setSession, toast]);

  // Watchdog: advance the opening peek on time, report idle turns, nudge stalled bots.
  const reportedDeadline = useRef<number | null>(null);
  const reportedStickWindow = useRef<number | null>(null);
  useEffect(() => {
    const t = setInterval(() => {
      const v = viewRef.current?.public;
      if (!v) return;
      const serverNow = Date.now() + skew.current;
      if (v.paused) return; // a paused table has no clocks to report on
      if (v.turnDeadline !== null && serverNow >= v.turnDeadline + 700 && sessionRef.current && reportedDeadline.current !== v.turnDeadline) {
        reportedDeadline.current = v.turnDeadline;
        void send({ type: "timeout" });
      }
      // A ready check nobody answers: report it so the round is dealt anyway.
      if (v.phase === "ready" && v.readyDeadline !== null && serverNow >= v.readyDeadline + 700
          && sessionRef.current && reportedDeadline.current !== v.readyDeadline) {
        reportedDeadline.current = v.readyDeadline;
        void send({ type: "timeout" });
      }
      // The final reaction window elapsed without another successful stick.
      // Report it so the round still closes if the server runner stopped.
      if (v.phase === "final" && v.stickWindowUntil !== null && serverNow >= v.stickWindowUntil + 200
          && sessionRef.current && reportedStickWindow.current !== v.stickWindowUntil) {
        reportedStickWindow.current = v.stickWindowUntil;
        void send({ type: "timeout" });
      }
      if (v.phase === "peek" && v.openingPeekUntil !== null && serverNow >= v.openingPeekUntil + 150) {
        // The deadline is part of the key: a pause pushes it forward, and the
        // resumed peek still needs someone to advance it.
        const key = `${v.code}:${v.round}:${v.openingPeekUntil}`;
        if (advancedFor.current !== key && sessionRef.current) {
          advancedFor.current = key;
          void send({ type: "advance" });
        }
      }
      const botMustAct =
        (v.turn && v.players.find((p) => p.id === v.turn!.playerId)?.isBot) ||
        (v.turnDeadline !== null && serverNow > v.turnDeadline + 3000) ||
        (v.pendingPower && v.players.find((p) => p.id === v.pendingPower!.playerId)?.isBot) ||
        v.pendingGives.some((g) => v.players.find((p) => p.id === g.from)?.isBot) ||
        (v.phase === "peek" && v.openingPeekUntil !== null && serverNow > v.openingPeekUntil + 2000) ||
        (v.phase === "ready" && v.players.some((p) => p.isBot && !v.readyIds.includes(p.id))) ||
        (v.phase === "final" && v.stickWindowUntil !== null && serverNow > v.stickWindowUntil + 1500);
      if (botMustAct && Date.now() - lastChange.current > NUDGE_AFTER_MS && Date.now() - lastNudge.current > NUDGE_AFTER_MS) {
        lastNudge.current = Date.now();
        void api.nudge(code).catch(() => {});
      }
    }, 1000);
    return () => clearInterval(t);
  }, [code, send]);

  return useMemo(
    () => ({ status, view, me, session, connection, busy, removed, skew: skewState, send, refresh, setSession, toast }),
    [status, view, me, session, connection, busy, removed, skewState, send, refresh, setSession, toast],
  );
}
