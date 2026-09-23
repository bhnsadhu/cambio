"use client";

import { loginHref } from "@/lib/account/navigation";
import { useAccountReady, useStoredProfile } from "@/lib/client/profile";
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
    {ready && stored ? <>
      <HeaderLink href={`/p/${stored.profile.handle}`} aria-current={active === "profile" ? "page" : undefined}>Your record</HeaderLink>
      <HeaderLink href={accountFrom === "/" ? "/me" : `/me?${new URLSearchParams({ from: accountFrom })}`} aria-label="Account settings" aria-current={active === "account" ? "page" : undefined}>Account</HeaderLink>
    </> : ready ? <HeaderLink href={loginHref(loginNext)} onClick={onLogin} aria-current={active === "login" ? "page" : undefined}>Log in</HeaderLink> : null}
    <HowToPlayButton />
    {back ? <HeaderLink href={back.href}>{back.label}</HeaderLink> : null}
  </HeaderBar>;
}
