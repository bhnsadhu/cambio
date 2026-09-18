"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useGame } from "@/lib/client/useGame";
import { api, RequestError } from "@/lib/client/api";
import { saveSession, storeName } from "@/lib/client/session";
import { useStoredName } from "@/lib/client/useStoredName";
import { PositionsProvider } from "@/lib/client/positions";
import { setPref, usePrefs } from "@/lib/client/prefs";
import { Lobby } from "./Lobby";
import { Table } from "./Table";
import { Explainer } from "./Explainer";
import { HowToPlay } from "./HowToPlay";
import { Button, Chip, DotOff, Field, inputClass, Pip, Wordmark } from "./ui";

export function GameScreen({ code }: { code: string }) {
  const game = useGame(code);
  const prefs = usePrefs();
  const router = useRouter();
  const view = game.view;
  const [help, setHelp] = useState(false);
  const [replay, setReplay] = useState(false);
  const [watching, setWatching] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(() => setLeaving(false), 4000);
    return () => window.clearTimeout(id);
  }, [leaving]);
  const leave = () => {
    game.setSession(null);
    router.push("/");
  };

  const seated = !!game.session;
  const showExplainer = replay || (seated && !!view && prefs.onboarded !== true);
  const closeExplainer = useCallback(() => { setPref("onboarded", true); setReplay(false); }, []);

  let body: React.ReactNode;
  if (game.status === "notfound") {
    body = <Empty title="No table with that code." body="Check the code with whoever sent it, or open a table of your own." />;
  } else if (!view) {
    body = <TableSkeleton />;
  } else if (!seated && view.public.phase === "lobby") {
    body = <JoinForm code={code} onJoined={(s) => { game.setSession(s); void game.refresh(); }} />;
  } else if (!seated && !watching) {
    body = <MidRound code={code} onWatch={() => setWatching(true)} />;
  } else if (view.public.phase === "lobby") {
    body = <Lobby view={view.public} me={game.me} busy={game.busy} onStart={() => void game.send({ type: "start" })} />;
  } else {
    body = <Table game={game} />;
  }

  return (
    <PositionsProvider>
      <main className="mx-auto min-h-screen w-full max-w-[1480px] px-8">
        <header className="flex h-14 items-center justify-between">
          <div className="flex items-center gap-5">
            <Link href="/" aria-label="Cambio home"><Wordmark /></Link>
            {view ? (
              <div className="t-sub flex items-center gap-2 text-ink-2">
                <span className="text-ink-3">Code</span>
                <span className="tnum font-semibold tracking-[0.08em] text-ink">{view.public.code}</span>
                {view.public.round > 0 ? <span className="text-ink-3">· Round {view.public.round}</span> : null}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            {game.session ? <span className="t-sub text-ink-2">Playing as <span className="font-medium text-ink">{game.session.name}</span></span> : null}
            <Button variant="ghost" size="sm" onClick={() => setHelp(true)}>How to play</Button>
            {game.session ? (
              leaving ? (
                <span className="flex items-center gap-1.5">
                  <span className="t-sub text-ink-2">Leave this table?</span>
                  <Button variant="secondary" size="sm" onClick={leave}>Leave</Button>
                  <Button variant="ghost" size="sm" onClick={() => setLeaving(false)}>Stay</Button>
                </span>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setLeaving(true)}>Leave</Button>
              )
            ) : (
              <Link href="/"><Button variant="ghost" size="sm">Home</Button></Link>
            )}
            <Chip tone="neutral">
              {game.connection === "live" ? <Pip /> : <DotOff />}
              {game.connection === "live" ? "Live" : game.connection === "connecting" ? "Connecting" : "Reconnecting"}
            </Chip>
          </div>
        </header>

        {body}

        <Toasts toasts={game.toasts} />
        {showExplainer ? <Explainer onDone={closeExplainer} /> : null}
        <HowToPlay open={help} onClose={() => setHelp(false)} onReplay={() => { setHelp(false); setReplay(true); }} />
      </main>
    </PositionsProvider>
  );
}

function JoinForm({ code, onJoined }: { code: string; onJoined: (s: { playerId: string; token: string; name: string }) => void }) {
  const [name, setName] = useStoredName();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const seat = await api.join(code, name);
      storeName(name.trim());
      const s = { playerId: seat.playerId, token: seat.token, name: name.trim() };
      saveSession(code, s);
      onJoined(s);
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Could not join right now. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-[420px] pt-24 animate-rise">
      <p className="t-caption text-ink-3">Join table</p>
      <h1 className="t-title tnum mt-1.5 tracking-[0.06em]">{code}</h1>
      <p className="t-body mt-2 text-ink-2">Pick a name. You take the next open seat.</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <Field label="Your name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="What the table calls you" maxLength={18} autoFocus />
        </Field>
        {error ? <p className="t-sub text-accent-ink">{error}</p> : null}
        <Button type="submit" variant="primary" size="lg" disabled={busy || !name.trim()}>{busy ? "Taking a seat" : "Take a seat"}</Button>
      </form>
    </div>
  );
}

function MidRound({ code, onWatch }: { code: string; onWatch: () => void }) {
  return (
    <div className="mx-auto max-w-[460px] pt-24 animate-rise">
      <p className="t-caption text-ink-3">Table {code}</p>
      <h1 className="t-title mt-1.5">This table is mid round.</h1>
      <p className="t-body mt-2 text-ink-2">Seats are set once a round starts. You can watch this one, or open a table of your own.</p>
      <div className="mt-6 flex gap-3">
        <Button variant="primary" size="lg" onClick={onWatch}>Watch</Button>
        <Link href="/"><Button variant="secondary" size="lg">Open a table</Button></Link>
      </div>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-[420px] pt-24 animate-rise">
      <h1 className="t-title">{title}</h1>
      <p className="t-body mt-2 text-ink-2">{body}</p>
      <Link href="/" className="mt-6 inline-block"><Button variant="primary">Back to start</Button></Link>
    </div>
  );
}

/** The table's shape while the first state arrives, so nothing jumps. */
function TableSkeleton() {
  return (
    <div className="grid h-[calc(100vh-56px)] grid-cols-[minmax(0,1fr)_240px] gap-5 pb-6" aria-busy aria-label="Finding the table">
      <div className="flex min-h-0 flex-col gap-5">
        <div className="grid grid-cols-[repeat(4,minmax(0,1fr))_auto] gap-4">
          {[0, 1, 2, 3].map((k) => (
            <div key={k} className="flex flex-col gap-4 rounded-panel bg-surface px-4 pt-4 pb-5 hairline">
              <div className="space-y-2">
                <div className="skeleton h-4 w-24 rounded-md" />
                <div className="skeleton h-3 w-14 rounded-md" />
              </div>
              <div className="grid grid-cols-2 gap-3 justify-items-center">
                {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[var(--tile-h)] w-[var(--tile-w)] rounded-[var(--tile-r)]" />)}
              </div>
              <div className="skeleton h-3 w-12 rounded-md" />
            </div>
          ))}
          <div className="flex flex-col gap-4 rounded-panel bg-surface px-4 pt-4 pb-5 hairline">
            <div className="skeleton h-4 w-14 rounded-md" />
            <div className="flex gap-4">
              <div className="skeleton h-[var(--tile-h)] w-[var(--tile-w)] rounded-[var(--tile-r)]" />
              <div className="skeleton h-[var(--tile-h)] w-[var(--tile-w)] rounded-[var(--tile-r)]" />
            </div>
          </div>
        </div>
        <div className="mt-auto flex min-h-[92px] items-center rounded-panel bg-surface px-6 hairline">
          <div className="space-y-2">
            <div className="skeleton h-4 w-40 rounded-md" />
            <div className="skeleton h-3 w-64 rounded-md" />
          </div>
        </div>
      </div>
      <div className="rounded-panel bg-surface px-5 pt-4 hairline">
        <div className="skeleton h-4 w-20 rounded-md" />
        <p className="t-sub mt-4 inline-flex items-center gap-2 text-ink-3"><Pip />Finding the table</p>
      </div>
    </div>
  );
}

function Toasts({ toasts }: { toasts: { id: number; text: string; tone: string }[] }) {
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed right-8 top-16 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={`animate-rise rounded-full px-4 py-2 text-[13px] font-medium shadow-float ${t.tone === "bad" ? "bg-surface-2 text-ink hairline-strong" : "bg-ink text-bg"}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
