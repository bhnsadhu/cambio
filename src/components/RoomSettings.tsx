"use client";

import type { PublicView } from "@/lib/game/types";
import { Chip } from "./ui";
import { HeaderButton } from "./Header";

export function RoomSettings({ view, me, busy, onChange }: {
  view: PublicView;
  me: string | null;
  busy: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const enabled = view.doNotDisturb;
  const isHost = me === view.hostId;
  if (!isHost) return enabled ? <span aria-label="Do not disturb is on" title="The host turned off join requests. Invitations still work."><Chip tone="accent">Invites only</Chip></span> : null;
  return <HeaderButton role="switch" aria-label="Do not disturb" aria-checked={enabled}
    title={enabled ? "Do not disturb is on. Turn off to allow join requests." : "Do not disturb is off. Turn on to stop join requests."}
    disabled={busy} onClick={() => onChange(!enabled)}>{enabled ? "Invites only" : "Join requests on"}</HeaderButton>;
}
