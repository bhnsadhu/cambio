"use client";

import Link from "next/link";
import { useState } from "react";
import { FriendsPanel, Notifications } from "@/components/Friends";
import { ProfileCard, SaveProfile } from "@/components/Profile";
import { Button, Wordmark } from "@/components/ui";
import { useSocial } from "@/lib/client/social";
import { createProfile, renameProfile, saveStoredProfile } from "@/lib/client/profile";
import { getStoredName } from "@/lib/client/session";

/** Your record, your friends, and the handle other people add you by. */
export default function MePage() {
  const social = useSocial();
  const [renaming, setRenaming] = useState(false);
  const profile = social.profile;

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1000px] px-8 pb-20">
      <header className="flex h-14 items-center justify-between">
        <Link href="/" aria-label="Cambio home"><Wordmark /></Link>
        <Link href="/"><Button variant="ghost" size="sm">Back to the tables</Button></Link>
      </header>

      {!profile ? (
        <div className="mx-auto max-w-[460px] pt-16 animate-rise">
          <h1 className="t-title">Keep a record.</h1>
          <p className="t-body mt-2 mb-6 text-ink-2">
            A profile remembers every round you play: wins, rank, best hand, and the friends you play them with.
          </p>
          <SaveProfile initialName={getStoredName()} onSaved={async (name) => { await createProfile(name); await social.refresh(); }} />
        </div>
      ) : (
        <div className="grid grid-cols-[1.25fr_1fr] gap-6 pt-8 animate-rise">
          <div className="flex flex-col gap-6">
            <ProfileCard profile={profile} />
            <section className="rounded-panel bg-surface p-6 hairline">
              <h2 className="t-headline">Your handle</h2>
              <p className="t-sub mt-1 text-ink-2">
                Friends add you with <span className="font-semibold text-ink">@{profile.handle}</span>. It is yours for good;
                the name above it is the one the table sees.
              </p>
              <div className="mt-4 flex gap-2">
                {renaming ? (
                  <div className="w-full">
                    <SaveProfile
                      initialName={profile.displayName}
                      onSaved={async (name) => { await renameProfile(name); await social.refresh(); setRenaming(false); }}
                    />
                  </div>
                ) : (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => setRenaming(true)}>Change name</Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { if (confirm("Forget this profile on this device? Without its key it cannot be recovered.")) { saveStoredProfile(null); void social.refresh(); } }}
                    >
                      Forget on this device
                    </Button>
                  </>
                )}
              </div>
            </section>
          </div>
          <FriendsPanel social={social} />
        </div>
      )}

      <Notifications social={social} />
    </main>
  );
}
