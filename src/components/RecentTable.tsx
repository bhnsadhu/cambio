"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, RequestError } from "@/lib/client/api";
import { profileGeneration, useAccountReady, useStoredProfile } from "@/lib/client/profile";
import { forgetRecentTable, loadSession, recentTable, subscribeRecentTable } from "@/lib/client/session";
import { buttonClass } from "./ui";

/** A short-lived way back to one table, verified against its current seats. */
export function RecentTable() {
  const ready = useAccountReady();
  const account = useStoredProfile();
  const [table, setTable] = useState<{ code: string; detail: string } | null>(null);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    let sequence = 0;
    const refresh = async () => {
      const request = ++sequence;
      const recent = recentTable();
      const generation = profileGeneration();
      if (!recent) { setTable(null); return; }
      const current = () => active && request === sequence && generation === profileGeneration()
        && recentTable()?.code === recent.code;
      try {
        const result = await api.state(recent.code, loadSession(recent.code)?.token ?? null);
        if (!current()) return;
        const view = result.view.public;
        const humans = view.players.filter((player) => !player.isBot);
        const seated = humans.some((player) => player.id === result.me);
        const canReturn = humans.length > 0 && (seated || (view.phase === "lobby" && humans.length < 4));
        setTable(canReturn ? {
          code: recent.code,
          detail: view.phase === "lobby" ? "Waiting for players" : view.phase === "scoring" ? "Between rounds" : "Round in progress",
        } : null);
        if (!humans.length) forgetRecentTable(recent.code);
      } catch (error) {
        if (!current()) return;
        setTable(null);
        if (error instanceof RequestError && error.status === 404) forgetRecentTable(recent.code);
      }
    };
    const update = () => { void refresh(); };
    update();
    const unsubscribe = subscribeRecentTable(update);
    const timer = window.setInterval(update, 5000);
    window.addEventListener("focus", update);
    return () => { active = false; unsubscribe(); window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, [ready, account?.token]);

  if (!ready || !table) return null;
  return (
    <section aria-label="Recent table" className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-panel bg-surface px-5 py-4 hairline sm:px-6">
      <div className="min-w-0">
        <h2 className="t-headline">Back to your table</h2>
        <p className="t-sub mt-1 text-ink-2"><span className="tnum tracking-[0.1em] text-ink">{table.code}</span><span className="mx-2 text-ink-3" aria-hidden>·</span>{table.detail}</p>
      </div>
      <Link href={`/g/${table.code}`} className={buttonClass({ variant: "secondary", size: "sm" })}>Return to table</Link>
    </section>
  );
}
