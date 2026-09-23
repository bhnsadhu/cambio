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
 * seated, and anyone who leaves sends the rest back to the lobby with a
 * seat open, rather than ending the evening for all of them.
 */
export function Scoreboard({
  view,
  me,
  busy,
  onPlayAgain,
  onLeave,
}: {
  view: PublicView;
  me: string | null;
  busy: boolean;
  onPlayAgain: () => void;
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

  const seated = !!me && view.players.some((p) => p.id === me);
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
      <div className="max-h-[calc(100dvh-32px)] w-full max-w-[860px] animate-rise overflow-y-auto rounded-panel bg-surface p-5 shadow-float hairline sm:p-8">
        <header className="flex flex-col items-start justify-between gap-5 lg:flex-row lg:gap-6">
          <div>
            <p className="t-caption text-ink-3">Round {result.round} of this table</p>
            <h2 className="t-title mt-1.5">{headline}</h2>
            <p className="t-callout mt-1.5 text-ink-2">
              {caller ? (view.cambio!.reason === "zero" ? <><PlayerName name={caller.name} isBot={caller.isBot} /> ran out of cards. </> : <><PlayerName name={caller.name} isBot={caller.isBot} /> called Cambio. </>) : null}
              Lowest hand wins. Ties share the win.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2.5 lg:items-end">
            {seated ? (
              ready ? (
                <>
                  <span className="t-sub inline-flex items-center gap-2 text-accent-ink"><Pip />You are ready for another round</span>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={onLeave}>Leave instead</Button>
                </>
              ) : (
                <div className="flex items-center gap-2.5">
                  <Button variant="secondary" size="lg" disabled={busy} onClick={onLeave}>Leave</Button>
                  <Button variant="primary" size="lg" disabled={busy} onClick={onPlayAgain}>I&apos;m ready</Button>
                </div>
              )
            ) : (
              <p className="t-sub max-w-[190px] text-right text-ink-3">Watching. The table decides whether to play on.</p>
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
                . If anyone leaves, the rest go back to the lobby.
              </p>
            ) : (
              <p className="t-footnote text-right text-ink-3">Everyone is ready. Dealing.</p>
            )}
          </div>
        </header>

        <ol className="mt-6 space-y-3 lg:hidden" aria-label="Final hands and scores">
          {rows.map(({ player, score, cards, rank }, index) => {
            const won = result.winnerIds.includes(player.id);
            return <li key={player.id} className={`rounded-card p-4 ${player.id === me ? "bg-accent-soft" : "bg-surface-2"}`} aria-label={`${player.name}'s result`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="t-sub flex items-center gap-2 break-words font-semibold"><Avatar identity={player.profileId ?? player.name} size={32} /><span className="mr-2 text-ink-3">{rank}.</span><PlayerName name={player.name} isBot={player.isBot} /></p>
                  <div className="mt-1 flex flex-wrap gap-1.5">{player.id === me ? <Chip>You</Chip> : null}{won ? <Chip tone="accent">Winner</Chip> : null}</div>
                </div>
                <div className="shrink-0 text-right"><p className="t-caption text-ink-3">Hand total</p><p className={`t-money text-[26px] ${won ? "text-accent" : ""}`}><CountUp value={score} delay={240 + index * 220} /></p></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">{cards.length ? cards.map((card) => <FaceCard key={card.id} card={card} size="sm" />) : <span className="t-sub text-ink-3">No cards</span>}</div>
              <p className="t-footnote mt-3 text-ink-2">Rounds won: {roundsWon.get(player.id) ?? 0} of {view.results.length}</p>
            </li>;
          })}
        </ol>

        <table className="mt-7 hidden w-full border-separate border-spacing-0 lg:table">
          <thead>
            <tr className="t-caption text-left text-ink-3">
              <th className="w-10 pb-2.5 font-medium">#</th>
              <th className="pb-2.5 font-medium">Player</th>
              <th className="pb-2.5 font-medium">Final hand</th>
              <th className="pb-2.5 pl-6 text-right font-medium">Hand total</th>
              <th className="pb-2.5 pl-8 text-right font-medium">Rounds won</th>
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
                    <div className="flex items-center gap-2 text-[15px] font-medium">
                      <Avatar identity={player.profileId ?? player.name} size={36} />
                      {isMe ? (
                        <span>You <span className="t-sub font-normal text-ink-3">{player.name}</span></span>
                      ) : (
                        <span><PlayerName name={player.name} isBot={player.isBot} /></span>
                      )}
                      {won ? <Chip tone="accent">Winner</Chip> : null}
                    </div>
                  </td>
                  <td className="border-t border-line py-3.5 pr-4 align-middle">
                    <div className="flex flex-wrap gap-1.5">
                      {cards.length ? cards.map((c, i) => (
                        <FaceCard key={c.id} card={c} size="md" className="animate-flip-in" style={{ animationDelay: `${base + i * 70}ms` }} />
                      )) : <span className="t-sub text-ink-3">No cards</span>}
                    </div>
                  </td>
                  <td className={`t-money border-t border-line py-3.5 pl-6 text-right align-middle text-[26px] ${won ? "text-accent" : ""}`}>
                    <CountUp value={score} delay={base + cards.length * 70} />
                  </td>
                  <td className="t-money border-t border-line py-3.5 pl-8 text-right align-middle text-[17px] text-ink-2">
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
