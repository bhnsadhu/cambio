"use client";

import { useEffect, useRef, useState } from "react";
import type { EventKind, EventWeight, LogEntry, PlayerPublic } from "@/lib/game/types";
import { PlayerName } from "./ui";

/**
 * What just happened, said out loud.
 *
 * The log is the event stream: every entry carries who moved, whose cards it
 * touched, which cards to highlight and how loudly to say it. This turns that
 * into one announcement at a time — a standard notice for a look or a swap, a
 * big one for the moments that change the round — so a player who is not
 * acting can still follow every card and every person.
 */

/** How long an announcement holds the screen when nothing is behind it. */
const MAX_HOLD: Record<EventWeight, number> = { quiet: 0, normal: 2600, loud: 3400 };
/** How long it holds when something else is already waiting its turn. */
const MIN_HOLD = 1200;

/** The kind of move, named. This is the label a player reads first. */
export const KICKER: Record<EventKind, string> = {
  table: "Table",
  deal: "Shuffle and deal",
  draw: "Draw",
  place: "Placed",
  swap: "Swap",
  peekOwn: "Look",
  peekOther: "Look",
  blindSwap: "Blind swap",
  kingLook: "King: looking",
  kingSwap: "King: swap",
  kingLeave: "King: left alone",
  skipPower: "Passed",
  stick: "Stick",
  stickMiss: "Missed stick",
  give: "Card owed",
  cambio: "Cambio",
  zero: "Out of cards",
  timeout: "Out of time",
  reshuffle: "Deck",
  pause: "Pause",
  roundEnd: "Round over",
  replay: "Next round",
};

export interface Announcement {
  entry: LogEntry;
  /** the cards to light up in every hand while this is on screen */
  cardIds: Set<string>;
}

/**
 * Plays the log's announceable entries in order, one at a time. A burst of
 * moves shortens each hold rather than dropping any of them, so the table
 * never gets ahead of its own commentary.
 */
interface Playhead {
  current: LogEntry | null;
  queue: LogEntry[];
  /** the last sequence number taken off the log; null until the first render */
  seen: number | null;
}

const IDLE: Playhead = { current: null, queue: [], seen: null };

function hold(head: Playhead): number {
  if (!head.current) return 0;
  return head.queue.length ? MIN_HOLD : MAX_HOLD[head.current.weight ?? "normal"];
}

function advance(head: Playhead): Playhead {
  const [next, ...rest] = head.queue;
  return { ...head, current: next ?? null, queue: rest };
}

export function useAnnouncements(log: LogEntry[], enabled: boolean, liveFromMount = false): Announcement | null {
  const [head, setHead] = useState<Playhead>(IDLE);
  // When the announcement on screen went up. A move arriving behind it
  // shortens its stay rather than restarting it.
  const shown = useRef<{ seq: number; at: number } | null>(null);

  // Derived from the log during render, the way the flight layer derives
  // motion: entries already on screen when this mounts are history, not news.
  const latest = log.length ? log[log.length - 1].seq : 0;
  if (!enabled) {
    if (head.current || head.queue.length || head.seen !== null) setHead(IDLE);
  } else if (head.seen === null) {
    // A table joined mid round treats everything already written as history.
    // A table that mounts *because* the round just started does not: the deal
    // is the entry that ended the lobby, it lands before this hook ever runs,
    // and it is the first thing the round has to say.
    setHead({ ...IDLE, seen: liveFromMount && log.length ? log[log.length - 1].seq - 1 : latest });
  } else if (latest > head.seen) {
    // Pause already has a live banner and overlay. Replaying its old log
    // messages after a quick resume would incorrectly say play is paused.
    const fresh = log.filter((e) => e.seq > head.seen! && e.kind !== "pause" && (e.weight ?? "quiet") !== "quiet");
    const queued: Playhead = { ...head, seen: latest, queue: [...head.queue, ...fresh] };
    setHead(queued.current ? queued : advance(queued));
  }

  useEffect(() => {
    const cur = head.current;
    if (!cur) { shown.current = null; return; }
    if (shown.current?.seq !== cur.seq) shown.current = { seq: cur.seq, at: Date.now() };
    const left = Math.max(0, shown.current.at + hold(head) - Date.now());
    const id = window.setTimeout(() => setHead(advance), left);
    return () => window.clearTimeout(id);
  }, [head]);

  if (!head.current) return null;
  return { entry: head.current, cardIds: new Set(head.current.cardIds ?? []) };
}

/**
 * The rest of a sentence once the actor's name has been lifted off the front
 * of it. Spoken to the player who made the move, the verb and the possessive
 * move with it: "Cami is out of cards" becomes "You are out of cards", and
 * "their own 3rd card" becomes "your own 3rd card". The engine only ever
 * writes "their" about the player who moved, so this is safe to do wholesale.
 */
export function restOfSentence(text: string, name: string, asYou: boolean): string {
  const rest = text.slice(name.length);
  if (!asYou) return rest;
  return (rest.startsWith(" is ") ? ` are ${rest.slice(4)}` : rest).replace(/\btheir\b/g, "your");
}

/** The actor's name, set apart from the rest of the sentence. */
function Sentence({ entry, players }: { entry: LogEntry; players: PlayerPublic[] }) {
  const actor = players.find((p) => p.id === entry.actorId) ?? null;
  if (actor && entry.text.startsWith(actor.name)) {
    return (
      <>
        <span className="font-semibold text-ink"><PlayerName name={actor.name} isBot={actor.isBot} /></span>
        {restOfSentence(entry.text, actor.name, false)}
      </>
    );
  }
  return <>{entry.text}</>;
}

/**
 * A routine move: a line at the middle of the table, where everyone is
 * already looking, naming the kind of move and who it happened to.
 */
export function Announcer({ announcement, players, me }: { announcement: Announcement | null; players: PlayerPublic[]; me: string | null }) {
  if (!announcement || announcement.entry.weight === "loud") return null;
  const { entry } = announcement;
  const touched = players.filter((p) => (entry.subjectIds ?? []).includes(p.id));
  const tone = entry.tone === "bad" ? "text-red" : entry.tone === "accent" || entry.tone === "good" ? "text-accent" : "text-ink-3";
  return (
    <div
      key={entry.seq}
      className="animate-rise flex w-full max-w-[680px] flex-wrap items-center gap-3 rounded-panel bg-surface-2 px-5 py-3 shadow-float sm:gap-4"
      role="status"
    >
      <span className={`t-caption shrink-0 ${tone}`}>{KICKER[entry.kind]}</span>
      <span className="h-6 w-px shrink-0 bg-line-strong" />
      <p className="t-callout text-ink-2">
        <Sentence entry={entry} players={players} />
      </p>
      {touched.length ? (
        <span className="ml-auto flex max-w-full flex-wrap items-center gap-1.5">
          {touched.map((p) => (
            <span key={p.id} className="inline-flex h-[22px] items-center rounded-full bg-accent-soft px-2 text-[11.5px] font-medium text-accent-ink">
              {p.id === me ? "You" : <PlayerName name={p.name} isBot={p.isBot} />}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A moment worth stopping for: Cambio, a swap in the final turns, a player
 * out of cards, the table going dark. It takes the middle of the table, where
 * the standard notice goes, at four times the size — out of the layout so it
 * cannot move a card, and out of the way of a click so it cannot block one.
 */
export function BigMoment({ announcement, players, me }: { announcement: Announcement | null; players: PlayerPublic[]; me: string | null }) {
  if (!announcement || announcement.entry.weight !== "loud") return null;
  const { entry } = announcement;
  const actor = players.find((p) => p.id === entry.actorId) ?? null;
  const mine = !!me && entry.actorId === me;
  const tone = entry.tone === "bad" ? "text-red" : "text-accent";
  return (
    <div className="pointer-events-none w-full max-w-[620px] xl:absolute xl:left-1/2 xl:top-1/2 xl:z-30 xl:w-max xl:max-w-[min(620px,90%)] xl:-translate-x-1/2 xl:-translate-y-1/2" aria-live="polite">
      <div key={entry.seq} className="animate-pop rounded-panel bg-surface-2/95 px-5 py-4 text-center shadow-float backdrop-blur-sm hairline-strong sm:px-9 sm:py-7">
        <p className={`t-caption ${tone}`}>{KICKER[entry.kind]}</p>
        <p className="t-title2 mt-2.5 text-ink">
          {actor && entry.text.startsWith(actor.name) ? (
            <span className="font-semibold">{mine ? "You" : <PlayerName name={actor.name} isBot={actor.isBot} />}</span>
          ) : null}
          {headline(entry, actor?.name ?? null, mine)}
        </p>
      </div>
    </div>
  );
}

/** The sentence with the actor's name lifted out of the front of it. */
function headline(entry: LogEntry, actorName: string | null, mine: boolean): string {
  if (actorName && entry.text.startsWith(actorName)) return restOfSentence(entry.text, actorName, mine);
  return entry.text;
}
