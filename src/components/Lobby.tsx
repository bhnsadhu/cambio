"use client";

import { useState } from "react";
import type { BotDifficulty, PublicView } from "@/lib/game/types";
import { BOT_NAMES } from "@/lib/game/engine";
import { Button, Chip, DifficultyPicker, Pip, PlayerName } from "./ui";

export function Lobby({
  view,
  me,
  busy,
  onStart,
  onDifficulty,
}: {
  view: PublicView;
  me: string | null;
  busy: boolean;
  onStart: () => void;
  onDifficulty: (seat: number, difficulty: BotDifficulty) => void;
}) {
  const [copied, setCopied] = useState(false);
  const isHost = me === view.hostId;
  const host = view.players.find((p) => p.id === view.hostId);
  const humans = view.players.filter((p) => !p.isBot);
  const open = 4 - humans.length;
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
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-10 pt-12">
      <header className="flex items-end justify-between gap-8">
        <div>
          <p className="t-caption text-ink-3">Join code</p>
          <div className="mt-2 flex items-center gap-4">
            <span className="t-money text-[64px] leading-none tracking-[0.08em]">{view.code}</span>
            <Button variant="secondary" size="sm" onClick={copy}>{copied ? "Copied" : "Copy link"}</Button>
          </div>
          <p className="t-body mt-4 max-w-[440px] text-ink-2">
            Share the code. Anyone who joins takes the next open seat. Seats still open when the round starts go to the house bots.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {isHost ? (
            <>
              <Button variant="primary" size="lg" disabled={busy} onClick={onStart}>Start round</Button>
              <p className="t-footnote text-ink-3">
                {open === 0 ? "All four seats are taken." : open === 1 ? "One bot will fill the last seat." : `${open} bots will fill the empty seats.`}
                {" "}Starting deals the cards; the round itself waits on every seat to say ready.
              </p>
            </>
          ) : (
            <p className="t-sub inline-flex items-center gap-2 text-ink-2"><Pip />Waiting for {host ? <PlayerName name={host.name} isBot={host.isBot} /> : "the host"} to start</p>
          )}
        </div>
      </header>

      <div>
        <p className="t-sub mb-3 inline-flex items-center gap-2 text-ink-2">
          {open > 0 ? <Pip /> : null}
          {humans.length} of 4 seats taken
        </p>
        <ol className="grid grid-cols-4 gap-4">
          {seats.map((p, seat) => {
            const botName = p ? null : BOT_NAMES[botIdx++];
            return (
              <li key={seat} className={`flex min-h-[136px] flex-col justify-between rounded-panel border-[1.5px] px-5 py-4 transition-[box-shadow,background-color] duration-300 ${p ? "border-transparent bg-surface hairline animate-pop" : "border-dashed border-line-strong"}`}>
                <p className="t-caption text-ink-3">Seat {seat + 1}</p>
                {p ? (
                  <div>
                    <p className="t-headline"><PlayerName name={p.name} isBot={p.isBot} /></p>
                    <div className="mt-1.5 flex gap-1.5">
                      {p.isHost ? <Chip>Host</Chip> : null}
                      {p.id === me ? <Chip tone="ink">You</Chip> : null}
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="t-headline text-ink-3">Open</p>
                    <p className="t-footnote mt-1 text-ink-3">
                      <PlayerName name={botName!} isBot /> sits here if it stays empty
                    </p>
                    <div className="mt-2">
                      <DifficultyPicker
                        label={`How ${botName} plays`}
                        value={view.botDifficulty[seat] ?? "medium"}
                        canEdit={isHost}
                        disabled={busy}
                        onChange={(d) => onDifficulty(seat, d)}
                      />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
