import type { Card, Rank, Suit } from "./types";

export const RANKS: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const SUITS: Suit[] = ["S", "H", "D", "C"];

export const isRed = (suit: Suit | null) => suit === "H" || suit === "D";

/** Scoring: A=1, 2..10 face, J/Q=10, red K=-1, black K=0, joker=0. */
export function cardValue(card: Card): number {
  switch (card.rank) {
    case "A": return 1;
    case "J":
    case "Q": return 10;
    case "K": return isRed(card.suit) ? -1 : 0;
    case "JOKER": return 0;
    default: return parseInt(card.rank, 10);
  }
}

export type PowerName = "peekOwn" | "peekOther" | "blindSwap" | "kingLook";

/** Which power a card carries when discarded as the active card. */
export function powerOf(card: Card): PowerName | null {
  switch (card.rank) {
    case "7":
    case "8": return "peekOwn";
    case "9":
    case "10": return "peekOther";
    case "J":
    case "Q": return "blindSwap";
    case "K": return isRed(card.suit) ? null : "kingLook";
    default: return null;
  }
}

export function ranksMatch(a: Card, b: Card): boolean {
  return a.rank === b.rank;
}

export const SUIT_SYMBOL: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

export function cardLabel(card: Card): string {
  if (card.rank === "JOKER") return "Joker";
  const names: Partial<Record<Rank, string>> = { A: "Ace", J: "Jack", Q: "Queen", K: "King" };
  const rank = names[card.rank] ?? card.rank;
  const suit = card.suit ? { S: "spades", H: "hearts", D: "diamonds", C: "clubs" }[card.suit] : "";
  return suit ? `${rank} of ${suit}` : rank;
}

export function shortLabel(card: Card): string {
  if (card.rank === "JOKER") return "JKR";
  return `${card.rank}${card.suit ? SUIT_SYMBOL[card.suit] : ""}`;
}

/** Build a fresh 54-card deck (52 + 2 jokers) with fresh ids. */
export function buildDeck(newId: () => string): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) cards.push({ id: newId(), rank, suit });
  cards.push({ id: newId(), rank: "JOKER", suit: null });
  cards.push({ id: newId(), rank: "JOKER", suit: null });
  return cards;
}

/** Fisher–Yates with an injectable RNG in [0,1). */
export function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
