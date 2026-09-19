/**
 * Core domain types for Cambio.
 *
 * `GameState` is the server-authoritative, *secret* state: it contains every
 * card's identity. It never leaves the server. Clients only ever receive a
 * `PlayerView` (see view.ts), which is a redaction of this state.
 */

export type Suit = "S" | "H" | "D" | "C";
export type Rank =
  | "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10"
  | "J" | "Q" | "K" | "JOKER";

export interface Card {
  id: string;
  rank: Rank;
  /** null only for jokers */
  suit: Suit | null;
}

export type Phase =
  | "lobby"    // waiting for seats / host to start
  | "peek"     // opening 10s memorisation window
  | "playing"  // normal turn loop
  | "final"    // cambio has been called; remaining last turns are being taken
  | "scoring"; // round over, scores visible, "play again" available

export type TurnStage = "draw" | "decide" | "power";

export interface Player {
  id: string;
  seat: number; // 0..3
  name: string;
  isBot: boolean;
  isHost: boolean;
  /** secret; humans only. Never projected into a view. */
  token?: string;
  /** slot -> card id. `null` is an empty (stuck-away) slot. Length >= 4. */
  hand: (string | null)[];
}

export type PowerKind = "peekOwn" | "peekOther" | "blindSwap" | "kingLook";

export interface PendingPower {
  playerId: string;
  kind: PowerKind;
  /** for kingLook after the two cards have been looked at */
  looked?: { a: string; b: string };
}

export interface PendingGive {
  /** the sticker who owes a card */
  from: string;
  /** the player whose card was stuck */
  to: string;
  /** when the debt was created (idle humans are resolved after a timeout) */
  since?: number;
}

export interface Reveal {
  id: string;
  toPlayerId: string;
  kind: "opening" | "peekOwn" | "peekOther" | "kingLook";
  cardIds: string[];
  /** epoch ms; the reveal is dropped from views after this */
  until: number;
}

/**
 * A request to pause or resume, waiting on unanimous agreement.
 *
 * Bots are added to `agreed` the moment the request is made, so the only
 * seats a table ever waits on are human ones.
 */
export interface PauseVote {
  kind: "pause" | "resume";
  byId: string;
  /** everyone who has agreed, the requester included */
  agreed: string[];
  at: number;
}

export interface CambioState {
  callerId: string;
  /** whether the caller called it manually or hit zero cards */
  reason: "called" | "zero";
  /** ordered player ids who still owe a final turn (current turn excluded) */
  remaining: string[];
}

export interface LogEntry {
  seq: number;
  at: number;
  text: string;
  /** optional: emphasise in the feed */
  tone?: "neutral" | "good" | "bad" | "accent";
}

export interface RoundResult {
  round: number;
  scores: { playerId: string; score: number; cards: Card[] }[];
  winnerIds: string[];
  /** seat that leads the next round */
  nextLeadSeat: number;
}

export interface GameState {
  code: string;
  hostId: string;
  phase: Phase;
  round: number;
  players: Player[];
  /** every card in the game keyed by id (secret) */
  cards: Record<string, Card>;
  /** draw pile; top of the deck is the LAST element */
  deck: string[];
  /** discard pile; top is the LAST element */
  discard: string[];
  turn: { playerId: string; stage: TurnStage; drawnCardId: string | null; startedAt: number } | null;
  /** seat that leads the round */
  leadSeat: number;
  /** count of completed turns this round (used by bots to avoid calling cambio too early) */
  turnsTaken: number;
  pendingPower: PendingPower | null;
  pendingGives: PendingGive[];
  /** nothing may be played while true */
  paused: boolean;
  /** epoch ms the table went dark, so every clock can be shifted on resume */
  pausedAt: number | null;
  /** who asked for the pause the table agreed to */
  pausedBy: string | null;
  /** an open pause or resume request; the game plays on while one is pending */
  pauseVote: PauseVote | null;
  cambio: CambioState | null;
  reveals: Reveal[];
  openingPeekUntil: number | null;
  /** cumulative results across rounds */
  results: RoundResult[];
  log: LogEntry[];
  logSeq: number;
  /** bot memory: cards each bot has seen, by card id */
  botKnown: Record<string, string[]>;
  /** idempotency: recently applied action ids */
  appliedActionIds: string[];
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export type Action =
  | { type: "start" }
  | { type: "advance" }             // peek window -> first turn (idempotent)
  | { type: "draw" }
  | { type: "place" }               // discard the drawn card (may trigger power)
  | { type: "swap"; cardId: string } // put drawn card into own slot, old card to discard
  | { type: "callCambio" }
  | { type: "peekOwn"; cardId: string }
  | { type: "peekOther"; cardId: string }
  | { type: "blindSwap"; myCardId: string; theirCardId: string }
  | { type: "kingLook"; cardIdA: string; cardIdB: string }
  | { type: "kingDecide"; swap: boolean }
  | { type: "skipPower" }
  | { type: "stick"; cardId: string }
  | { type: "give"; cardId: string }
  | { type: "playAgain" }
  /** ask the table to pause, or to resume when it is already paused */
  | { type: "pauseRequest" }
  | { type: "pauseVote"; agree: boolean }
  /** an idle human's turn (or owed card) is resolved for them; anyone may report it */
  | { type: "timeout" };

export type ActionType = Action["type"];

export interface ActionEnvelope {
  actionId: string;
  playerId: string;
  action: Action;
}

/* ------------------------------------------------------------------ */
/* Views (what clients receive)                                        */
/* ------------------------------------------------------------------ */

export interface PlayerPublic {
  id: string;
  seat: number;
  name: string;
  isBot: boolean;
  isHost: boolean;
  /** slot -> card id or null (empty slot). No ranks. */
  hand: (string | null)[];
  cardCount: number;
}

export interface PublicView {
  code: string;
  version: number;
  hostId: string;
  phase: Phase;
  round: number;
  players: PlayerPublic[];
  deckCount: number;
  discardCount: number;
  discardTop: Card | null;
  turn: { playerId: string; stage: TurnStage; startedAt: number } | null;
  pendingPower: { playerId: string; kind: PowerKind; lookedDone: boolean } | null;
  pendingGives: PendingGive[];
  paused: boolean;
  pausedAt: number | null;
  pausedBy: string | null;
  pauseVote: PauseVote | null;
  /** epoch ms after which the current human turn is forfeited */
  turnDeadline: number | null;
  cambio: { callerId: string; reason: "called" | "zero"; remaining: string[] } | null;
  openingPeekUntil: number | null;
  results: RoundResult[];
  log: LogEntry[];
  /** server time at projection; lets clients estimate clock skew */
  serverNow: number;
}

export interface PrivateView {
  playerId: string;
  /** the card this player has drawn this turn, if any */
  drawnCard: Card | null;
  /** unexpired reveals addressed to this player */
  reveals: (Reveal & { cards: Card[] })[];
}

export interface PlayerView {
  public: PublicView;
  private: PrivateView | null;
}
