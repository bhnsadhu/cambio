"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useGame } from "@/lib/client/useGame";
import { api, RequestError } from "@/lib/client/api";
import { saveSession, storeName } from "@/lib/client/session";
import { useStoredName } from "@/lib/client/useStoredName";
import { Lobby } from "./Lobby";
import { Table } from "./Table";
import { Button, Chip, Field, inputClass, Wordmark } from "./ui";

export function GameScreen({ code }: { code: string }) {
  const game = useGame(code);
  const view = game.view;

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1480px] px-8">
      <header className="flex h-14 items-center justify-between">
        <div className="flex items-center gap-5">
          <Link href="/" aria-label="Cambio home"><Wordmark /></Link>
          {view ? (
            <div className="flex items-center gap-2 text-[13px] text-ink-2">
              <span className="text-ink-3">Code</span>
              <span className="font-semibold tracking-[0.08em] text-ink">{view.public.code}</span>
              {view.public.round > 0 ? <span className="text-ink-3">· Round {view.public.round}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {game.session ? <span className="text-[13px] text-ink-2">Playing as <span className="font-medium text-ink">{game.session.name}</span></span> : null}
          <Chip tone={game.connection === "live" ? "neutral" : "muted"}>
            <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${game.connection === "live" ? "bg-ink" : "bg-ink-3"}`} />
            {game.connection === "live" ? "Live" : game.connection === "connecting" ? "Connecting" : "Reconnecting"}
          </Chip>
        </div>
      </header>

      {game.status === "notfound" ? (
        <Empty title="No table with that code." body="Check the code with whoever sent it, or start your own table." />
      ) : !view ? (
        <div className="pt-24 text-center text-[14px] text-ink-3">Finding the table…</div>
      ) : !game.session && view.public.phase === "lobby" ? (
        <JoinForm code={code} onJoined={(s) => { game.setSession(s); void game.refresh(); }} />
      ) : view.public.phase === "lobby" ? (
        <Lobby view={view.public} me={game.me} busy={game.busy} onStart={() => void game.send({ type: "start" })} />
      ) : (
        <Table game={game} />
      )}

      <Toasts toasts={game.toasts} />
    </main>
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
      setError(err instanceof RequestError ? err.message : "Could not join right now.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-[420px] pt-24">
      <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-ink-3">Join table</p>
      <h1 className="mt-1 text-[32px] font-semibold tracking-[-0.02em]">{code}</h1>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <Field label="Your name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="What should the table call you?" maxLength={18} autoFocus />
        </Field>
        {error ? <p className="text-[13px] text-red">{error}</p> : null}
        <Button type="submit" variant="primary" size="lg" disabled={busy || !name.trim()}>Take a seat</Button>
      </form>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-[420px] pt-24">
      <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{title}</h1>
      <p className="mt-2 text-[14px] text-ink-2">{body}</p>
      <Link href="/" className="mt-6 inline-block"><Button variant="primary">Back to start</Button></Link>
    </div>
  );
}

function Toasts({ toasts }: { toasts: { id: number; text: string; tone: string }[] }) {
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed right-8 top-16 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={`animate-rise rounded-full px-4 py-2 text-[13px] font-medium shadow-[0_10px_30px_-12px_rgba(0,0,0,0.35)] ${t.tone === "bad" ? "bg-accent text-white" : "bg-ink text-bg"}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
