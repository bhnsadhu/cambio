"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, RequestError } from "@/lib/client/api";
import { lastName, rememberName, saveSession } from "@/lib/client/session";
import { Button, Field, inputClass, PlayerName, Wordmark } from "./ui";

export function Landing() {
  const router = useRouter();
  const [name, setName] = useState(() => (typeof window === "undefined" ? "" : lastName()));
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("create"); setError(null);
    try {
      const seat = await api.create(name);
      rememberName(name.trim());
      saveSession(seat.code, { playerId: seat.playerId, token: seat.token, name: name.trim() });
      router.push(`/g/${seat.code}`);
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Could not open a table right now.");
      setBusy(null);
    }
  };

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("join"); setError(null);
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    try {
      const seat = await api.join(c, name);
      rememberName(name.trim());
      saveSession(c, { playerId: seat.playerId, token: seat.token, name: name.trim() });
      router.push(`/g/${c}`);
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Could not join that table.");
      setBusy(null);
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1120px] px-8">
      <header className="flex h-14 items-center justify-between">
        <Wordmark />
        <span className="text-[13px] text-ink-3">Four seats. One code. No accounts.</span>
      </header>

      <section className="grid grid-cols-[1.1fr_1fr] gap-16 pt-20">
        <div>
          <h1 className="text-[52px] font-semibold leading-[1.02] tracking-[-0.03em]">
            The memory card game,<br />live with friends.
          </h1>
          <p className="mt-6 max-w-[440px] text-[16px] leading-relaxed text-ink-2">
            Cambio is a game of remembering what you saw and reacting faster than everyone else.
            Open a table, share the five-letter code, and empty seats are filled by the house bots
            {" "}<PlayerName name="Camryn" isBot />, <PlayerName name="Camron" isBot /> and <PlayerName name="Cami" isBot />.
          </p>

          <dl className="mt-12 grid max-w-[520px] grid-cols-2 gap-x-8 gap-y-6 text-[13.5px]">
            <Rule k="Goal" v="Lowest hand wins. Aces are 1, faces 10, red kings −1, black kings and jokers 0." />
            <Rule k="Your turn" v="Draw. Place the card on the pile to fire its power, or swap it into your hand." />
            <Rule k="Powers" v="7/8 peek at yours · 9/10 peek at theirs · J/Q blind swap · black K look at two, maybe swap." />
            <Rule k="Sticking" v="Any time a card lands on the pile, slap a matching card from any hand. Miss and you draw a penalty." />
          </dl>
        </div>

        <div className="flex flex-col gap-4">
          <form onSubmit={create} className="flex flex-col gap-4 rounded-panel bg-surface p-6 hairline">
            <div>
              <h2 className="text-[18px] font-semibold tracking-[-0.01em]">Open a table</h2>
              <p className="mt-1 text-[13.5px] text-ink-2">You host. You get a code to share.</p>
            </div>
            <Field label="Your name">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name at the table" maxLength={18} />
            </Field>
            <Button type="submit" variant="primary" size="lg" disabled={busy !== null || !name.trim()}>
              {busy === "create" ? "Opening…" : "Open a table"}
            </Button>
          </form>

          <form onSubmit={join} className="flex flex-col gap-4 rounded-panel bg-surface p-6 hairline">
            <div>
              <h2 className="text-[18px] font-semibold tracking-[-0.01em]">Join a table</h2>
              <p className="mt-1 text-[13.5px] text-ink-2">Got a code? Take the next open seat.</p>
            </div>
            <div className="grid grid-cols-[132px_1fr] gap-3">
              <Field label="Code">
                <input
                  className={`${inputClass} uppercase tracking-[0.14em]`}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 5))}
                  placeholder="ABCDE"
                  maxLength={5}
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </Field>
              <Field label="Your name">
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={18} />
              </Field>
            </div>
            <Button type="submit" variant="secondary" size="lg" disabled={busy !== null || !name.trim() || code.length < 5}>
              {busy === "join" ? "Joining…" : "Join"}
            </Button>
          </form>
          {error ? <p className="px-1 text-[13px] text-red">{error}</p> : null}
        </div>
      </section>

      <footer className="flex h-24 items-end pb-8 text-[12.5px] text-ink-3">
        Built for a laptop screen. Real time over Supabase, served by Vercel.
      </footer>
    </main>
  );
}

function Rule({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[12px] font-medium uppercase tracking-[0.1em] text-ink-3">{k}</dt>
      <dd className="mt-1 leading-relaxed text-ink-2">{v}</dd>
    </div>
  );
}
