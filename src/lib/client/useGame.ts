"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Action, PlayerView, PublicView } from "@/lib/game/types";
import { api, RequestError, type ActionResponse } from "./api";
import { subscribeGame, type ConnectionStatus } from "./realtime";
import { getServerSessionSnapshot, getSessionSnapshot, setSessionValue, subscribeSession, type Session } from "./session";

export interface Toast { id: number; text: string; tone: "neutral" | "good" | "bad" }

export interface GameHook {
  status: "loading" | "ready" | "notfound";
  view: PlayerView | null;
  me: string | null;
  session: Session | null;
  connection: ConnectionStatus;
  busy: boolean;
  toasts: Toast[];
  /** milliseconds to add to Date.now() to get the server's clock */
  skew: number;
  send: (action: Action) => Promise<ActionResponse | null>;
  refresh: () => Promise<void>;
  setSession: (s: Session | null) => void;
  toast: (text: string, tone?: Toast["tone"]) => void;
}

const POLL_MS = 5000;
const NUDGE_AFTER_MS = 6000;

export function useGame(code: string): GameHook {
  const session = useSyncExternalStore(subscribeSession, () => getSessionSnapshot(code), getServerSessionSnapshot);
  const [view, setView] = useState<PlayerView | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [status, setStatus] = useState<GameHook["status"]>("loading");
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
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
    sessionRef.current = s;
    setSessionValue(code, s);
  }, [code]);

  const toast = useCallback((text: string, tone: Toast["tone"] = "neutral") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  /** Merge a public view if it is newer than what we have. */
  const acceptPublic = useCallback((pub: PublicView) => {
    setView((cur) => {
      if (cur && cur.public.version >= pub.version) return cur;
      lastChange.current = Date.now();
      // Private data can only change through our own actions or a new deal; keep it.
      return { public: pub, private: cur?.private ?? null };
    });
  }, []);

  const acceptFull = useCallback((full: PlayerView, who: string | null) => {
    skew.current = full.public.serverNow - Date.now();
    setSkewState((cur) => (Math.abs(cur - skew.current) > 250 ? skew.current : cur));
    setMe(who);
    setView((cur) => {
      if (cur && cur.public.version > full.public.version) return cur;
      if (!cur || cur.public.version !== full.public.version) lastChange.current = Date.now();
      return full;
    });
  }, []);

  const refresh = useCallback(async () => {
    const token = sessionRef.current?.token ?? null;
    try {
      const res = await api.state(code, token);
      // A response for a different seat than the one we hold now is stale
      // (hydration fires one fetch before the stored seat is known).
      if ((sessionRef.current?.token ?? null) !== token) return;
      acceptFull(res.view, res.me);
      if (token && !res.me) setSession(null);
      setStatus("ready");
    } catch (e) {
      if (e instanceof RequestError && e.status === 404) setStatus("notfound");
    }
  }, [code, acceptFull, setSession]);

  // Initial load (and reload whenever the seat changes).
  useEffect(() => {
    sessionRef.current = session;
    const t = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(t);
  }, [session, refresh]);

  // Realtime subscription + fallback poll + reconnect refresh.
  useEffect(() => {
    const stop = subscribeGame(
      code,
      (pub) => {
        const prev = viewRef.current?.public;
        acceptPublic(pub);
        // A fresh deal is the one private change that comes from someone
        // else's action (the host's): fetch our opening peek right away.
        if (sessionRef.current && prev && (pub.round !== prev.round || (pub.phase === "peek" && prev.phase !== "peek"))) {
          void refresh();
        }
      },
      (s) => {
        setConnection(s);
        if (s === "live") void refresh();
      },
    );
    const poll = setInterval(() => void refresh(), POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop();
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [code, acceptPublic, refresh]);

  const send = useCallback(async (action: Action): Promise<ActionResponse | null> => {
    const s = sessionRef.current;
    if (!s) return null;
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
      acceptFull(res.view, res.me);
      return res;
    } catch (e) {
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
      // A card was still on the table matching the pile when the final turns
      // finished; the grace window for it has now run out with nobody
      // sticking it. Report it so the round closes rather than holding open
      // on an unclaimed match forever.
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
    () => ({ status, view, me, session, connection, busy, toasts, skew: skewState, send, refresh, setSession, toast }),
    [status, view, me, session, connection, busy, toasts, skewState, send, refresh, setSession, toast],
  );
}
