"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { loginHref } from "@/lib/account/navigation";
import { avatarIndex } from "@/lib/avatars";
import { api, RequestError } from "@/lib/client/api";
import { useAccountReady } from "@/lib/client/profile";
import { saveSession, storeName } from "@/lib/client/session";
import { useSocial } from "@/lib/client/social";
import { useStoredName } from "@/lib/client/useStoredName";
import { storeGuestIdentity, useGuestIdentity } from "@/lib/client/guest";
import { CardBack, FaceCard } from "./cards";
import { FriendsPanel, Notifications } from "./Friends";
import { AppHeader } from "./AppHeader";
import { RecentTable } from "./RecentTable";
import { GuestSetup } from "./GuestPlayer";
import { Button, Field, inputClass, PlayerName } from "./ui";

export function Landing() {
  const router = useRouter();
  const social = useSocial();
  const accountReady = useAccountReady();
  const [name, setName] = useStoredName("Guest");
  const guest = useGuestIdentity();
  const guestAvatarId = avatarIndex(name || "Guest", guest?.avatarId);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<{ mode: "create" | "join"; message: string } | null>(null);
  const profile = social.profile;
  const next = code.length === 5 ? `/g/${code}` : "/";
  const rememberGuest = () => { if (!profile) storeGuestIdentity({ name: name.trim(), avatarId: guestAvatarId }); };

  const submit = async (event: FormEvent, mode: "create" | "join") => {
    event.preventDefault();
    if (busy) return;
    setBusy(mode); setError(null);
    try {
      const seat = mode === "create" ? await api.create(name, guestAvatarId) : await api.join(code, name, guestAvatarId);
      if (profile) storeName(name.trim()); else rememberGuest();
      saveSession(seat.code, { playerId: seat.playerId, token: seat.token, name: name.trim() });
      router.push(`/g/${seat.code}`);
    } catch (error) {
      const fallback = mode === "create" ? "Could not open a table right now. Try again." : "Could not join that table. Check the code.";
      setError({ mode, message: error instanceof RequestError ? error.message : fallback });
      setBusy(null);
    }
  };

  const play = (
    <section className={profile ? "grid min-w-0 gap-5 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2" : "flex min-w-0 flex-col gap-4"} aria-label="Play Cambio">
      {!accountReady ? <p role="status" className="t-sub text-ink-2">Checking your account</p>
        : profile ? null
          : <GuestSetup name={name} onNameChange={setName} disabled={!!busy} next={next} />}
      <form onSubmit={(event) => void submit(event, "create")} className="flex min-w-0 flex-col gap-4 rounded-panel bg-surface p-5 hairline sm:p-6" aria-label="New table">
        <div>
          <h2 className="t-headline">New table</h2>
          <p className="t-sub mt-2 text-ink-2">Host a game with friends, or try a round with the house bots.</p>
        </div>
        {profile ? <p className="t-sub break-words text-ink-2">Playing as <strong className="text-ink">{name}</strong></p> : null}
        {error?.mode === "create" ? <p role="alert" className="t-sub text-red">{error.message}</p> : null}
        <Button type="submit" variant="primary" className="mt-auto sm:self-start" disabled={!accountReady || !!busy || !name.trim()}>
          {busy === "create" ? "Opening" : "Open a table"}
        </Button>
      </form>
      <form onSubmit={(event) => void submit(event, "join")} className="flex min-w-0 flex-col gap-4 rounded-panel bg-surface p-5 hairline sm:p-6" aria-label="Join with code">
        <div>
          <h2 className="t-headline">Join with code</h2>
          <p className="t-sub mt-2 text-ink-2">Enter the five character code your friend shared.</p>
        </div>
        <Field label="Table code">
          <input className={`${inputClass} tnum tracking-[0.14em]`} value={code} onChange={(event) => { setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5)); setError(null); }} placeholder="ABCDE" minLength={5} maxLength={5} autoCapitalize="characters" spellCheck={false} autoComplete="off" required disabled={!!busy} />
        </Field>
        {error?.mode === "join" ? <p role="alert" className="t-sub text-red">{error.message}</p> : null}
        <Button type="submit" variant="secondary" className="mt-auto sm:self-start" disabled={!accountReady || !!busy || !name.trim() || code.length !== 5}>
          {busy === "join" ? "Joining" : "Join table"}
        </Button>
      </form>
      {accountReady && !profile ? <p className="t-sub text-ink-2">No account needed to play. <Link href={loginHref(next, "register")} onClick={rememberGuest} className="font-medium text-ink hover:text-ink-2">Create an account to keep your profile and stats</Link></p> : null}
    </section>
  );

  return (
    <main className="site-shell">
      <AppHeader active="tables" loginNext={next} onLogin={rememberGuest} />
      <RecentTable />
      {profile ? <>
        <header className="pt-10 pb-7"><h1 className="t-title">Ready for a round?</h1><p className="t-body mt-2 text-ink-2">Open a table, share the code, and invite your friends.</p></header>
        <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_300px] lg:grid-cols-[minmax(0,1fr)_340px] xl:gap-8">
          {play}
          <FriendsPanel social={social} />
        </div>
      </> : <section className="grid items-start gap-10 pt-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:pt-16">
        <div>
          {/* One clean row: same baseline, same size, no tilt, even spacing. */}
          <div className="mb-8 flex items-end gap-3" aria-hidden>
            <CardBack size="md" />
            <CardBack size="md" />
            <FaceCard size="md" card={{ id: "h1", rank: "7", suit: "S" }} />
            <CardBack size="md" />
          </div>
          <h1 className="t-display">The memory card game,<br />live with friends.</h1>
          <p className="t-body mt-5 max-w-[440px] text-ink-2">
            Remember your cards. Finish with the lowest hand. Play with friends, or let the house bots{" "}
            <PlayerName name="Cameron" isBot />, <PlayerName name="Camila" isBot /> and <PlayerName name="Cami" isBot /> take the empty seats.
          </p>
        </div>
        {play}
      </section>}
      <Notifications social={social} />
    </main>
  );
}
