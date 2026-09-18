"use client";

import { useState } from "react";
import type { PublicView } from "@/lib/game/types";
import { BOT_NAMES } from "@/lib/game/engine";
import { Button, Chip, PlayerName } from "./ui";

export function Lobby({ view, me, busy, onStart }: { view: PublicView; me: string | null; busy: boolean; onStart: () => void }) {
  const [copied, setCopied] = useState(false);
  const isHost = me === view.hostId;
  const humans = view.players.filter((p) => !p.isBot);
  const seats = [0, 1, 2, 3].map((seat) => view.players.find((p) => p.seat === seat) ?? null);
  let botIdx = 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/g/${view.code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked */ }
  };

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8 pt-10">
      <header className="flex items-end justify-between gap-6">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-ink-3">Join code</p>
          <button type="button" onClick={copy} className="mt-1 flex items-baseline gap-3 text-left" title="Copy invite link">
            <span className="text-[56px] font-semibold leading-none tracking-[0.08em]">{view.code}</span>
            <span className="text-[13px] text-ink-3">{copied ? "Link copied" : "Click to copy link"}</span>
          </button>
          <p className="mt-3 max-w-[460px] text-[14px] text-ink-2">
            Share the code. Anyone who joins takes the next open seat; empty seats are dealt to the house bots when you start.
          </p>
        </div>
        {isHost ? (
          <Button variant="primary" size="lg" disabled={busy} onClick={onStart}>
            Start round{humans.length < 4 ? ` with ${4 - humans.length} bot${4 - humans.length === 1 ? "" : "s"}` : ""}
          </Button>
        ) : (
          <p className="text-[13px] text-ink-3">Waiting for the host to start</p>
        )}
      </header>

      <ol className="grid grid-cols-4 gap-4">
        {seats.map((p, seat) => {
          const botName = p ? null : BOT_NAMES[botIdx++];
          return (
            <li key={seat} className={`flex min-h-[132px] flex-col justify-between rounded-panel bg-surface px-5 py-4 ${p ? "hairline" : "border-[1.5px] border-dashed border-line-strong/80"}`}>
              <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-ink-3">Seat {seat + 1}</p>
              {p ? (
                <div>
                  <p className="text-[17px] font-medium">
                    <PlayerName name={p.name} isBot={p.isBot} />
                  </p>
                  <div className="mt-1.5 flex gap-1.5">
                    {p.isHost ? <Chip>Host</Chip> : null}
                    {p.id === me ? <Chip tone="ink">You</Chip> : null}
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-[17px] font-medium text-ink-3">Open</p>
                  <p className="mt-1 text-[12.5px] text-ink-3">
                    <PlayerName name={botName!} isBot /> sits here if it stays empty
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
