"use client";

import type { Card, PlayerPublic } from "@/lib/game/types";
import type { LocKey, Positions } from "@/lib/client/positions";
import { CardBack, CardTile } from "./cards";
import { Chip, Pip, PlayerName } from "./ui";

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
  /** another player is holding a drawn card */
  holding: boolean;
  positions: Positions;
}

export function PlayerPanel({ player, isMe, isTurn, turnStage, isCaller, owesCard, cueFor, selectedCardId, onCard, revealed, hidden, holding, positions }: PanelProps) {
  const ring = isCaller ? "ring-accent" : isTurn ? "ring-turn" : "hairline";
  const surface = isTurn ? "bg-card" : "bg-surface";
  const stageText = isTurn
    ? turnStage === "draw" ? "to draw" : turnStage === "decide" ? "deciding" : turnStage === "power" ? "using a power" : ""
    : "";
  const heldKey = `held:${player.id}`;

  return (
    <section
      className={`relative flex min-w-0 flex-col gap-4 rounded-panel px-4 pt-4 pb-5 transition-[box-shadow,background-color] duration-300 ease-out ${surface} ${ring}`}
      aria-label={`${player.name}'s hand`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="t-headline truncate">
              <span><PlayerName name={player.name} isBot={player.isBot} /></span>
            </h3>
            {isMe ? <Chip tone="ink">You</Chip> : null}
          </div>
          <p className="t-footnote mt-0.5 text-ink-3">
            {player.isBot ? "House bot" : player.isHost ? "Host" : "Player"}
            {stageText ? <span className="text-ink-2"> · {stageText}</span> : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            ref={positions.register(heldKey)}
            className={`relative h-[34px] w-6 rounded-[3px] transition-opacity duration-200 ${holding ? "opacity-100" : "opacity-0"}`}
            style={hidden.has(heldKey) ? { visibility: "hidden" } : undefined}
            aria-hidden
          >
            {holding ? <CardBack size="lg" className="h-full! w-full! rounded-[3px]! shadow-rest!" /> : null}
          </span>
          <div className="flex flex-col items-end gap-1">
            {isCaller ? <Chip tone="accent">Cambio</Chip> : isTurn ? <Chip tone="ink"><Pip className="text-bg" />Turn</Chip> : null}
            {owesCard ? <Chip tone="muted">Owes a card</Chip> : null}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 justify-items-center">
        {player.hand.map((cardId, i) => {
          const key = `slot:${player.id}:${i}`;
          return cardId ? (
            <CardTile
              key={cardId}
              cue={cueFor(cardId) ?? undefined}
              selectable={!!cueFor(cardId)}
              selected={selectedCardId === cardId}
              onClick={() => onCard(cardId)}
              face={revealed.get(cardId) ?? null}
              hidden={hidden.has(key)}
              slotRef={positions.register(key)}
            />
          ) : (
            <CardTile key={`empty-${i}`} empty slotRef={positions.register(key)} />
          );
        })}
      </div>

      <p className="t-footnote tnum text-ink-3">
        {player.cardCount === 0 ? "Out of cards" : `${player.cardCount} card${player.cardCount === 1 ? "" : "s"}`}
      </p>
    </section>
  );
}
