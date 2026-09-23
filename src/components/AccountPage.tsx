"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { backLabel, loginHref } from "@/lib/account/navigation";
import { refreshProfile, useAccountReady, useStoredProfile } from "@/lib/client/profile";
import { AccountSettings } from "./Account";
import { AppHeader } from "./AppHeader";

export function AccountPage({ back }: { back: string }) {
  const router = useRouter();
  const stored = useStoredProfile();
  const ready = useAccountReady();
  const exited = useRef(false);
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
    <main className="site-shell min-h-screen pb-16">
      <AppHeader active="account" trailing={<Link href={destination} className="t-sub text-ink-2 hover:text-ink">{backLabel(destination)}</Link>} />
      <div className="pt-8 lg:pt-12">
        {!ready || !stored?.username ? <p role="status" className="t-sub text-ink-2">Checking your account</p> : <>
          <div className="mb-8"><h1 className="t-title">Account settings</h1><p className="t-body mt-3 text-ink-2">Manage your player profile and account access.</p></div>
          <AccountSettings key={stored.profile.id} stored={stored} onExit={exit} />
        </>}
      </div>
    </main>
  );
}
