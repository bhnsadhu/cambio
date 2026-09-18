"use client";

import { useMemo, useState } from "react";
import type { Action, PlayerPublic, PlayerView, PowerKind } from "@/lib/game/types";
import { shortLabel } from "@/lib/game/cards";
import type { GameHook } from "@/lib/client/useGame";
import { PlayerPanel } from "./PlayerPanel";
import { Piles } from "./Piles";
import { EventFeed } from "./EventFeed";
import { RevealBanner } from "./RevealBanner";
import { Scoreboard } from "./Scoreboard";
import { FaceCard } from "./cards";
import { Button, PlayerName } from "./ui";

type Mode =
  | { kind: "none" }
  | { kind: "give"; to: PlayerPublic }
  | { kind: "power"; power: PowerKind; lookedDone: boolean }
  | { kind: "decide" }
  | { kind: "stick" };

export function Table({ game }: { game: GameHook }) {
  const view = game.view!;
  const pub = view.public;
  const me = game.me;
  const [sel, setSel] = useState<{ cardId: string; key: string } | null>(null);

  const mine = pub.players.find((p) => p.id === me) ?? null;
  const turnPlayer = pub.turn ? pub.players.find((p) => p.id === pub.turn!.playerId) ?? null : null;
  const myTurn = !!mine && pub.turn?.playerId === mine.id;
  const owner = (cardId: string) => pub.players.find((p) => p.hand.includes(cardId)) ?? null;

  const mode: Mode = useMemo(() => {
    if (!mine) return { kind: "none" };
    if (pub.phase !== "playing" && pub.phase !== "final") return { kind: "none" };
    const give = pub.pendingGives.find((g) => g.from === mine.id);
    if (give) return { kind: "give", to: pub.players.find((p) => p.id === give.to)! };
    if (pub.pendingPower && pub.pendingPower.playerId === mine.id) {
      return { kind: "power", power: pub.pendingPower.kind, lookedDone: pub.pendingPower.lookedDone };
    }
    if (myTurn && pub.turn?.stage === "decide") return { kind: "decide" };
    const canStick =
      !!pub.discardTop && mine.cardCount > 0 && !(myTurn && (pub.turn?.stage === "draw" || pub.turn?.stage === "decide"));
    if (canStick) return { kind: "stick" };
    return { kind: "none" };
  }, [mine, pub, myTurn]);

  // A selection only survives inside the mode it was made in.
  const modeKey = mode.kind === "power" ? `power:${mode.power}:${mode.lookedDone}` : mode.kind;
  const selected = sel && sel.key === modeKey ? sel.cardId : null;
  const setSelected = (cardId: string | null) => setSel(cardId ? { cardId, key: modeKey } : null);

  const cueFor = (cardId: string): string | null => {
    if (!mine || game.busy) return null;
    const own = mine.hand.includes(cardId);
    switch (mode.kind) {
      case "give": return own ? "Give" : null;
      case "decide": return own ? "Swap" : null;
      case "stick": return "Stick";
      case "power": {
        if (mode.lookedDone) return null;
        switch (mode.power) {
          case "peekOwn": return own ? "Peek" : null;
          case "peekOther": return own ? null : "Peek";
          case "blindSwap": return selected ? (own ? "Swap" : "Take") : own ? "Swap" : null;
          case "kingLook": {
            if (!selected) return "Look";
            return owner(selected)?.id === owner(cardId)?.id ? (cardId === selected ? "Look" : null) : "Look";
          }
        }
      }
      default: return null;
    }
  };

  const fire = async (action: Action) => {
    setSelected(null);
    const res = await game.send(action);
    if (res?.note?.kind === "stick") game.toast(res.note.correct ? "Stuck it." : "Wrong card. Penalty drawn.", res.note.correct ? "good" : "bad");
  };

  const onCard = (cardId: string) => {
    if (!mine || game.busy) return;
    const own = mine.hand.includes(cardId);
    switch (mode.kind) {
      case "give": if (own) void fire({ type: "give", cardId }); return;
      case "decide": if (own) void fire({ type: "swap", cardId }); return;
      case "stick": void fire({ type: "stick", cardId }); return;
      case "power":
        switch (mode.power) {
          case "peekOwn": if (own) void fire({ type: "peekOwn", cardId }); return;
          case "peekOther": if (!own) void fire({ type: "peekOther", cardId }); return;
          case "blindSwap":
            if (own) { setSelected(cardId); return; }
            if (selected) void fire({ type: "blindSwap", myCardId: selected, theirCardId: cardId });
            return;
          case "kingLook":
            if (!selected) { setSelected(cardId); return; }
            if (cardId === selected) { setSelected(null); return; }
            if (owner(selected)?.id === owner(cardId)?.id) return;
            void fire({ type: "kingLook", cardIdA: selected, cardIdB: cardId });
            return;
        }
    }
  };

  const status = describeStatus(view, mine, turnPlayer, mode, selected);

  return (
    <div className="grid h-[calc(100vh-56px)] grid-cols-[1fr_280px] gap-5 pb-6">
      <div className="flex min-h-0 flex-col gap-5">
        <div className="grid grid-cols-[repeat(4,minmax(196px,1fr))_auto] gap-4">
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
            />
          ))}
          <Piles
            deckCount={pub.deckCount}
            discardTop={pub.discardTop}
            discardCount={pub.discardCount}
            canDraw={myTurn && pub.turn?.stage === "draw" && !game.busy}
            onDraw={() => void fire({ type: "draw" })}
          />
        </div>

        {/* Action bar */}
        <div className="mt-auto flex min-h-[84px] items-center justify-between gap-6 rounded-panel bg-surface px-6 py-4 hairline">
          <div className="flex items-center gap-5">
            {view.private?.drawnCard && myTurn && pub.turn?.stage === "decide" ? (
              <FaceCard key={view.private.drawnCard.id} card={view.private.drawnCard} size="lg" className="animate-pop" />
            ) : null}
            <div>
              <p className="text-[16px] font-medium tracking-[-0.005em]">{status.title}</p>
              {status.detail ? <p className="mt-0.5 text-[13.5px] text-ink-2">{status.detail}</p> : null}
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {mine && myTurn && pub.turn?.stage === "draw" ? (
              <>
                {pub.phase === "playing" ? (
                  <Button variant="accent" disabled={game.busy} onClick={() => void fire({ type: "callCambio" })}>Call Cambio</Button>
                ) : null}
                <Button variant="primary" size="lg" disabled={game.busy} onClick={() => void fire({ type: "draw" })}>Draw a card</Button>
              </>
            ) : null}
            {mine && mode.kind === "decide" ? (
              <Button variant="primary" size="lg" disabled={game.busy} onClick={() => void fire({ type: "place" })}>
                Place {view.private?.drawnCard ? shortLabel(view.private.drawnCard) : ""} on the pile
              </Button>
            ) : null}
            {mine && mode.kind === "power" && !mode.lookedDone ? (
              <Button variant="ghost" disabled={game.busy} onClick={() => void fire({ type: "skipPower" })}>Skip power</Button>
            ) : null}
            {mine && mode.kind === "power" && mode.lookedDone ? (
              <>
                <Button variant="ghost" disabled={game.busy} onClick={() => void fire({ type: "kingDecide", swap: false })}>Leave them</Button>
                <Button variant="accent" disabled={game.busy} onClick={() => void fire({ type: "kingDecide", swap: true })}>Swap them</Button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <EventFeed log={pub.log} />

      <RevealBanner view={view} now={game.now} busy={game.busy} onKingDecide={(swap) => void fire({ type: "kingDecide", swap })} />
      {pub.phase === "scoring" ? (
        <Scoreboard view={pub} me={me} busy={game.busy} onPlayAgain={() => void fire({ type: "playAgain" })} />
      ) : null}
    </div>
  );
}

function describeStatus(
  view: PlayerView,
  mine: PlayerPublic | null,
  turnPlayer: PlayerPublic | null,
  mode: Mode,
  selected: string | null,
): { title: React.ReactNode; detail?: React.ReactNode } {
  const pub = view.public;
  const name = (p: PlayerPublic | null) => (p ? <PlayerName name={p.name} isBot={p.isBot} /> : "—");
  const top = pub.discardTop ? shortLabel(pub.discardTop) : null;
  const stickHint = top && mine && mine.cardCount > 0 ? <>Sticking is live: click any card you believe is a {pub.discardTop!.rank === "JOKER" ? "Joker" : pub.discardTop!.rank}.</> : null;

  if (pub.phase === "peek") {
    const left = Math.max(0, (pub.openingPeekUntil ?? 0) - pub.serverNow);
    return { title: "Memorise your bottom two cards.", detail: mine ? "The round starts when the countdown ends." : `Play starts in about ${Math.ceil(left / 1000)}s.` };
  }
  if (pub.phase === "scoring") return { title: "Round over." };
  if (!mine) return { title: <>Spectating. {name(turnPlayer)} is up.</> };

  switch (mode.kind) {
    case "give":
      return { title: <>Good stick. Hand {name(mode.to)} one of your cards.</>, detail: "Click the card you want to give away. They will not see it." };
    case "decide":
      return { title: "Keep it or place it?", detail: "Click one of your cards to swap this in (its power is lost), or place it on the pile." };
    case "power":
      switch (mode.power) {
        case "peekOwn": return { title: "Peek at one of your own cards.", detail: "Click a card in your hand. You will see it for a few seconds." };
        case "peekOther": return { title: "Peek at someone else's card.", detail: "Click any card in another player's hand." };
        case "blindSwap": return selected
          ? { title: "Now pick the card you want in return.", detail: "Click a card in another player's hand. Neither of you sees either card." }
          : { title: "Blind swap: pick one of your cards to give away.", detail: "Then pick any card of another player's to take." };
        case "kingLook": return mode.lookedDone
          ? { title: "You have seen both cards.", detail: "Swap them, or leave them." }
          : selected
            ? { title: "Pick a second card from a different player.", detail: "You will see both, then decide whether to swap them." }
            : { title: "Black king: look at any two cards from two different players.", detail: "Then choose whether to swap them." };
      }
    default: break;
  }

  if (pub.turn?.playerId === mine.id && pub.turn.stage === "draw") {
    return pub.phase === "final"
      ? { title: "Your last turn.", detail: "Draw from the deck, then keep or place the card." }
      : { title: "Your turn.", detail: "Draw from the deck, or call Cambio to end the round after everyone else's next turn." };
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
