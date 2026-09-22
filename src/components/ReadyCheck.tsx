"use client";

import { useClock } from "@/lib/client/useClock";
import type { BotDifficulty, PublicView } from "@/lib/game/types";
import { Button, Chip, DifficultyPicker, DotOff, Pip, PlayerName } from "./ui";

/**
 * The beat between a set table and a dealt round. Nothing is shuffled until
 * every seat has said it is in, so nobody is dealt a hand while they are
 * still reading the rules. Bots answer the moment they are asked; a human who
 * never answers is carried by the deadline rather than holding the table up.
 */
export function ReadyCheck({
  view,
  me,
  busy,
  skew,
  onReady,
  onDifficulty,
}: {
  view: PublicView;
  me: string | null;
  busy: boolean;
  skew: number;
  onReady: () => void;
  onDifficulty: (seat: number, difficulty: BotDifficulty) => void;
}) {
  const tick = useClock(500);
  const isHost = me === view.hostId;
  const imReady = !!me && view.readyIds.includes(me);
  const waiting = view.players.filter((p) => !view.readyIds.includes(p.id));
  const left = view.readyDeadline === null || tick === 0
    ? null
    : Math.max(0, Math.ceil((view.readyDeadline - (tick + skew)) / 1000));

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-10 pt-12">
      <header className="flex items-end justify-between gap-8">
        <div>
          <p className="t-caption text-ink-3">Round {view.round}</p>
          <h1 className="t-display mt-2">Ready check.</h1>
          <p className="t-body mt-4 max-w-[460px] text-ink-2">
            The seats are set. Nothing is dealt until everyone is in. Once the last seat says ready,
            the deck is shuffled and everyone gets five seconds to memorise their bottom two cards.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {me ? (
            <Button variant={imReady ? "secondary" : "primary"} size="lg" disabled={busy || imReady} onClick={onReady}>
              {imReady ? "You are ready" : "I'm ready"}
            </Button>
          ) : null}
          <p className="t-footnote text-ink-3">
            {waiting.length === 0
              ? "Dealing."
              : left !== null
                ? `Waiting on ${waiting.length} ${waiting.length === 1 ? "seat" : "seats"} · starts anyway in ${left}s`
                : `Waiting on ${waiting.length} ${waiting.length === 1 ? "seat" : "seats"}`}
          </p>
        </div>
      </header>

      <div>
        <p className="t-sub mb-3 inline-flex items-center gap-2 text-ink-2">
          {waiting.length ? <Pip /> : null}
          {view.readyIds.length} of {view.players.length} ready
        </p>
        <ol className="grid grid-cols-4 gap-4">
          {view.players.map((p) => {
            const ready = view.readyIds.includes(p.id);
            return (
              <li
                key={p.id}
                className={`flex min-h-[136px] flex-col justify-between rounded-panel px-5 py-4 transition-[box-shadow,background-color] duration-300 ${ready ? "bg-surface-2 ring-accent" : "bg-surface hairline"}`}
              >
                <p className="t-caption text-ink-3">Seat {p.seat + 1}</p>
                <div>
                  <p className="t-headline"><PlayerName name={p.name} isBot={p.isBot} /></p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {p.id === me ? <Chip tone="ink">You</Chip> : null}
                    {p.isBot ? (
                      <DifficultyPicker
                        label={`How ${p.name} plays`}
                        value={p.difficulty ?? "medium"}
                        canEdit={isHost}
                        disabled={busy}
                        onChange={(d) => onDifficulty(p.seat, d)}
                      />
                    ) : null}
                  </div>
                  <p className="t-footnote mt-2 inline-flex items-center gap-1.5 text-ink-3">
                    {ready ? <Pip /> : <DotOff />}
                    {ready ? "Ready" : "Waiting"}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
