"use client";

import { Avatar } from "./Avatar";
import { useEffect, useState } from "react";
import { useModalFocus } from "@/lib/client/useModalFocus";
import type { PublicView } from "@/lib/game/types";
import { FaceCard } from "./cards";
import { Button, Chip, Pip, PlayerName } from "./ui";

/**
 * The payoff. Players are ranked from winner down, your own row says so,
 * hands turn over one card at a time, and a running tally of rounds won
 * builds across replays at the same table.
 *
 * Then the table decides together: another round needs everyone still
 * seated, or anyone can bring the group back to the lobby to take a break.
 */
export function Scoreboard({
  view,
  me,
  busy,
  onPlayAgain,
  onBackToTable,
  onLeave,
}: {
  view: PublicView;
  me: string | null;
  busy: boolean;
  onPlayAgain: () => void;
  onBackToTable: () => void;
  onLeave: () => void;
}) {
  const dialogRef = useModalFocus();
  const result = view.results[view.results.length - 1];
  if (!result) return null;

  const roundsWon = new Map<string, number>();
  for (const r of view.results) {
    for (const w of r.winnerIds) roundsWon.set(w, (roundsWon.get(w) ?? 0) + 1);
  }

  const rows = view.players
    .map((p) => ({ player: p, ...result.scores.find((s) => s.playerId === p.id)! }))
    .sort((a, b) => a.score - b.score || a.player.seat - b.player.seat)
    .map((row, i, all) => ({ ...row, rank: all.findIndex((x) => x.score === row.score) + 1 }));

  const seated = !!me && view.players.some((p) => p.id === me && !p.isBot);
  const ready = !!me && view.replayVotes.includes(me);
  const waiting = view.players.filter((p) => !view.replayVotes.includes(p.id));
  const winners = view.players.filter((p) => result.winnerIds.includes(p.id));
  const caller = view.cambio ? view.players.find((p) => p.id === view.cambio!.callerId) : null;
  const meWon = !!me && result.winnerIds.includes(me);
  const headline = meWon
    ? (winners.length > 1 ? "You share the round" : "You take the round")
    : winners.length > 1
      ? <>Tie between {winners.map((w, i) => <span key={w.id}>{i > 0 ? (i === winners.length - 1 ? " and " : ", ") : ""}<PlayerName name={w.name} isBot={w.isBot} /></span>)}</>
      : <><PlayerName name={winners[0].name} isBot={winners[0].isBot} /> takes the round</>;

  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4 outline-none animate-fade" role="dialog" aria-modal aria-label="Round results">
      <div className="max-h-[calc(100dvh-32px)] w-full min-w-0 max-w-[1040px] animate-rise overflow-y-auto rounded-panel bg-surface p-5 shadow-float hairline sm:p-8">
        <header className="flex flex-col items-start justify-between gap-5 lg:flex-row lg:gap-6">
          <div className="min-w-0 break-words">
            <p className="t-caption text-ink-3">Round {result.round} of this table</p>
            <h2 className="t-title mt-1.5 lg:max-w-[650px]">{headline}</h2>
            <p className="t-callout mt-1.5 text-ink-2">
              {caller ? (view.cambio!.reason === "zero" ? <><PlayerName name={caller.name} isBot={caller.isBot} /> ran out of cards. </> : <><PlayerName name={caller.name} isBot={caller.isBot} /> called Cambio. </>) : null}
              Lowest hand wins. Ties share the win.
            </p>
          </div>
          <div className="flex max-w-full flex-col items-start gap-2.5 lg:w-[230px] lg:shrink-0 lg:items-end">
            {seated ? (
              <>
                {ready ? (
                  <span className="t-sub inline-flex items-center gap-2 text-accent-ink"><Pip />You are ready for another round</span>
                ) : (
                  <Button variant="primary" size="lg" disabled={busy} onClick={onPlayAgain}>I&apos;m ready</Button>
                )}
                <div className="flex flex-wrap items-center gap-2.5">
                  <Button variant="secondary" size="sm" disabled={busy} onClick={onBackToTable}>Back to table</Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={onLeave}>{ready ? "Leave instead" : "Leave"}</Button>
                </div>
                <p className="t-footnote text-ink-3 lg:text-right">Back to table keeps everyone together without starting another round.</p>
              </>
            ) : (
              <p className="t-sub max-w-[230px] text-ink-3 lg:text-right">Watching. The table decides whether to play on.</p>
            )}
            {waiting.length ? (
              <p className="t-footnote max-w-[350px] text-ink-3 lg:max-w-[230px] lg:text-right">
                {view.players.length - waiting.length} of {view.players.length} in. Waiting on{" "}
                {waiting.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 ? (i === waiting.length - 1 ? " and " : ", ") : ""}
                    {p.id === me ? "you" : <PlayerName name={p.name} isBot={p.isBot} />}
                  </span>
                ))}
                .
              </p>
            ) : (
              <p className="t-footnote text-ink-3 lg:text-right">Everyone is ready. Dealing.</p>
            )}
          </div>
        </header>

        <ol className="mt-6 space-y-3 lg:hidden" aria-label="Final hands and scores">
          {rows.map(({ player, score, cards, rank }, index) => {
            const won = result.winnerIds.includes(player.id);
            return <li key={player.id} className={`rounded-card p-4 ${player.id === me ? "bg-accent-soft" : "bg-surface-2"}`} aria-label={`${player.name}'s result`}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar identity={player.profileId ?? player.name} avatarId={player.avatarId} size={32} />
                    <p className="t-sub min-w-0 font-semibold [overflow-wrap:anywhere]"><span className="mr-1.5 text-ink-3">{rank}.</span><PlayerName name={player.name} isBot={player.isBot} /></p>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">{player.id === me ? <Chip>You</Chip> : null}{won ? <Chip tone="accent">Winner</Chip> : null}</div>
                </div>
                <div className="shrink-0 text-right"><p className="t-caption text-ink-3">Hand total</p><p className={`t-money text-[26px] ${won ? "text-accent" : ""}`}><CountUp value={score} delay={240 + index * 220} /></p></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">{cards.length ? cards.map((card) => (
                <div key={card.id} className="flex shrink-0 flex-col items-center gap-1">
                  <FaceCard card={card} size="sm" />
                  <span className="text-[10px] leading-3 font-medium text-ink-3" aria-label={`Card position ${player.hand.indexOf(card.id) + 1}`}>{player.hand.indexOf(card.id) + 1}</span>
                </div>
              )) : <span className="t-sub text-ink-3">No cards</span>}</div>
              <p className="t-footnote mt-3 text-ink-2">Rounds won: {roundsWon.get(player.id) ?? 0} of {view.results.length}</p>
            </li>;
          })}
        </ol>

        <table className="mt-7 hidden w-full table-fixed border-separate border-spacing-0 lg:table">
          <colgroup><col className="w-[5%]" /><col className="w-[29%]" /><col className="w-[33%]" /><col className="w-[15%]" /><col className="w-[18%]" /></colgroup>
          <thead>
            <tr className="t-caption text-left text-ink-3">
              <th className="pb-2.5 pl-2 font-medium">#</th>
              <th className="pb-2.5 pr-4 font-medium">Player</th>
              <th className="pb-2.5 pr-3 font-medium">Final hand</th>
              <th className="px-3 pb-2.5 text-right font-medium">Hand total</th>
              <th className="px-4 pb-2.5 text-right font-medium">Rounds won</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, score, cards, rank }, row) => {
              const won = result.winnerIds.includes(player.id);
              const isMe = player.id === me;
              const base = 240 + row * 220;
              const wins = roundsWon.get(player.id) ?? 0;
              return (
                <tr key={player.id} className={isMe ? "bg-surface-2/60" : ""}>
                  <td className={`t-money border-t border-line py-3.5 pl-2 align-middle text-[17px] ${won ? "text-accent" : "text-ink-3"}`}>{rank}</td>
                  <td className="border-t border-line py-3.5 pr-4 align-middle">
                    <div className="flex min-w-0 items-center gap-2 text-[15px] font-medium">
                      <Avatar identity={player.profileId ?? player.name} avatarId={player.avatarId} size={36} />
                      <div className="min-w-0 [overflow-wrap:anywhere]">
                        {isMe ? (
                          <p>You <span className="t-sub font-normal text-ink-3">{player.name}</span></p>
                        ) : (
                          <p><PlayerName name={player.name} isBot={player.isBot} /></p>
                        )}
                        {won ? <div className="mt-1.5"><Chip tone="accent">Winner</Chip></div> : null}
                      </div>
                    </div>
                  </td>
                  <td className="border-t border-line py-3.5 pr-3 align-middle">
                    <div className="flex flex-wrap gap-1.5">
                      {cards.length ? cards.map((c, i) => (
                        <div key={c.id} className="flex shrink-0 flex-col items-center gap-1">
                          <FaceCard card={c} size="md" className="animate-flip-in" style={{ animationDelay: `${base + i * 70}ms` }} />
                          <span className="text-[10px] leading-3 font-medium text-ink-3" aria-label={`Card position ${player.hand.indexOf(c.id) + 1}`}>{player.hand.indexOf(c.id) + 1}</span>
                        </div>
                      )) : <span className="t-sub text-ink-3">No cards</span>}
                    </div>
                  </td>
                  <td className={`t-money border-t border-line px-3 py-3.5 text-right align-middle text-[26px] ${won ? "text-accent" : ""}`}>
                    <CountUp value={score} delay={base + cards.length * 70} />
                  </td>
                  <td className="t-money border-t border-line px-4 py-3.5 text-right align-middle text-[17px] text-ink-2">
                    {wins}<span className="t-sub text-ink-3"> of {view.results.length}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CountUp({ value, delay }: { value: number; delay: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now() + delay;
    const dur = 560;
    const tick = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - start) / dur));
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(value * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, delay]);
  return <>{n}</>;
}
