"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { backLabel, loginHref } from "@/lib/account/navigation";
import { refreshProfile, useAccountReady, useStoredProfile } from "@/lib/client/profile";
import { usePresence } from "@/lib/client/social";
import { AccountSettings } from "./Account";
import { Wordmark } from "./ui";

export function AccountPage({ back }: { back: string }) {
  const router = useRouter();
  const stored = useStoredProfile();
  const ready = useAccountReady();
  const exited = useRef(false);
  usePresence(null);
  useEffect(() => {
    if (ready && !stored?.username && !exited.current) router.replace(loginHref("/me"));
  }, [ready, stored?.username, router]);
  useEffect(() => {
    if (!stored?.username) return;
    const timer = window.setInterval(() => { void refreshProfile().catch(() => {}); }, 10_000);
    return () => window.clearInterval(timer);
  }, [stored?.username]);
  const exit = () => { exited.current = true; router.replace("/"); };
  // Returning to your own record follows a username change made here.
  const destination = back === "record" ? stored ? `/p/${stored.profile.handle}` : "/" : back === "/me" ? "/" : back;
  return (
    <main className="mx-auto min-h-screen w-full max-w-[1080px] px-5 pb-16 sm:px-8">
      <header className="flex h-16 items-center justify-between gap-3">
        <Link href="/" aria-label="Cambio home"><Wordmark /></Link>
        <Link href={destination} className="t-sub text-ink-2 hover:text-ink">{backLabel(destination)}</Link>
      </header>
      <div className="mx-auto max-w-[560px] pt-8">
        {!ready || !stored?.username ? <p role="status" className="t-sub text-ink-2">Checking your account</p> : <>
          <h1 className="t-title mb-6">Account settings</h1>
          <AccountSettings key={stored.profile.id} stored={stored} onExit={exit} />
        </>}
      </div>
    </main>
  );
}
