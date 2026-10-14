"use client";

import { loginHref } from "@/lib/account/navigation";
import { useAccountReady, useStoredProfile } from "@/lib/client/profile";
import { REPO_URL } from "@/lib/site";
import { HowToPlayButton } from "./HowToPlayButton";
import { HeaderBar, HeaderLink } from "./Header";

/** Shared website navigation; table controls remain local to the game. */
export function AppHeader({ active, accountFrom = "/", loginNext = "/", onLogin, back }: {
  active?: "tables" | "leaderboard" | "profile" | "account" | "login";
  accountFrom?: string;
  loginNext?: string;
  onLogin?: () => void;
  back?: { href: string; label: string };
}) {
  const ready = useAccountReady();
  const stored = useStoredProfile();
  return <HeaderBar label="Main navigation">
    <HeaderLink href="/" aria-current={active === "tables" ? "page" : undefined}>Tables</HeaderLink>
    <HeaderLink href="/leaderboard" aria-current={active === "leaderboard" ? "page" : undefined}>Leaderboard</HeaderLink>
    {/* A saved account shows its links at once; the check that follows only confirms them. */}
    {stored ? <>
      <HeaderLink href={`/p/${stored.profile.handle}`} aria-current={active === "profile" ? "page" : undefined}>Your record</HeaderLink>
      <HeaderLink href={accountFrom === "/" ? "/me" : `/me?${new URLSearchParams({ from: accountFrom })}`} aria-label="Account settings" aria-current={active === "account" ? "page" : undefined}>Account</HeaderLink>
    </> : ready ? <HeaderLink href={loginHref(loginNext)} onClick={onLogin} aria-current={active === "login" ? "page" : undefined}>Log in</HeaderLink> : null}
    <HowToPlayButton />
    <HeaderLink href={REPO_URL} target="_blank" rel="noreferrer">
      Repository
      <svg aria-hidden viewBox="0 0 12 12" className="h-3 w-3 opacity-60" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2h6v6M10 2 3 9" /></svg>
    </HeaderLink>
    {back ? <HeaderLink href={back.href}>{back.label}</HeaderLink> : null}
  </HeaderBar>;
}
