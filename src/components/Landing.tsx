"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, RequestError } from "@/lib/client/api";
import { useAccountReady } from "@/lib/client/profile";
import { AuthForm } from "./Account";
import { saveSession, storeName } from "@/lib/client/session";
import { usePresence, useSocial } from "@/lib/client/social";
import { useStoredName } from "@/lib/client/useStoredName";
import { CardBack, FaceCard } from "./cards";
import { FriendsPanel, Notifications } from "./Friends";
import { ProfileBadge, ProfileCard } from "./Profile";
import { Button, Field, inputClass, PlayerName, Wordmark } from "./ui";

export function Landing() {
  const router = useRouter();
  const social = useSocial();
  const accountReady = useAccountReady();
  // Online and free to be asked to a table.
  usePresence(null);
  const [name, setName] = useStoredName();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("create"); setError(null);
    try {
      const seat = await api.create(name);
      storeName(name.trim());
      saveSession(seat.code, { playerId: seat.playerId, token: seat.token, name: name.trim() });
      router.push(`/g/${seat.code}`);
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Could not open a table right now. Try again.");
      setBusy(null);
    }
  };

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("join"); setError(null);
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    try {
      const seat = await api.join(c, name);
      storeName(name.trim());
      saveSession(c, { playerId: seat.playerId, token: seat.token, name: name.trim() });
      router.push(`/g/${c}`);
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Could not join that table. Check the code.");
      setBusy(null);
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1120px] px-8">
      <header className="flex h-14 items-center justify-between">
        <Wordmark />
        <div className="flex items-center gap-3">
          <span className="t-sub text-ink-3">Four seats. One code.</span>
          {social.profile
            ? <ProfileBadge profile={social.profile} />
            : <Link href="/me"><Button variant="ghost" size="sm">Log in or create account</Button></Link>}
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-16 pt-16">
        <div>
          {/* One clean row: same baseline, same size, no tilt, even spacing. */}
          <div className="mb-8 flex items-end gap-3" aria-hidden>
            <CardBack size="md" />
            <CardBack size="md" />
            <FaceCard size="md" card={{ id: "h1", rank: "7", suit: "S" }} />
            <CardBack size="md" />
          </div>
          <h1 className="t-display">
            The memory card game,<br />live with friends.
          </h1>
          <p className="t-body mt-6 max-w-[440px] text-ink-2">
            Cambio is about remembering what you saw and reacting faster than everyone else.
            Open a table, share the five letter code, and the house bots{" "}
            <PlayerName name="Cameron" isBot />, <PlayerName name="Camila" isBot /> and <PlayerName name="Cami" isBot /> fill any empty seats,
            at whatever difficulty you set them.
          </p>

          <dl className="mt-12 grid max-w-[520px] grid-cols-2 gap-x-8 gap-y-6">
            <Rule k="Goal" v="Lowest hand wins. Aces are 1, faces 10, red kings minus 1, black kings and jokers 0." />
            <Rule k="Your turn" v="Draw. Place the card on the pile to use its power, or swap it into any hand at the table, your own or someone else's." />
            <Rule k="Powers" v="7 and 8 peek at yours. 9 and 10 peek at theirs. Jack and queen swap any two cards blind. Black king looks at two, then swaps or not." />
            <Rule k="Sticking" v="When a card lands on the pile, click a matching card from any hand. Miss, and you draw a penalty." />
          </dl>
        </div>

        <div className="flex flex-col gap-4">
          <form onSubmit={create} className="flex flex-col gap-4 rounded-panel bg-surface p-6 hairline">
            <div>
              <h2 className="t-headline">Open a table</h2>
              <p className="t-sub mt-1 text-ink-2">You host. You get a code to share.</p>
            </div>
            <Field label="Display name">
              <input className={inputClass} value={name} readOnly={!!social.profile} onChange={(e) => setName(e.target.value)} placeholder="Your name at the table" maxLength={18} />
            </Field>
            <Button type="submit" variant="primary" size="lg" disabled={!accountReady || busy !== null || !name.trim()}>
              {busy === "create" ? "Opening" : "Open a table"}
            </Button>
          </form>

          <form onSubmit={join} className="flex flex-col gap-4 rounded-panel bg-surface p-6 hairline">
            <div>
              <h2 className="t-headline">Join a table</h2>
              <p className="t-sub mt-1 text-ink-2">Have a code? Take the next open seat.</p>
            </div>
            <div className="grid grid-cols-[132px_1fr] gap-3">
              <Field label="Code">
                <input
                  className={`${inputClass} tnum uppercase tracking-[0.14em]`}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 5))}
                  placeholder="ABCDE"
                  maxLength={5}
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </Field>
              <Field label="Display name">
                <input className={inputClass} value={name} readOnly={!!social.profile} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={18} />
              </Field>
            </div>
            <Button type="submit" variant="secondary" size="lg" disabled={!accountReady || busy !== null || !name.trim() || code.length < 5}>
              {busy === "join" ? "Joining" : "Join"}
            </Button>
          </form>
          {error ? <p className="t-sub px-1 text-accent-ink">{error}</p> : null}
        </div>
      </section>

      {/* Who you are, and who you play with. A profile is optional: the game
          works without one, and remembers nothing. */}
      <section className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-6 pt-20">
        {social.profile ? (
          <>
            <div className="flex flex-col gap-3">
              <ProfileCard profile={social.profile} />
              <Link href="/me" className="t-sub self-start text-ink-3 hover:text-ink">Your full record and friends →</Link>
            </div>
            <FriendsPanel social={social} />
          </>
        ) : (
          <>
            <div>
              <h2 className="t-title2">Keep a record.</h2>
              <p className="t-body mt-2 max-w-[420px] text-ink-2">
                Create an account and every round counts: wins at the top, a rank that climbs with them, your best hand,
                your longest streak. Add friends by handle, see when they are at a table, and take the seat next to them.
              </p>
            </div>
            <AuthForm initialMode="register" initialName={name} />
          </>
        )}
      </section>

      <footer className="t-footnote flex h-24 items-end pb-8 text-ink-3">
        Made for a laptop screen. Real time over Supabase, served by Vercel.
      </footer>
      <Notifications social={social} />
    </main>
  );
}

function Rule({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="t-caption text-ink-3">{k}</dt>
      <dd className="t-sub mt-1 leading-relaxed text-ink-2">{v}</dd>
    </div>
  );
}
