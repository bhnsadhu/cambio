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
  return <HeaderBar label="Main navigation" edge={<RepositoryLink />}>
    <HeaderLink href="/" aria-current={active === "tables" ? "page" : undefined}>Tables</HeaderLink>
    <HeaderLink href="/leaderboard" aria-current={active === "leaderboard" ? "page" : undefined}>Leaderboard</HeaderLink>
    {/* A saved account shows its links at once; the check that follows only confirms them. */}
    {stored ? <>
      <HeaderLink href={`/p/${stored.profile.handle}`} aria-current={active === "profile" ? "page" : undefined}>Your record</HeaderLink>
      <HeaderLink href={accountFrom === "/" ? "/me" : `/me?${new URLSearchParams({ from: accountFrom })}`} aria-label="Account settings" aria-current={active === "account" ? "page" : undefined}>Account</HeaderLink>
    </> : ready ? <HeaderLink href={loginHref(loginNext)} onClick={onLogin} aria-current={active === "login" ? "page" : undefined}>Log in</HeaderLink> : null}
    <HowToPlayButton />
    {/* Home is already Tables, so a way back to it would only repeat it. */}
    {back && back.href !== "/" ? <HeaderLink href={back.href}>{back.label}</HeaderLink> : null}
  </HeaderBar>;
}

/** The source lives outside the app, so it sits at the edge as a mark, not among the places to go. */
function RepositoryLink() {
  return <HeaderLink href={REPO_URL} target="_blank" rel="noreferrer" aria-label="Source code on GitHub" title="Source code on GitHub" className="ring-1 ring-inset ring-line-strong">
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  </HeaderLink>;
}
