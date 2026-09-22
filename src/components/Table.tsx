"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useClock } from "@/lib/client/useClock";
import type { Action, Card, PlayerPublic, PlayerView, PowerKind } from "@/lib/game/types";
import { shortLabel } from "@/lib/game/cards";
import type { GameHook } from "@/lib/client/useGame";
import { usePositions } from "@/lib/client/positions";
import { setPref, usePrefs } from "@/lib/client/prefs";
import { Announcer, BigMoment, useAnnouncements } from "./Announcements";
import { PlayerPanel } from "./PlayerPanel";
import { Piles } from "./Piles";
import { EventFeed } from "./EventFeed";
import { RevealBanner } from "./RevealBanner";
import { PauseBanner } from "./Pause";
import { Scoreboard } from "./Scoreboard";
import type { useFlights } from "./FlightLayer";
import { FaceCard } from "./cards";
import { Button, PlayerName } from "./ui";

type Mode =
  | { kind: "none" }
  | { kind: "give"; to: PlayerPublic }
  | { kind: "power"; power: PowerKind; lookedDone: boolean }
  | { kind: "decide" }
  | { kind: "stick" };

export function Table({ game, flights, onLeave }: { game: GameHook; flights: ReturnType<typeof useFlights>; onLeave: () => void }) {
  const view = game.view!;
  const pub = view.public;
  const me = game.me;
  const positions = usePositions();
  const prefs = usePrefs();
  const { hidden } = flights;
  const [sel, setSel] = useState<{ cardId: string; key: string } | null>(null);
  /** cards the log is pointing at, while a line in the feed is hovered */
  const [traced, setTraced] = useState<string[]>([]);

  // Shuffle, deal, then look. Nothing is revealed until the last card is down,
  // so the deal never reads as a fresh hand arriving after the peek.
  const settling = pub.phase === "ready" || pub.phase === "peek";
  const dealTick = useClock(120, settling && !pub.paused);
  const dealing =
    settling &&
    pub.dealingUntil !== null &&
    (pub.paused ? (pub.pausedAt ?? 0) : dealTick + game.skew) < pub.dealingUntil;

  const mine = pub.players.find((p) => p.id === me) ?? null;
  const turnPlayer = pub.turn ? pub.players.find((p) => p.id === pub.turn!.playerId) ?? null : null;

  const myTurn = !!mine && pub.turn?.playerId === mine.id;
  const owner = (cardId: string) => pub.players.find((p) => p.hand.includes(cardId)) ?? null;

  /**
   * Sticking is an anytime action and never waits on whose turn it is, so it
   * is tracked apart from the turn's own mode: it is open whenever the rules
   * say it is, including while this player is drawing, deciding or resolving
   * a power. (Mirrors `canStick` in the engine.)
   */
  const stickOpen = useMemo(() => {
    if (!mine || pub.paused) return false;
    if (pub.phase !== "playing" && pub.phase !== "final") return false;
    return !!pub.discardTop && mine.cardCount > 0 && !pub.pendingGives.some((g) => g.from === mine.id);
  }, [mine, pub]);

  const mode: Mode = useMemo(() => {
    if (!mine) return { kind: "none" };
    if (pub.phase !== "playing" && pub.phase !== "final") return { kind: "none" };
    const give = pub.pendingGives.find((g) => g.from === mine.id);
    if (give) return { kind: "give", to: pub.players.find((p) => p.id === give.to)! };
    if (pub.pendingPower && pub.pendingPower.playerId === mine.id) {
      return { kind: "power", power: pub.pendingPower.kind, lookedDone: pub.pendingPower.lookedDone };
    }
    if (myTurn && pub.turn?.stage === "decide") return { kind: "decide" };
    if (stickOpen) return { kind: "stick" };
    return { kind: "none" };
  }, [mine, pub, myTurn, stickOpen]);

  /**
   * When the turn already owns the click — a card to place, a power to use, a
   * debt to pay — sticking is armed first, so one click cannot mean two
   * things. With nothing else to do, cards stick on the first click.
   */
  // Keyed by the card on the pile, so an arm never outlives the rank it was
  // aimed at: the next card down disarms it without an effect.
  const [armedAt, setArmedAt] = useState<string | null>(null);
  const armed = stickOpen && !!pub.discardTop && armedAt === pub.discardTop.id;
  const setArmed = (on: boolean) => setArmedAt(on && pub.discardTop ? pub.discardTop.id : null);
  const stickNeedsArming = stickOpen && mode.kind !== "stick";
  const acting: Mode = armed && stickOpen ? { kind: "stick" } : mode;

  // A selection only survives inside the mode it was made in.
  const modeKey = acting.kind === "power" ? `power:${acting.power}:${acting.lookedDone}` : acting.kind;
  const selected = sel && sel.key === modeKey ? sel.cardId : null;
  const setSelected = (cardId: string | null) => setSel(cardId ? { cardId, key: modeKey } : null);

  // Cards this viewer may see right now, shown turned over on the table.
  // A timer marks each reveal expired a beat before its deadline, so the
  // tiles turn back with one render rather than on a ticking clock.
  // Keyed by deadline as well as id: a pause pushes every reveal's deadline
  // forward, and the peek that was running has to come back when play does.
  const [expired, setExpired] = useState<Set<string>>(() => new Set());
  const revealed = useMemo(() => {
    const m = new Map<string, Card>();
    if (dealing) return m; // the cards are still landing; nobody looks yet
    for (const r of view.private?.reveals ?? []) {
      if (expired.has(`${r.id}:${r.until}`)) continue;
      for (const c of r.cards) m.set(c.id, c);
    }
    return m;
  }, [view, expired, dealing]);
  useEffect(() => {
    if (pub.paused) return; // reveals are held for the length of the pause
    const now = Date.now() + game.skew;
    const timers = (view.private?.reveals ?? [])
      .filter((r) => r.kind !== "kingLook")
      .map((r) => {
        const key = `${r.id}:${r.until}`;
        return window.setTimeout(() => setExpired((cur) => (cur.has(key) ? cur : new Set(cur).add(key))), Math.max(0, r.until - 150 - now));
      });
    return () => { for (const t of timers) window.clearTimeout(t); };
  }, [view, game.skew, pub.paused]);

  // One time hints, taught in context.
  const peekHint = pub.phase === "peek" && !prefs.sawPeekHint && !!mine;
  const powerHint = mode.kind === "power" && !prefs.sawPowerHint;
  const prevPhase = useRef(pub.phase);
  const prevMode = useRef(mode.kind);
  useEffect(() => {
    if (prevPhase.current === "peek" && pub.phase !== "peek") setPref("sawPeekHint", true);
    prevPhase.current = pub.phase;
  }, [pub.phase]);
  useEffect(() => {
    if (prevMode.current === "power" && mode.kind !== "power") setPref("sawPowerHint", true);
    prevMode.current = mode.kind;
  }, [mode.kind]);

  /**
   * The two-card powers pick the same way: any card starts the pair, and only
   * a card belonging to a different player can finish it.
   */
  const pairCue = (cardId: string, label: string): string | null => {
    if (!selected) return label;
    if (cardId === selected) return "Undo";
    return owner(selected)?.id === owner(cardId)?.id ? null : label;
  };

  const cueFor = (cardId: string): string | null => {
    if (!mine || game.busy) return null;
    const own = mine.hand.includes(cardId);
    switch (acting.kind) {
      case "give": return own ? "Give" : null;
      // The drawn card can go into any hand. Your own slot takes it on one
      // click; someone else's asks for a second, since it costs them the card.
      case "decide": return own ? "Swap" : cardId === selected ? "Confirm" : "Push";
      case "stick": return "Stick";
      case "power": {
        if (acting.lookedDone) return null;
        switch (acting.power) {
          case "peekOwn": return own ? "Peek" : null;
          case "peekOther": return own ? null : "Peek";
          case "blindSwap": return pairCue(cardId, selected ? "Swap with" : "Swap");
          case "kingLook": return pairCue(cardId, "Look");
        }
      }
      default: return null;
    }
  };

  const fire = async (action: Action) => {
    setSelected(null);
    setArmed(false);
    const res = await game.send(action);
    if (res?.note?.kind === "stick") game.toast(res.note.correct ? "Stuck." : "Not a match. Penalty card drawn.", res.note.correct ? "good" : "bad");
  };

  /** Picks the second half of a pair, or starts one. */
  const onPair = (cardId: string, fireWith: (a: string, b: string) => void) => {
    if (!selected) { setSelected(cardId); return; }
    if (cardId === selected) { setSelected(null); return; }
    if (owner(selected)?.id === owner(cardId)?.id) return;
    fireWith(selected, cardId);
  };

  const onCard = (cardId: string) => {
    if (!mine || game.busy) return;
    const own = mine.hand.includes(cardId);
    switch (acting.kind) {
      case "give": if (own) void fire({ type: "give", cardId }); return;
      case "decide":
        if (own) { void fire({ type: "swap", cardId }); return; }
        if (cardId === selected) { void fire({ type: "swap", cardId }); return; }
        setSelected(cardId);
        return;
      case "stick": void fire({ type: "stick", cardId }); return;
      case "power":
        switch (acting.power) {
          case "peekOwn": if (own) void fire({ type: "peekOwn", cardId }); return;
          case "peekOther": if (!own) void fire({ type: "peekOther", cardId }); return;
          case "blindSwap": onPair(cardId, (a, b) => void fire({ type: "blindSwap", cardIdA: a, cardIdB: b })); return;
          case "kingLook": onPair(cardId, (a, b) => void fire({ type: "kingLook", cardIdA: a, cardIdB: b })); return;
        }
    }
  };

  // One announcement at a time, and the cards it is about lit in every hand.
  // The scoreboard tells the story of the round itself, so the announcer
  // stands down while it is up.
  const announcement = useAnnouncements(pub.log, pub.phase !== "lobby" && pub.phase !== "scoring");
  const spotlit = useMemo(() => {
    const ids = new Set<string>(traced);
    for (const id of announcement?.cardIds ?? []) ids.add(id);
    return ids;
  }, [announcement, traced]);
  const spotlitPlayers = useMemo(() => {
    const ids = new Set<string>();
    if (announcement) {
      if (announcement.entry.actorId) ids.add(announcement.entry.actorId);
      for (const id of announcement.entry.subjectIds ?? []) ids.add(id);
    }
    return ids;
  }, [announcement]);

  // The ready check runs at the dealt table: cards are down, face down, and
  // the round waits on the last seat to say it is in.
  const readyCheck = pub.phase === "ready";
  const imReady = !!mine && pub.readyIds.includes(mine.id);
  const waitingOn = pub.players.filter((p) => !pub.readyIds.includes(p.id));

  const status = readyCheck
    ? {
        title: imReady
          ? (waitingOn.length
              ? <>Waiting on {waitingOn.map((p) => p.name).join(", ")}.</>
              : <>Everyone is ready.</>)
          : "Cards are down. Ready when you are.",
        detail: imReady
          ? "The peek opens for the whole table at once, the moment the last seat is in."
          : "Your four cards are dealt, face down. Say you are ready, and once everyone has, you all get five seconds to memorise your bottom two.",
      }
    : armed && pub.discardTop
    ? {
        title: <>Sticking. Pick the card you believe is a {pub.discardTop.rank === "JOKER" ? "joker" : pub.discardTop.rank}.</>,
        detail: <>Any hand at the table. Miss and you draw a penalty; cancel to go back to your turn.</>,
      }
    : describeStatus(view, mine, turnPlayer, acting, selected, powerHint, dealing);
  const showDrawnSlot = myTurn && (pub.turn?.stage === "draw" || pub.turn?.stage === "decide");
  const drawn = view.private?.drawnCard ?? null;

  return (
    <div className="grid h-[calc(100vh-56px)] grid-cols-[minmax(0,1fr)_240px] gap-5 pb-6">
      <div className="flex min-h-0 flex-col gap-5">
        <div className="grid grid-cols-[repeat(4,minmax(0,1fr))_auto] gap-4">
          {pub.players.map((p) => (
            <PlayerPanel
              key={p.id}
              player={p}
              isMe={p.id === me}
              isTurn={pub.turn?.playerId === p.id}
              turnStage={pub.turn?.playerId === p.id ? pub.turn.stage : null}
              isCaller={pub.cambio?.callerId === p.id}
              owesCard={pub.pendingGives.some((g) => g.from === p.id)}
              cueFor={cueFor}
              selectedCardId={selected}
              onCard={onCard}
              revealed={revealed}
              hidden={hidden}
              spotlit={spotlit}
              inTheSpotlight={spotlitPlayers.has(p.id)}
              holding={pub.turn?.playerId === p.id && pub.turn.stage === "decide" && p.id !== me}
              ready={readyCheck ? pub.readyIds.includes(p.id) : null}
              positions={positions}
            />
          ))}
          <Piles
            deckCount={pub.deckCount}
            discardTop={pub.discardTop}
            discardCount={pub.discardCount}
            canDraw={myTurn && pub.turn?.stage === "draw" && !game.busy}
            onDraw={() => void fire({ type: "draw" })}
            hideDiscard={hidden.has("discard")}
            positions={positions}
          />
        </div>

        {/* The middle of the table: timed reveals and an open pause request
            live here, between the hands and the actions. */}
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
          <BigMoment announcement={announcement} players={pub.players} me={me} />
          <PauseBanner view={pub} me={me} busy={game.busy} onVote={(agree) => void game.send({ type: "pauseVote", agree })} />
          <Announcer announcement={announcement} players={pub.players} me={me} />
          {dealing ? null : (
            <RevealBanner
              view={view}
              skew={game.skew}
              busy={game.busy}
              hint={peekHint ? "These two are yours. When the timer ends they turn back over and stay that way." : null}
              onKingDecide={(swap) => void fire({ type: "kingDecide", swap })}
            />
          )}
        </div>

        {/* Action bar */}
        <div className="flex min-h-[92px] items-center justify-between gap-6 rounded-panel bg-surface px-5 py-4 hairline">
          <div className="flex items-center gap-5">
            {showDrawnSlot ? (
              <div ref={positions.register("drawn")} className="h-[var(--tile-h)] w-[var(--tile-w)] shrink-0">
                {drawn && !hidden.has("drawn") ? (
                  <FaceCard key={drawn.id} card={drawn} size="lg" className="animate-flip-in shadow-lift" />
                ) : (
                  <div className="h-full w-full rounded-[var(--tile-r)] border-[1.5px] border-dashed border-line-strong" />
                )}
              </div>
            ) : null}
            <div>
              <p className="t-headline">{status.title}</p>
              {status.detail ? <p className="t-callout mt-0.5 text-ink-2">{status.detail}</p> : null}
            </div>
          </div>
          <div className="flex items-center gap-4">
            {pub.turnDeadline !== null ? <TurnTimer deadline={pub.turnDeadline} skew={game.skew} mine={myTurn} frozenAt={pub.paused ? pub.pausedAt : null} /> : null}
            {readyCheck && mine ? (
              <>
                <span className="t-sub text-ink-3">
                  {pub.readyIds.length} of {pub.players.length} ready
                </span>
                <Button
                  variant={imReady ? "secondary" : "primary"}
                  size="lg"
                  disabled={game.busy || imReady}
                  onClick={() => void game.send({ type: "ready" })}
                >
                  {imReady ? "You are ready" : "I'm ready"}
                </Button>
              </>
            ) : null}
            {/* Sticking is always on the table. While the turn already owns
                the click, it is armed first so one click cannot mean two
                things. */}
            {mine && armed ? (
              <Button variant="ghost" disabled={game.busy} onClick={() => setArmed(false)}>Cancel the stick</Button>
            ) : mine && stickNeedsArming ? (
              <Button variant="secondary" disabled={game.busy} onClick={() => { setSelected(null); setArmed(true); }}>
                Stick a card
              </Button>
            ) : null}
            {!armed && mine && myTurn && pub.turn?.stage === "draw" ? (
              <>
                {pub.phase === "playing" ? (
                  <Button variant="accent" disabled={game.busy} onClick={() => void fire({ type: "callCambio" })}>Call Cambio</Button>
                ) : null}
                <Button variant="primary" size="lg" disabled={game.busy} onClick={() => void fire({ type: "draw" })}>Draw</Button>
              </>
            ) : null}
            {!armed && mine && mode.kind === "decide" && selected ? (
              <>
                <Button variant="ghost" disabled={game.busy} onClick={() => setSelected(null)}>Cancel</Button>
                <Button variant="accent" size="lg" disabled={game.busy} onClick={() => void fire({ type: "swap", cardId: selected })}>
                  Push it onto {owner(selected)?.name ?? "them"}
                </Button>
              </>
            ) : null}
            {!armed && mine && mode.kind === "decide" && !selected ? (
              <Button variant="primary" size="lg" disabled={game.busy} onClick={() => void fire({ type: "place" })}>
                Place {drawn ? shortLabel(drawn) : ""} on the pile
              </Button>
            ) : null}
            {!armed && mine && mode.kind === "power" && !mode.lookedDone ? (
              <Button variant="ghost" disabled={game.busy} onClick={() => void fire({ type: "skipPower" })}>Skip the power</Button>
            ) : null}
            {!armed && mine && mode.kind === "power" && mode.lookedDone ? (
              <>
                <Button variant="ghost" disabled={game.busy} onClick={() => void fire({ type: "kingDecide", swap: false })}>Leave them</Button>
                <Button variant="accent" disabled={game.busy} onClick={() => void fire({ type: "kingDecide", swap: true })}>Swap them</Button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <EventFeed log={pub.log} players={pub.players} me={me} onTrace={setTraced} />

      {pub.phase === "scoring" ? (
        <Scoreboard
          view={pub}
          me={me}
          busy={game.busy}
          onPlayAgain={() => void game.send({ type: "playAgain" })}
          onLeave={onLeave}
        />
      ) : null}
    </div>
  );
}

/** Thirty seconds per human turn. Quiet until the last ten, stopped when the table is. */
function TurnTimer({ deadline, skew, mine, frozenAt }: { deadline: number; skew: number; mine: boolean; frozenAt: number | null }) {
  const tick = useClock(250, frozenAt === null);
  if (frozenAt === null && tick === 0) return null;
  const left = Math.max(0, deadline - (frozenAt ?? tick + skew));
  const secs = Math.ceil(left / 1000);
  const urgent = left < 10_000 && frozenAt === null;
  return (
    <div className="flex items-center gap-2" aria-label={`${secs} seconds left on this turn`}>
      <span className={`t-money text-[15px] ${urgent ? "text-accent" : "text-ink-3"}`}>{secs}s</span>
      <span className="h-[3px] w-12 overflow-hidden rounded-full bg-white/10">
        <span className={`block h-full rounded-full ${urgent ? "bg-accent" : "bg-ink-3"}`} style={{ width: `${Math.min(100, (left / 30_000) * 100)}%`, transition: "width 250ms linear" }} />
      </span>
      {mine && urgent ? <span className="t-footnote text-ink-3">or the turn is skipped</span> : null}
    </div>
  );
}

/** 1st, 2nd, 3rd, 4th — the same way the table log names a slot. */
function ordinalSuffix(n: number): string {
  return n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
}

function describeStatus(
  view: PlayerView,
  mine: PlayerPublic | null,
  turnPlayer: PlayerPublic | null,
  mode: Mode,
  selected: string | null,
  powerHint: boolean,
  dealing: boolean,
): { title: React.ReactNode; detail?: React.ReactNode } {
  const pub = view.public;
  const name = (p: PlayerPublic | null) => (p ? <PlayerName name={p.name} isBot={p.isBot} /> : "Someone");
  const holder = (cardId: string | null) => (cardId ? pub.players.find((p) => p.hand.includes(cardId)) ?? null : null);
  const slotOf = (cardId: string | null) => {
    const p = holder(cardId);
    return p && cardId ? p.hand.indexOf(cardId) + 1 : 0;
  };
  const topRank = pub.discardTop ? (pub.discardTop.rank === "JOKER" ? "joker" : pub.discardTop.rank) : null;
  const stickHint = topRank && mine && mine.cardCount > 0
    ? <>Sticking is open. Click any card you believe is a {topRank}, in any hand.</>
    : null;
  const firstPower = powerHint ? " This is your first power. Powers only fire when you place the drawn card. Swapping it in gives them up." : "";

  if (dealing) {
    return { title: "Shuffling and dealing.", detail: "Four cards each. You get to look at two of them once they are down." };
  }
  if (pub.phase === "peek") {
    return { title: "Memorize your bottom two cards.", detail: mine ? "Play starts when the timer ends." : "Play starts in a few seconds." };
  }
  if (pub.phase === "scoring") return { title: "Round over." };
  if (!mine) return { title: <>Watching. {name(turnPlayer)} is up.</>, detail: "Open your own table from the top of the page." };

  switch (mode.kind) {
    case "give":
      return { title: <>Good stick. Hand {name(mode.to)} one of your cards.</>, detail: "Click the card to give. They will not see it." };
    case "decide": {
      if (selected) {
        const p = holder(selected);
        return {
          title: <>Push it onto {name(p)}?</>,
          detail: <>Their {slotOf(selected)}{ordinalSuffix(slotOf(selected))} card is discarded and they are left holding whatever you drew. Click it again, or confirm.</>,
        };
      }
      return {
        title: "Keep it, place it, or hand it on?",
        detail: "Click one of your own cards to swap it in, or any other player's card to push it onto them. Either way the card's power is lost. Or place it on the pile and use the power.",
      };
    }
    case "power":
      switch (mode.power) {
        case "peekOwn": return { title: "Look at one of your own cards.", detail: `Click a card in your hand. You see it for a few seconds.${firstPower}` };
        case "peekOther": return { title: "Look at someone else's card.", detail: `Click any card in another player's hand.${firstPower}` };
        case "blindSwap": return selected
          ? { title: <>Now pick a card from a different player than {name(holder(selected))}.</>, detail: "The two trade places. Nobody sees either card, yourself included." }
          : { title: "Blind swap. Pick any card on the table.", detail: `Then pick one from a different player. They trade without looking. The pair does not have to include you.${firstPower}` };
        case "kingLook": return mode.lookedDone
          ? { title: "You have seen both cards.", detail: "Swap them, or leave them." }
          : selected
            ? { title: <>Pick a second card from a different player than {name(holder(selected))}.</>, detail: "You see both, then decide whether to swap them." }
            : { title: "Black king. Look at any two cards from two different players.", detail: `Then choose whether to swap them.${firstPower}` };
      }
    default: break;
  }

  if (pub.turn?.playerId === mine.id && pub.turn.stage === "draw") {
    return pub.phase === "final"
      ? { title: "Your last turn.", detail: "Draw from the deck, then keep or place the card." }
      : { title: "Your turn.", detail: "Draw from the deck, or call Cambio to make this the final round." };
  }
  // Every final turn is spent, but a card on the table still matches the
  // pile: the round holds for a beat rather than closing out from under it.
  if (pub.phase === "final" && !pub.turn) {
    return { title: "Last call for sticks.", detail: stickHint ?? "Every turn is in. The round is closing." };
  }
  const detail = pub.cambio
    ? <>{name(pub.players.find((p) => p.id === pub.cambio!.callerId) ?? null)} {pub.cambio.reason === "zero" ? "is out of cards" : "called Cambio"}. {pub.cambio.remaining.length ? <>Still to play: {pub.cambio.remaining.map((id) => pub.players.find((p) => p.id === id)?.name).join(", ")}.</> : "Final turn in progress."}</>
    : stickHint;
  const stage = pub.turn?.stage;
  return {
    title: <>{name(turnPlayer)} {stage === "draw" ? "is up" : stage === "decide" ? "is deciding" : "is using a power"}.</>,
    detail,
  };
}
