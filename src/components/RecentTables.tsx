"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, RequestError } from "@/lib/client/api";
import { profileGeneration, useAccountReady, useStoredProfile } from "@/lib/client/profile";
import { clearSession, recentSessions, subscribeSession } from "@/lib/client/session";
import { Button, buttonClass } from "./ui";

type Table = { code: string; round: number; phase: string };

/** Navigating away keeps your seat; explicitly leaving removes it from here. */
export function RecentTables() {
  const ready = useAccountReady();
  const identity = useStoredProfile()?.token ?? "guest";
  const [state, setState] = useState<{ identity: string; tables: Table[]; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    let revision = 0;
    const load = async () => {
      const request = ++revision;
      const generation = profileGeneration();
      const saved = recentSessions();
      const results = await Promise.allSettled(saved.map(async ({ code, session }) => {
        try {
          const { view, me } = await api.state(code, session.token);
          return me ? { code, round: view.public.round, phase: view.public.phase } : null;
        } catch (error) {
          if (error instanceof RequestError && error.status === 404) return null;
          throw error;
        }
      }));
      if (!active || request !== revision || generation !== profileGeneration()) return;
      results.forEach((result, index) => {
        if (result.status === "fulfilled" && result.value === null) clearSession(saved[index].code);
      });
      setState({ identity, tables: results.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []), failed: results.some((result) => result.status === "rejected") });
    };
    const refresh = () => { void load(); };
    const timer = window.setTimeout(refresh, 0);
    const unsubscribe = subscribeSession(refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => { active = false; clearTimeout(timer); unsubscribe(); window.removeEventListener("storage", refresh); window.removeEventListener("focus", refresh); };
  }, [ready, identity, attempt]);
  if (!state || state.identity !== identity || (!state.tables.length && !state.failed)) return null;
  return <section aria-label="Your tables" className="mb-7 rounded-panel border border-line-strong px-5 py-4 sm:px-6">
    <h2 className="t-headline mb-3">Your tables</h2>
    <ul className="divide-y divide-line">
      {state.tables.map((table) => <li key={table.code} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div><p className="t-body font-medium">Table <span className="tnum tracking-wider">{table.code}</span></p><p className="t-sub mt-1 text-ink-3">{table.phase === "lobby" ? "Waiting for players" : table.phase === "scoring" ? `Round ${table.round} results` : `Round ${table.round} in progress`}</p></div>
        <Link href={`/g/${table.code}`} className={buttonClass({ size: "sm" })} aria-label={`Return to table ${table.code}`}>Return to table</Link>
      </li>)}
    </ul>
    {state.failed ? <div className="flex flex-wrap items-center gap-3"><p role="status" className="t-sub text-ink-2">Some saved tables could not be checked.</p><Button size="sm" variant="ghost" onClick={() => setAttempt((value) => value + 1)}>Try again</Button></div> : null}
  </section>;
}
