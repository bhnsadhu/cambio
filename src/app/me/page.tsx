"use client";

import Link from "next/link";
import { AccountSettings, AuthForm } from "@/components/Account";
import { FriendsPanel, Notifications } from "@/components/Friends";
import { ProfileCard } from "@/components/Profile";
import { Button, Wordmark } from "@/components/ui";
import { usePresence, useSocial } from "@/lib/client/social";
import { useAccountReady, useStoredProfile } from "@/lib/client/profile";
import { useStoredName } from "@/lib/client/useStoredName";

export default function MePage() {
  const social = useSocial();
  const stored = useStoredProfile();
  const ready = useAccountReady();
  const [name] = useStoredName();
  usePresence(null);
  return (
    <main className="mx-auto min-h-screen w-full max-w-[1080px] px-5 pb-20 sm:px-8">
      <header className="flex h-16 items-center justify-between gap-3">
        <Link href="/" aria-label="Cambio home"><Wordmark /></Link>
        <Link href="/" className="t-sub text-ink-2 hover:text-ink">Back to the tables</Link>
      </header>
      {!ready ? <div role="status" className="mx-auto max-w-[460px] py-20 text-ink-2">Checking your account...</div>
        : !stored ? <div className="mx-auto max-w-[460px] pt-10 animate-rise">
          <h1 className="t-title mb-6">Your Cambio account</h1>
          <AuthForm initialName={name} />
          <Link href="/" className="mt-5 block text-center"><Button variant="ghost">Play as a guest</Button></Link>
        </div> : <>
          <header className="pt-8 pb-6"><h1 className="t-title">Account settings</h1><p className="t-body mt-2 text-ink-2">Your name, your login, and your record.</p></header>
          {stored.username ? <nav aria-label="Account sections" className="mb-6 flex flex-wrap gap-2">
            {[["display-name", "Display name"], ["username", "Username"], ["password", "Password"], ["sign-out", "Sign out"], ["delete-account", "Delete account"]].map(([id, label]) => <a key={id} href={`#${id}`} className="t-sub rounded-full bg-surface-2 px-4 py-2 hover:bg-surface-3">{label}</a>)}
          </nav> : null}
          <div className="grid items-start gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-5">
              {!stored.username ? <AuthForm legacy initialName={stored.profile.displayName} /> : <AccountSettings key={stored.profile.id} stored={stored} />}
            </div>
            <div className="flex flex-col gap-6">
              <ProfileCard profile={social.profile ?? stored.profile} />
              <FriendsPanel social={social} />
            </div>
          </div>
        </>}
      <Notifications social={social} />
    </main>
  );
}
