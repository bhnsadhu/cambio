"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { loginHref } from "@/lib/account/navigation";
import { api, RequestError } from "@/lib/client/api";
import { dismissAccountNotice, useAccountNotice, useAccountReady } from "@/lib/client/profile";
import { setPref } from "@/lib/client/prefs";
import { saveSession, storeName } from "@/lib/client/session";
import { usePresence, useSocial } from "@/lib/client/social";
import { useStoredName } from "@/lib/client/useStoredName";
import { CardBack, FaceCard } from "./cards";
import { Explainer } from "./Explainer";
import { FriendsPanel, Notifications } from "./Friends";
import { HowToPlay } from "./HowToPlay";
import { AccountLink } from "./Profile";
import { Button, Field, inputClass, Wordmark } from "./ui";

export function Landing() {
  const router = useRouter();
  const social = useSocial();
  const accountReady = useAccountReady();
  const notice = useAccountNotice();
  usePresence(null);
  const [name, setName] = useStoredName();
  const [mode, setMode] = useState<"create" | "join">("create");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [walkthrough, setWalkthrough] = useState(false);
  const profile = social.profile;
  const next = mode === "join" && code.length === 5 ? `/g/${code}` : "/";
  const rememberGuest = () => storeName(name.trim());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const seat = mode === "create" ? await api.create(name) : await api.join(code, name);
      storeName(name.trim());
      saveSession(seat.code, { playerId: seat.playerId, token: seat.token, name: name.trim() });
      router.push(`/g/${seat.code}`);
    } catch (error) {
      setError(error instanceof RequestError ? error.message : "Could not reach the table. Try again.");
      setBusy(false);
    }
  };

  const play = (
    <section className="rounded-panel bg-surface p-6 hairline" aria-label="Play Cambio">
      <h2 className="t-headline">Choose a table</h2>
      <div className="mt-4 flex gap-2" role="group" aria-label="Table options">
        <Button type="button" size="sm" variant={mode === "create" ? "primary" : "ghost"} aria-pressed={mode === "create"} disabled={busy} onClick={() => { setMode("create"); setError(null); }}>New table</Button>
        <Button type="button" size="sm" variant={mode === "join" ? "primary" : "ghost"} aria-pressed={mode === "join"} disabled={busy} onClick={() => { setMode("join"); setError(null); }}>Join with code</Button>
      </div>
      <p className="t-sub mt-4 text-ink-2">{mode === "create" ? "You host and get a code to share. House bots fill empty seats." : "Enter the five letter code your friend shared."}</p>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4" aria-label="Table setup">
        {mode === "join" ? <Field label="Table code">
          <input className={`${inputClass} tnum tracking-[0.14em]`} value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))} placeholder="ABCDE" minLength={5} maxLength={5} autoCapitalize="characters" spellCheck={false} autoComplete="off" required disabled={busy} />
        </Field> : null}
        {!accountReady ? <p role="status" className="t-sub text-ink-2">Checking your account...</p>
          : profile ? <p className="t-body text-ink-2">Playing as <strong className="text-ink">{name}</strong></p>
            : <Field label="Display name"><input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name at the table" maxLength={18} autoComplete="nickname" required disabled={busy} /></Field>}
        {error ? <p role="alert" className="t-sub text-red">{error}</p> : null}
        <Button type="submit" variant="primary" size="lg" disabled={!accountReady || busy || !name.trim() || (mode === "join" && code.length !== 5)}>
          {busy ? mode === "create" ? "Opening" : "Joining" : mode === "create" ? "Open a table" : "Join table"}
        </Button>
      </form>
      {accountReady && !profile ? <p className="t-sub mt-5 text-ink-2">Playing as a guest. <Link href={loginHref(next, "register")} onClick={rememberGuest} className="font-medium text-ink hover:text-ink-2">Create an account to save your stats</Link></p> : null}
    </section>
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1080px] px-5 pb-16 sm:px-8">
      <header className="flex h-16 items-center justify-between gap-3">
        <Wordmark />
        <nav className="flex items-center gap-4" aria-label="Main navigation">
          {accountReady ? profile ? <>
            <Link href={`/p/${profile.handle}`} className="t-sub text-ink-2 hover:text-ink">Your record</Link>
            <AccountLink />
          </> : <Link href={loginHref(next)} onClick={rememberGuest} className="t-sub text-ink-2 hover:text-ink">Log in</Link> : null}
        </nav>
      </header>
      {notice ? <div className="mt-4 flex items-center justify-between gap-4 rounded-panel bg-accent-soft p-4">
        <p role="status" className="t-sub text-accent">{notice}</p>
        <Button type="button" variant="ghost" size="sm" aria-label="Dismiss message" onClick={dismissAccountNotice}>Dismiss</Button>
      </div> : null}
      {profile ? <>
        <header className="pt-10 pb-7"><h1 className="t-title">Ready for a round?</h1></header>
        <div className="grid items-start gap-6 md:grid-cols-2">
          {play}
          <FriendsPanel social={social} />
        </div>
        <Button className="mt-5" variant="ghost" onClick={() => setWalkthrough(true)}>How to play</Button>
      </> : <section className="grid items-start gap-10 pt-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:pt-16">
        <div>
          <div className="mb-8 flex items-end gap-3" aria-hidden>
            <CardBack size="md" /><CardBack size="md" /><FaceCard size="md" card={{ id: "h1", rank: "7", suit: "S" }} /><CardBack size="md" />
          </div>
          <h1 className="t-display">The memory card game,<br />live with friends.</h1>
          <p className="t-body mt-5 max-w-[420px] text-ink-2">Remember your cards. Finish with the lowest hand. Play with friends or try a round with the house bots.</p>
          <Button className="mt-5" variant="secondary" onClick={() => setWalkthrough(true)}>How to play</Button>
        </div>
        {play}
      </section>}
      <Notifications social={social} />
      <HowToPlay open={help} onClose={() => setHelp(false)} onReplay={() => { setHelp(false); setWalkthrough(true); }} />
      {walkthrough ? <Explainer onDone={() => { setPref("onboarded", true); setWalkthrough(false); }} onRules={() => { setPref("onboarded", true); setWalkthrough(false); setHelp(true); }} /> : null}
    </main>
  );
}
