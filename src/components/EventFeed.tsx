"use client";

import { useEffect, useRef } from "react";
import type { LogEntry, PlayerPublic } from "@/lib/game/types";
import { KICKER, restOfSentence } from "./Announcements";
import { PlayerName } from "./ui";

/**
 * The story of the round, in order.
 *
 * Every line names who moved and which card it happened to, so the log can be
 * read on its own to work out how a hand got to where it is. Hovering a line
 * lights the cards it is about, wherever they have ended up since.
 */
export function EventFeed({
  log,
  players,
  me,
  onTrace,
}: {
  log: LogEntry[];
  players: PlayerPublic[];
  me: string | null;
  onTrace: (cardIds: string[]) => void;
}) {
  const ref = useRef<HTMLOListElement>(null);
  const lastSeq = log[log.length - 1]?.seq;
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [lastSeq]);

  // Nothing is traced once the feed is left, whichever line the cursor exits.
  useEffect(() => () => onTrace([]), [onTrace]);

  return (
    <aside className="order-5 flex max-h-72 min-h-0 min-w-0 flex-1 flex-col rounded-panel bg-surface hairline lg:max-h-none" aria-label="Table log">
      <header className="px-4 pt-4 pb-3">
        <h3 className="t-headline">Table log</h3>
        <p className="t-footnote mt-0.5 hidden text-ink-3 lg:block">Hover a move to find its cards</p>
      </header>
      {log.length === 0 ? (
        <p className="t-sub px-4 pb-5 text-ink-3">Quiet so far. Moves show up here as they happen.</p>
      ) : (
        <ol ref={ref} className="flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-4 pb-5" onMouseLeave={() => onTrace([])}>
          {log.map((e) => (
            <Line key={e.seq} entry={e} players={players} me={me} onTrace={onTrace} />
          ))}
        </ol>
      )}
    </aside>
  );
}

function Line({
  entry,
  players,
  me,
  onTrace,
}: {
  entry: LogEntry;
  players: PlayerPublic[];
  me: string | null;
  onTrace: (cardIds: string[]) => void;
}) {
  const cards = entry.cardIds ?? [];
  const actor = players.find((p) => p.id === entry.actorId) ?? null;
  const loud = entry.weight === "loud";
  const tone =
    entry.tone === "accent" ? "text-accent-ink" :
    entry.tone === "bad" ? "text-ink" :
    entry.tone === "good" ? "text-ink" :
    "text-ink-2";
  // A line about cards that are still on the table can be pointed at.
  const traceable = cards.some((id) => players.some((p) => p.hand.includes(id)));

  return (
    <li
      className={[
        "animate-fade -mx-2 rounded-[10px] px-2 py-1 transition-colors duration-150",
        loud ? "border-l-2 border-accent pl-2.5" : "",
        traceable ? "cursor-help hover:bg-surface-2" : "",
      ].join(" ")}
      onMouseEnter={traceable ? () => onTrace(cards) : undefined}
      onMouseLeave={traceable ? () => onTrace([]) : undefined}
    >
      {loud ? <p className="t-caption mb-0.5 text-accent">{KICKER[entry.kind]}</p> : null}
      <p className={`t-sub ${tone}`}>
        {actor && entry.text.startsWith(actor.name) ? (
          <>
            <span className="font-semibold text-ink">
              {actor.id === me ? "You" : <PlayerName name={actor.name} isBot={actor.isBot} />}
            </span>
            {restOfSentence(entry.text, actor.name, actor.id === me)}
          </>
        ) : (
          entry.text
        )}
      </p>
    </li>
  );
}
