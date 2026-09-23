"use client";

import { useEffect, useState } from "react";
import type { PublicView } from "@/lib/game/types";
import { useModalFocus } from "@/lib/client/useModalFocus";
import { Avatar } from "./Avatar";
import { Button } from "./ui";

interface Props {
  view: PublicView;
  busy: boolean;
  onKick: (playerId: string) => Promise<boolean>;
}

export function TablePlayers(props: Props) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Players</Button>
    {open ? <PlayersDialog {...props} onClose={() => setOpen(false)} /> : null}
  </>;
}

function PlayersDialog({ view, busy, onKick, onClose }: Props & { onClose: () => void }) {
  const ref = useModalFocus();
  const [selected, setSelected] = useState<string | null>(null);
  const players = view.players.filter((p) => !p.isBot && p.id !== view.hostId);
  const target = players.find((p) => p.id === selected);
  const activeRound = view.phase !== "lobby" && view.phase !== "scoring";
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return <div ref={ref} tabIndex={-1} role="dialog" aria-modal aria-labelledby="table-players-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 outline-none animate-fade">
    <div className="max-h-[calc(100dvh-32px)] w-full max-w-[480px] overflow-y-auto rounded-panel bg-surface p-6 shadow-float hairline sm:p-8">
      <h2 id="table-players-title" className="t-title2 [overflow-wrap:anywhere]">{target ? `Remove ${target.name}?` : "Table players"}</h2>
      {target ? <>
        <p className="t-body mt-3 text-ink-2">{activeRound
          ? "A medium bot will take over their seat and exact cards. The round will continue."
          : "Their seat will be opened and the remaining players will be in the lobby."}</p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" disabled={busy} onClick={() => setSelected(null)}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={async () => { if (await onKick(target.id)) setSelected(null); }}>{busy ? "Removing" : "Remove player"}</Button>
        </div>
      </> : <>
        <p className="t-sub mt-2 text-ink-2">As host, you can remove players from this table.</p>
        <ul className="mt-5 flex flex-col gap-4">
          {players.map((player) => <li key={player.id} className="flex items-center gap-3">
            <Avatar identity={player.profileId ?? player.name} avatarId={player.avatarId} size={36} />
            <span className="t-body min-w-0 flex-1 break-words">{player.name}</span>
            <Button variant="secondary" size="sm" disabled={busy} aria-label={`Remove ${player.name}`} onClick={() => setSelected(player.id)}>Remove</Button>
          </li>)}
        </ul>
        {!players.length ? <p className="t-body mt-5 text-ink-3">No other players are seated.</p> : null}
        <div className="mt-6 flex justify-end"><Button variant="secondary" disabled={busy} onClick={onClose}>Done</Button></div>
      </>}
    </div>
  </div>;
}
