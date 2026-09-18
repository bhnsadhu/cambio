"use client";

import type { PublicView } from "@/lib/game/types";
import { FaceCard } from "./cards";
import { Button, Chip, PlayerName } from "./ui";

export function Scoreboard({ view, me, busy, onPlayAgain }: { view: PublicView; me: string | null; busy: boolean; onPlayAgain: () => void }) {
  const result = view.results[view.results.length - 1];
  if (!result) return null;
  const totals = new Map<string, number>();
  for (const r of view.results) for (const s of r.scores) totals.set(s.playerId, (totals.get(s.playerId) ?? 0) + s.score);
  const rows = view.players.map((p) => ({ player: p, ...result.scores.find((s) => s.playerId === p.id)! }))
    .sort((a, b) => a.score - b.score || a.player.seat - b.player.seat);
  const isHost = me === view.hostId;
  const winners = view.players.filter((p) => result.winnerIds.includes(p.id)).map((p) => p.name);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/30 p-6 animate-fade">
      <div className="w-full max-w-[720px] animate-rise rounded-panel bg-surface p-7 hairline shadow-[0_30px_80px_-30px_rgba(0,0,0,0.4)]">
        <header className="flex items-start justify-between gap-6">
          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-ink-3">Round {result.round}</p>
            <h2 className="mt-1 text-[24px] font-semibold tracking-[-0.02em]">
              {winners.length > 1 ? `Tie between ${winners.join(" and ")}` : `${winners[0]} takes the round`}
            </h2>
            <p className="mt-1 text-[14px] text-ink-2">Lowest total wins. Ties stand.</p>
          </div>
          {isHost ? (
            <Button variant="primary" size="lg" disabled={busy} onClick={onPlayAgain}>Play again</Button>
          ) : (
            <p className="text-[13px] text-ink-3">Waiting for the host to deal again</p>
          )}
        </header>

        <table className="mt-6 w-full border-separate border-spacing-0">
          <thead>
            <tr className="text-left text-[12px] font-medium text-ink-3">
              <th className="pb-2 font-medium">Player</th>
              <th className="pb-2 font-medium">Final hand</th>
              <th className="tnum pb-2 text-right font-medium">Round</th>
              <th className="tnum pb-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, score, cards }) => {
              const won = result.winnerIds.includes(player.id);
              return (
                <tr key={player.id} className="border-t border-line">
                  <td className="border-t border-line py-3 pr-4 align-middle">
                    <div className="flex items-center gap-2 text-[15px] font-medium">
                      <span><PlayerName name={player.name} isBot={player.isBot} /></span>
                      {won ? <Chip tone="accent">Winner</Chip> : null}
                      {player.id === me ? <Chip tone="ink">You</Chip> : null}
                    </div>
                  </td>
                  <td className="border-t border-line py-3 pr-4 align-middle">
                    <div className="flex flex-wrap gap-1.5">
                      {cards.length ? cards.map((c) => <FaceCard key={c.id} card={c} size="sm" />) : <span className="text-[13px] text-ink-3">No cards</span>}
                    </div>
                  </td>
                  <td className={`tnum border-t border-line py-3 text-right align-middle text-[18px] font-semibold ${won ? "text-accent-ink" : ""}`}>{score}</td>
                  <td className="tnum border-t border-line py-3 text-right align-middle text-[15px] text-ink-2">{totals.get(player.id)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
