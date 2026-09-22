"use client";

import type { PublicView } from "@/lib/game/types";
import { Button, Chip } from "./ui";

export function RoomSettings({ view, me, busy, onChange }: {
  view: PublicView;
  me: string | null;
  busy: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const enabled = view.doNotDisturb;
  const isHost = me === view.hostId;
  return (
    <section aria-label="Room settings" className="mx-auto mt-3 flex w-full max-w-[1280px] items-center justify-between gap-4 rounded-[16px] bg-surface px-4 py-3 hairline">
      <div className="min-w-0">
        <h2 className="t-sub font-medium">Do not disturb</h2>
        <p className="t-footnote mt-1 text-ink-3">
          {enabled ? "Join requests are off. Invitations and shared codes still work." : "Friends can ask to join this table."}
          {!isHost ? " The host controls this setting." : null}
        </p>
      </div>
      {isHost ? (
        <Button role="switch" aria-label="Do not disturb" aria-checked={enabled} variant={enabled ? "accent" : "secondary"}
          size="sm" disabled={busy} onClick={() => onChange(!enabled)}>{enabled ? "On" : "Off"}</Button>
      ) : <Chip tone={enabled ? "accent" : "neutral"}>{enabled ? "On" : "Off"}</Chip>}
    </section>
  );
}
