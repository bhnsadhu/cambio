"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { loginHref } from "@/lib/account/navigation";
import { useAccountReady, useStoredProfile } from "@/lib/client/profile";
import { HowToPlayButton } from "./HowToPlayButton";
import { buttonClass, Wordmark } from "./ui";

/** Shared website navigation; table controls remain local to the game. */
export function AppHeader({ active, accountFrom = "/", loginNext = "/", onLogin, trailing }: {
  active?: "tables" | "leaderboard" | "profile" | "account" | "login";
  accountFrom?: string;
  loginNext?: string;
  onLogin?: () => void;
  trailing?: ReactNode;
}) {
  const ready = useAccountReady();
  const stored = useStoredProfile();
  const navClass = "rounded-lg px-3 py-2 text-sm text-ink-2 transition-colors hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-[current=page]:bg-surface-2 aria-[current=page]:text-ink";
  return <header className="flex min-h-20 flex-wrap items-center gap-x-8 gap-y-3 border-b border-line py-4">
    <Link href="/" aria-label="Cambio home" className="shrink-0"><Wordmark /></Link>
    <nav aria-label="Main navigation" className="order-3 flex min-w-0 flex-1 basis-full flex-wrap items-center gap-1 sm:order-none sm:basis-auto">
      <Link href="/" className={navClass} aria-current={active === "tables" ? "page" : undefined}>Tables</Link>
      <Link href="/leaderboard" className={navClass} aria-current={active === "leaderboard" ? "page" : undefined}>Leaderboard</Link>
      {ready && stored ? <>
        <Link href={`/p/${stored.profile.handle}`} className={navClass} aria-current={active === "profile" ? "page" : undefined}>Your record</Link>
        <Link href={accountFrom === "/" ? "/me" : `/me?${new URLSearchParams({ from: accountFrom })}`} aria-label="Account settings" aria-current={active === "account" ? "page" : undefined} className={`${navClass} sm:ml-auto`}>Account</Link>
      </> : ready ? <Link href={loginHref(loginNext)} onClick={onLogin} aria-current={active === "login" ? "page" : undefined} className={buttonClass({ size: "sm", className: "ml-auto" })}>Log in</Link> : null}
    </nav>
    <div className="ml-auto flex max-w-full flex-wrap items-center gap-3 sm:ml-0">
      <HowToPlayButton />
      {trailing}
    </div>
  </header>;
}
