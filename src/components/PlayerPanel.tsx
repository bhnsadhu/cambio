"use client";

import type { PlayerPublic } from "@/lib/game/types";
import { CardTile } from "./cards";
import { Chip, PlayerName } from "./ui";

export interface PanelProps {
  player: PlayerPublic;
  isMe: boolean;
  isTurn: boolean;
  turnStage: string | null;
  isCaller: boolean;
  owesCard: boolean;
  isLead?: boolean;
  /** which of this player's cards can be clicked right now, and what it does */
  cueFor: (cardId: string) => string | null;
  selectedCardId: string | null;
  onCard: (cardId: string) => void;
}

export function PlayerPanel({ player, isMe, isTurn, turnStage, isCaller, owesCard, cueFor, selectedCardId, onCard }: PanelProps) {
  const ring = isCaller ? "ring-accent" : isTurn ? "ring-turn" : "hairline";
  const stageText = isTurn
    ? turnStage === "draw" ? "to draw" : turnStage === "decide" ? "deciding" : turnStage === "power" ? "using a power" : ""
    : "";
  return (
    <section
      className={`relative flex min-w-[196px] flex-col gap-4 rounded-panel bg-surface px-5 pt-4 pb-5 transition-[box-shadow] duration-200 ${ring}`}
      aria-label={`${player.name}'s hand`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[15px] font-medium tracking-[-0.005em]">
              <span><PlayerName name={player.name} isBot={player.isBot} /></span>
            </h3>
            {isMe ? <Chip tone="ink">You</Chip> : null}
          </div>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {player.isBot ? "House bot" : player.isHost ? "Host" : "Player"}
            {stageText ? <span className="text-ink-2"> · {stageText}</span> : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {isCaller ? <Chip tone="accent">Cambio</Chip> : isTurn ? <Chip tone="neutral">Turn</Chip> : null}
          {owesCard ? <Chip tone="muted">Owes a card</Chip> : null}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2.5 justify-items-center">
        {player.hand.map((cardId, i) =>
          cardId ? (
            <CardTile
              key={cardId}
              cue={cueFor(cardId) ?? undefined}
              selectable={!!cueFor(cardId)}
              selected={selectedCardId === cardId}
              onClick={() => onCard(cardId)}
            />
          ) : (
            <CardTile key={`empty-${i}`} empty />
          ),
        )}
      </div>

      <p className="tnum text-[12px] text-ink-3">
        {player.cardCount === 0 ? "Out of cards" : `${player.cardCount} card${player.cardCount === 1 ? "" : "s"}`}
      </p>
    </section>
  );
}
