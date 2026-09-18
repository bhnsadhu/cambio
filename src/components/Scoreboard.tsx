"use client";

import { useEffect, useState } from "react";
import type { PublicView } from "@/lib/game/types";
import { FaceCard } from "./cards";
import { Button, Chip, PlayerName } from "./ui";

/**
 * The payoff. Players are ranked from winner down, your own row says so,
 * hands turn over one card at a time, and a running tally of rounds won
 * builds across replays at the same table.
 */
export function Scoreboard({ view, me, busy, onPlayAgain }: { view: PublicView; me: string | null; busy: boolean; onPlayAgain: () => void }) {
  const result = view.results[view.results.length - 1];
  if (!result) return null;

  const roundsWon = new Map<string, number>();
  const history = new Map<string, number[]>();
  for (const r of view.results) {
    for (const s of r.scores) history.set(s.playerId, [...(history.get(s.playerId) ?? []), s.score]);
    for (const w of r.winnerIds) roundsWon.set(w, (roundsWon.get(w) ?? 0) + 1);
  }

  const rows = view.players
    .map((p) => ({ player: p, ...result.scores.find((s) => s.playerId === p.id)! }))
    .sort((a, b) => a.score - b.score || a.player.seat - b.player.seat)
    .map((row, i, all) => ({ ...row, rank: all.findIndex((x) => x.score === row.score) + 1 }));

  const isHost = me === view.hostId;
  const host = view.players.find((p) => p.id === view.hostId);
  const winners = view.players.filter((p) => result.winnerIds.includes(p.id));
  const caller = view.cambio ? view.players.find((p) => p.id === view.cambio!.callerId) : null;
  const meWon = !!me && result.winnerIds.includes(me);
  const headline = meWon
    ? (winners.length > 1 ? "You share the round" : "You take the round")
    : winners.length > 1
      ? <>Tie between {winners.map((w, i) => <span key={w.id}>{i > 0 ? (i === winners.length - 1 ? " and " : ", ") : ""}<PlayerName name={w.name} isBot={w.isBot} /></span>)}</>
      : <><PlayerName name={winners[0].name} isBot={winners[0].isBot} /> takes the round</>;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-6 animate-fade">
      <div className="w-full max-w-[860px] animate-rise rounded-panel bg-surface p-8 shadow-float hairline">
        <header className="flex items-start justify-between gap-6">
          <div>
            <p className="t-caption text-ink-3">Round {result.round} of this table</p>
            <h2 className="t-title mt-1.5">{headline}</h2>
            <p className="t-callout mt-1.5 text-ink-2">
              {caller ? (view.cambio!.reason === "zero" ? <><PlayerName name={caller.name} isBot={caller.isBot} /> ran out of cards. </> : <><PlayerName name={caller.name} isBot={caller.isBot} /> called Cambio. </>) : null}
              Lowest hand wins. Ties share the win.
            </p>
          </div>
          {isHost ? (
            <Button variant="primary" size="lg" disabled={busy} onClick={onPlayAgain}>Play again</Button>
          ) : (
            <p className="t-sub max-w-[180px] text-right text-ink-3">Waiting for {host ? <PlayerName name={host.name} isBot={host.isBot} /> : "the host"} to deal again</p>
          )}
        </header>

        <table className="mt-7 w-full border-separate border-spacing-0">
          <thead>
            <tr className="t-caption text-left text-ink-3">
              <th className="w-10 pb-2.5 font-medium">#</th>
              <th className="pb-2.5 font-medium">Player</th>
              <th className="pb-2.5 font-medium">Final hand</th>
              <th className="pb-2.5 pl-6 text-right font-medium">Hand total</th>
              <th className="pb-2.5 pl-8 text-right font-medium">Rounds won</th>
              <th className="pb-2.5 pl-6 text-right font-medium">Each round</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, score, cards, rank }, row) => {
              const won = result.winnerIds.includes(player.id);
              const isMe = player.id === me;
              const base = 240 + row * 220;
              const wins = roundsWon.get(player.id) ?? 0;
              const past = history.get(player.id) ?? [];
              return (
                <tr key={player.id} className={isMe ? "bg-surface-2/60" : ""}>
                  <td className={`t-money border-t border-line py-3.5 pl-2 align-middle text-[17px] ${won ? "text-accent" : "text-ink-3"}`}>{rank}</td>
                  <td className="border-t border-line py-3.5 pr-4 align-middle">
                    <div className="flex items-center gap-2 text-[15px] font-medium">
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
                  <td className="tnum border-t border-line py-3.5 pl-6 text-right align-middle">
                    <span className="t-sub text-ink-3">{past.map((s, i) => `R${i + 1} ${s}`).join(" · ")}</span>
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
