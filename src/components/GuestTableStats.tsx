import type { PublicView } from "@/lib/game/types";
import { tableStats } from "@/lib/game/table-stats";

export function GuestTableStats({ view, playerId }: { view: PublicView; playerId: string }) {
  const stats = tableStats(view.results, playerId);
  const items = [
    ["Completed rounds", stats.roundsPlayed], ["Rounds won", stats.roundsWon], ["Best hand", stats.bestScore],
    ["Sticks landed", stats.sticksHit], ["Cambio calls", stats.cambioCalls], ["Cambio wins", stats.cambioWins],
  ] as const;

  return <section aria-label="Your stats at this table" className="min-w-0 border-t border-line pt-5">
    <h3 className="t-headline">This table</h3>
    {stats.roundsPlayed ? <>
      <p className="t-footnote mt-1 text-ink-3">Completed rounds in your current seat. Tied wins count.</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map(([label, value]) => <div key={label} className="flex min-w-0 flex-col-reverse justify-end gap-1 rounded-xl bg-surface-2 p-3">
          <dt className="text-[11px] leading-4 text-ink-3">{label}</dt>
          <dd className="tnum break-words text-[23px] font-medium leading-7">{value}</dd>
        </div>)}
      </dl>
    </> : <p className="t-sub mt-2 text-ink-2">Finish a round to see your table stats here.</p>}
    <p className="t-footnote mt-3 text-ink-3">These results stay with this table. They are not a saved guest record.</p>
  </section>;
}
