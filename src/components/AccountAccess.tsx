"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { backLabel } from "@/lib/account/navigation";
import { useAccountReady, useStoredProfile } from "@/lib/client/profile";
import { useStoredName } from "@/lib/client/useStoredName";
import { AuthForm } from "./Account";
import { AppHeader } from "./AppHeader";

export function AccountAccess({ next, initialMode }: { next: string; initialMode: "login" | "register" }) {
  const router = useRouter();
  const ready = useAccountReady();
  const stored = useStoredProfile();
  const [name] = useStoredName();
  useEffect(() => {
    if (ready && stored?.username) router.replace(next);
  }, [ready, stored?.username, next, router]);
  const back = next === "/me" ? "/" : next;
  return (
    <main className="site-shell min-h-screen pb-16">
      <AppHeader active="login" loginNext={next} trailing={<Link href={back} className="t-sub text-ink-2 hover:text-ink">{backLabel(back)}</Link>} />
      <div className="grid items-start gap-12 pt-10 lg:grid-cols-[minmax(0,1fr)_480px] lg:gap-20 lg:py-16">
        <aside className="hidden min-w-0 py-8 lg:block" aria-label="Your Cambio account">
          <p className="t-overline text-accent">Your Cambio account</p>
          <p className="mt-5 max-w-md text-[42px] font-medium leading-[1.1] tracking-tight">Pick up where you left off.</p>
          <p className="t-body mt-5 max-w-md text-ink-2">A familiar seat at every table. Keep your record, find your friends, and make your profile your own.</p>
          <dl className="mt-10 max-w-md divide-y divide-line border-y border-line">
            <div className="py-5"><dt className="font-medium">Your record</dt><dd className="t-sub mt-1 text-ink-2">Track your rounds, points, and progress through the ranks.</dd></div>
            <div className="py-5"><dt className="font-medium">Your friends</dt><dd className="t-sub mt-1 text-ink-2">See who is online and join them at the table.</dd></div>
            <div className="py-5"><dt className="font-medium">Your profile</dt><dd className="t-sub mt-1 text-ink-2">Choose your avatar and the name other players see.</dd></div>
          </dl>
        </aside>
        <div className="mx-auto w-full max-w-[480px] lg:mx-0">
        {!ready || stored?.username ? <p role="status" className="t-sub text-ink-2">{ready ? "Taking you back" : "Checking your account"}</p>
          : <AuthForm key={`${initialMode}:${next}`} initialMode={initialMode} initialName={name} legacy={!!stored} />}
        </div>
      </div>
    </main>
  );
}
