"use client";

import type { Card, PlayerPublic } from "@/lib/game/types";
import type { LocKey, Positions } from "@/lib/client/positions";
import { CardBack, CardTile } from "./cards";
import { Chip, DIFFICULTY_LABEL, Pip, PlayerName } from "./ui";

export interface PanelProps {
  player: PlayerPublic;
  isMe: boolean;
  isTurn: boolean;
  turnStage: string | null;
  isCaller: boolean;
  owesCard: boolean;
  /** which of this player's cards can be clicked right now, and what it does */
  cueFor: (cardId: string) => string | null;
  selectedCardId: string | null;
  onCard: (cardId: string) => void;
  /** cards this viewer is allowed to see right now, by id */
  revealed: Map<string, Card>;
  /** locations whose card is still in flight */
  hidden: Set<LocKey>;
  /** cards the current announcement is about, lit in every hand */
  spotlit: Set<string>;
  /** this player is the one the current announcement is about */
  inTheSpotlight: boolean;
  /** another player is holding a drawn card */
  holding: boolean;
  /** during the ready check: null outside it, otherwise whether this seat is in */
  ready: boolean | null;
  positions: Positions;
}

export function PlayerPanel({ player, isMe, isTurn, turnStage, isCaller, owesCard, cueFor, selectedCardId, onCard, revealed, hidden, spotlit, inTheSpotlight, holding, ready, positions }: PanelProps) {
  const ring = inTheSpotlight ? "ring-accent" : isCaller ? "ring-accent" : ready === true ? "ring-accent" : isTurn ? "ring-turn" : "hairline";
  const surface = isTurn || inTheSpotlight || ready === true ? "bg-surface-2" : "bg-surface";
  const stageText = isTurn
    ? turnStage === "draw" ? "To draw" : turnStage === "decide" ? "Deciding" : turnStage === "power" ? "Using a power" : ""
    : "";
  const heldKey = `held:${player.id}`;

  return (
    <section
      className={`relative flex min-w-0 flex-col gap-3 rounded-panel px-3 pt-3 pb-4 transition-[box-shadow,background-color] duration-300 ease-out xl:gap-4 xl:px-4 xl:pt-4 xl:pb-5 ${surface} ${ring}`}
      aria-label={`${player.name}'s hand`}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isTurn || ready === true ? <Pip /> : null}
            <h3 className="t-headline min-w-0 break-words text-[15px]! sm:text-[17px]!">
              <span><PlayerName name={player.name} isBot={player.isBot} /></span>
            </h3>
          </div>
          <p className="t-footnote mt-0.5 text-ink-3">
            {isMe ? <span className="font-medium text-ink">You</span> : null}
            {isMe ? " · " : ""}
            {player.isBot ? `Bot · ${DIFFICULTY_LABEL[player.difficulty ?? "medium"]}` : player.isHost ? "Host" : "Player"}
            {stageText ? <span className="text-ink-2"> · {stageText}</span> : null}
            {ready === null ? null : (
              <span className={ready ? "text-accent" : "text-ink-2"}> · {ready ? "Ready" : "Not ready"}</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-end gap-1">
          {holding ? (
            <span
              ref={positions.register(heldKey)}
              className="relative block h-[34px] w-6 animate-fade"
              style={hidden.has(heldKey) ? { visibility: "hidden" } : undefined}
              aria-label="Holding a drawn card"
            >
              <CardBack size="lg" className="h-full! w-full! rounded-[3px]! shadow-rest!" />
            </span>
          ) : isCaller ? (
            <Chip tone="accent">Cambio</Chip>
          ) : null}
          {owesCard ? <Chip tone="muted">Owes a card</Chip> : null}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 justify-items-center xl:gap-3">
        {player.hand.map((cardId, i) => {
          const key = `slot:${player.id}:${i}`;
          // A card still in the air keeps its tile face down, so the reveal
          // turns over once it has landed instead of arriving already up.
          const face = hidden.has(key) ? null : revealed.get(cardId ?? "") ?? null;
          return <div key={`position-${i}`} className="flex flex-col items-center gap-1.5">{cardId ? (
            <CardTile
              position={i + 1}
              cue={cueFor(cardId) ?? undefined}
              selectable={!!cueFor(cardId)}
              selected={selectedCardId === cardId}
              onClick={() => onCard(cardId)}
              face={face}
              hidden={hidden.has(key)}
              spotlit={spotlit.has(cardId)}
              slotRef={positions.register(key)}
            />
          ) : (
            <CardTile position={i + 1} empty slotRef={positions.register(key)} />
          )}<span aria-hidden="true" className="tnum text-[10px] font-semibold leading-none text-ink-3">{i + 1}</span></div>;
        })}
      </div>

      <p className="t-footnote tnum text-ink-3">
        {player.cardCount === 0 ? "Out of cards" : `${player.cardCount} card${player.cardCount === 1 ? "" : "s"}`}
      </p>
    </section>
  );
}
