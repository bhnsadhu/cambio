"use client";

import { useEffect, useRef, useState } from "react";
import type { EventKind, EventWeight, LogEntry, PlayerPublic } from "@/lib/game/types";
import { PlayerName } from "./ui";
import { Notification } from "./Notification";

/**
 * What just happened, said out loud.
 *
 * The log is the event stream: every entry carries who moved, whose cards it
 * touched, which cards to highlight and how loudly to say it. This turns that
 * into one announcement at a time, with a longer hold for the moments
 * that change the round — so a player who is not
 * acting can still follow every card and every person.
 */

/** How long an announcement holds the screen when nothing is behind it. */
const MAX_HOLD: Record<EventWeight, number> = { quiet: 0, normal: 2600, loud: 3400 };
/** How long it holds when something else is already waiting its turn. */
const MIN_HOLD = 1200;

/** The kind of move, named. This is the label a player reads first. */
export const KICKER: Record<EventKind, string> = {
  table: "Table",
  kick: "Player removed",
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
    // Keep the first, loud shuffle/deal notice. The later opening-peek notice
    // is already covered by the live reveal banner and should not repeat it.
    const fresh = log.filter((e) => e.seq > head.seen! && e.kind !== "pause" && !(e.kind === "deal" && e.weight === "normal") && (e.weight ?? "quiet") !== "quiet");
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
function Sentence({ entry, players, me }: { entry: LogEntry; players: PlayerPublic[]; me: string | null }) {
  const actor = players.find((p) => p.id === entry.actorId) ?? null;
  const asYou = entry.weight === "loud" && actor?.id === me;
  if (actor && entry.text.startsWith(actor.name)) {
    return (
      <>
        <span className="font-semibold text-ink">{asYou ? "You" : <PlayerName name={actor.name} isBot={actor.isBot} />}</span>
        {restOfSentence(entry.text, actor.name, asYou)}
      </>
    );
  }
  return <>{entry.text}</>;
}

/** Every move uses the same surface; major moments stay visible longer. */
export function Announcer({ announcement, players, me }: { announcement: Announcement | null; players: PlayerPublic[]; me: string | null }) {
  if (!announcement) return null;
  const { entry } = announcement;
  const touched = players.filter((p) => (entry.subjectIds ?? []).includes(p.id));
  const tone = entry.tone === "bad" ? "bad" : entry.tone === "good" || entry.tone === "accent" ? "good" : "neutral";
  return <Notification key={entry.seq} title={KICKER[entry.kind]} tone={tone} kind={entry.kind === "stick" || entry.kind === "stickMiss" ? "stick" : "game"} label="Game event">
    <p><Sentence entry={entry} players={players} me={me} /></p>
    {touched.length ? <p className="mt-1.5 text-[11px] text-ink-3">
      {touched.map((p, index) => <span key={p.id}>{index ? " · " : ""}{p.id === me ? "You" : <PlayerName name={p.name} isBot={p.isBot} />}</span>)}
    </p> : null}
  </Notification>;
}
