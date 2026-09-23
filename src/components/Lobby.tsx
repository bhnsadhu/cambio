"use client";

import { Avatar } from "./Avatar";
import { useState } from "react";
import type { BotDifficulty, PublicView } from "@/lib/game/types";
import { BOT_NAMES } from "@/lib/game/engine";
import { Button, Chip, DifficultyPicker, Pip, PlayerName } from "./ui";

export function Lobby({
  view,
  me,
  busy,
  hasAccount,
  onStart,
  onDifficulty,
}: {
  view: PublicView;
  me: string | null;
  busy: boolean;
  hasAccount: boolean;
  onStart: () => void;
  onDifficulty: (seat: number, difficulty: BotDifficulty) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
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
      setCopyError(false);
      setTimeout(() => setCopied(false), 1600);
    } catch { setCopyError(true); }
  };

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[880px] flex-col gap-8 pt-7 pb-8 sm:pt-12">
      <header className="flex flex-col items-start justify-between gap-6 xl:flex-row xl:items-end">
        <div className="min-w-0">
          <p className="t-caption text-ink-3">Join code</p>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <span className="t-money text-[44px] leading-none tracking-[0.08em] sm:text-[64px]">{view.code}</span>
            <Button variant="secondary" size="sm" onClick={copy}>{copied ? "Copied" : "Copy link"}</Button>
          </div>
          {copyError ? <p role="status" className="t-sub mt-2 text-ink-2">Copying is unavailable. Share the code above instead.</p> : null}
          <p className="t-body mt-4 max-w-[440px] text-ink-2">
            Share the code to invite someone. {hasAccount ? (view.doNotDisturb ? "Do not disturb is on, so friends need an invitation. " : "Friends can also ask to join and wait for you to accept. ") : ""}Seats still open when the round starts go to the house bots.
          </p>
        </div>
        <div className="flex min-w-0 flex-col items-start gap-2 xl:max-w-[260px] xl:items-end">
          {isHost ? (
            <>
              <Button variant="primary" size="lg" disabled={busy} onClick={onStart}>Start round</Button>
              <p className="t-footnote text-ink-3 xl:text-right">
                {open === 0 ? "All four seats are taken." : open === 1 ? "One bot will fill the last seat." : `${open} bots will fill the empty seats.`}
                {" "}Starting deals the cards; the round itself waits on every seat to say ready.
              </p>
            </>
          ) : (
            <p className="t-sub flex min-w-0 items-center gap-2 text-ink-2"><Pip /><span className="min-w-0 break-words">Waiting for {host ? <PlayerName name={host.name} isBot={host.isBot} /> : "the host"} to start</span></p>
          )}
        </div>
      </header>

      <div>
        <p className="t-sub mb-3 inline-flex items-center gap-2 text-ink-2">
          {open > 0 ? <Pip /> : null}
          {humans.length} of 4 seats taken
        </p>
        <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {seats.map((p, seat) => {
            const botName = p ? null : BOT_NAMES[botIdx++];
            return (
              <li key={seat} className={`flex min-h-[136px] min-w-0 flex-col rounded-panel border-[1.5px] px-5 py-4 transition-[box-shadow,background-color] duration-300 xl:px-3 ${p ? "border-transparent bg-surface hairline animate-pop" : "border-dashed border-line-strong"}`}>
                <p className="t-caption text-ink-3">Seat {seat + 1}</p>
                {p ? (
                  <div className="mt-3 min-w-0 flex-1">
                    <p className="t-headline flex min-w-0 items-center gap-2"><Avatar identity={p.profileId ?? p.name} avatarId={p.avatarId} size={40} /><span className="min-w-0 [overflow-wrap:anywhere]"><PlayerName name={p.name} isBot={p.isBot} /></span></p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {p.isHost ? <Chip>Host</Chip> : null}
                      {p.id === me ? <Chip tone="ink">You</Chip> : null}
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-1 flex-col">
                    <p className="t-headline flex min-h-10 items-center text-ink-3">Open</p>
                    <p className="t-footnote mt-1 text-ink-3">
                      <PlayerName name={botName!} isBot /> sits here if it stays empty
                    </p>
                    <div className="mt-auto pt-2">
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
