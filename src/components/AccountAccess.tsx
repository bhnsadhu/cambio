"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { backLabel } from "@/lib/account/navigation";
import { useAccountReady, useStoredProfile } from "@/lib/client/profile";
import { useStoredName } from "@/lib/client/useStoredName";
import { AuthForm } from "./Account";
import { Wordmark } from "./ui";

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
    <main className="mx-auto min-h-screen w-full max-w-[1080px] px-5 pb-16 sm:px-8">
      <header className="flex h-16 items-center justify-between gap-3">
        <Link href="/" aria-label="Cambio home"><Wordmark /></Link>
        <Link href={back} className="t-sub text-ink-2 hover:text-ink">{backLabel(back)}</Link>
      </header>
      <div className="mx-auto max-w-[460px] pt-10">
        {!ready || stored?.username ? <p role="status" className="t-sub text-ink-2">{ready ? "Taking you back" : "Checking your account"}</p>
          : <AuthForm key={`${initialMode}:${next}`} initialMode={initialMode} initialName={name} legacy={!!stored} />}
      </div>
    </main>
  );
}
