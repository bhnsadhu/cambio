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
  | "ready"    // seats are set; every player says when they are in
  | "peek"     // opening 10s memorisation window
  | "playing"  // normal turn loop
  | "final"    // cambio has been called; remaining last turns are being taken
  | "scoring"; // round over, scores visible, "play again" available

export type TurnStage = "draw" | "decide" | "power";

/**
 * How hard a house bot plays. Easy is loose and forgetful, medium is the
 * house's basic strategy, and hard counts what the pile has swallowed and
 * plays the odds. Set per seat before the round is dealt.
 */
export type BotDifficulty = "easy" | "medium" | "hard";

export const BOT_DIFFICULTIES: BotDifficulty[] = ["easy", "medium", "hard"];

export interface Player {
  id: string;
  seat: number; // 0..3
  name: string;
  isBot: boolean;
  isHost: boolean;
  /** bots only: how hard this seat plays */
  difficulty?: BotDifficulty;
  /** the saved profile playing this seat, when the player has one */
  profileId?: string | null;
  avatarId?: number | null;
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

/**
 * What a log line *is*, beyond its words. The feed reads the text; the
 * on-screen announcer and the card highlights read the rest, so every seat
 * can follow a move it did not make.
 */
export type EventKind =
  | "table"      // seats, hosting, housekeeping
  | "kick"
  | "deal"
  | "draw"
  | "place"
  | "swap"
  | "peekOwn"
  | "peekOther"
  | "blindSwap"
  | "kingLook"
  | "kingSwap"
  | "kingLeave"
  | "skipPower"
  | "stick"
  | "stickMiss"
  | "give"
  | "cambio"
  | "zero"
  | "timeout"
  | "reshuffle"
  | "pause"
  | "roundEnd"
  | "replay";

/**
 * How loudly a move is announced on screen.
 *   quiet  - the feed only (a draw, a plain placement)
 *   normal - a standard notification (a look, a swap, a stick)
 *   loud   - a moment that changes the game (Cambio, a round ending)
 */
export type EventWeight = "quiet" | "normal" | "loud";

export interface LogEntry {
  seq: number;
  at: number;
  text: string;
  /** optional: emphasise in the feed */
  tone?: "neutral" | "good" | "bad" | "accent";
  kind: EventKind;
  /** who moved */
  actorId?: string | null;
  /** whose cards were touched, the actor included when it was their own */
  subjectIds?: string[];
  /**
   * The cards this move touched, for highlighting them in every hand at the
   * table. Ids only: a log line never carries the rank of a card that is
   * still face down.
   */
  cardIds?: string[];
  weight?: EventWeight;
}

/** What one seat did in a round, beyond its score. */
export interface RoundTally {
  sticks: number;
  misses: number;
}

export interface RoundResult {
  round: number;
  scores: { playerId: string; score: number; cards: Card[] }[];
  winnerIds: string[];
  /** seat that leads the next round */
  nextLeadSeat: number;
  /** who called Cambio, when someone called it rather than running out of cards */
  callerId?: string | null;
  /** sticks landed and missed this round, by player */
  tally?: Record<string, RoundTally>;
}

export interface GameState {
  code: string;
  hostId: string;
  /** Room preference. Older saved tables default to accepting join requests. */
  doNotDisturb?: boolean;
  phase: Phase;
  round: number;
  players: Player[];
  /** Human seat ids in join order, independent of seat position. Optional on older tables. */
  humanJoinOrder?: string[];
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
  /**
   * The ready check that opens a round: who has said they are in. Bots are
   * added the moment the check opens, so a table only ever waits on humans.
   */
  readyIds: string[];
  /** epoch ms after which an unanswered ready check starts the round anyway */
  readyDeadline: number | null;
  /**
   * While the deal is still landing on the table. The opening peek only
   * starts once this passes, so a round reads as shuffle, deal, then look.
   */
  dealingUntil: number | null;
  openingPeekUntil: number | null;
  /**
   * Once every final turn is spent and nothing is owed, the earliest moment
   * the round may score. Every round gets the full window, independent of
   * hidden ranks. Successful sticks restart it; owed cards suspend it until
   * the give resolves. Null whenever nothing is waiting to close.
   */
  stickWindowUntil: number | null;
  /** at scoring time: who has asked for another round (bots agree at once) */
  replayVotes: string[];
  /**
   * How hard the bot in each seat plays, by seat index. Chosen in the lobby
   * or during the ready check and kept across rounds at the same table.
   */
  botDifficulty: BotDifficulty[];
  /** cumulative results across rounds */
  results: RoundResult[];
  log: LogEntry[];
  logSeq: number;
  /** bot memory: cards each bot has seen, by card id */
  botKnown: Record<string, string[]>;
  /** Public behavior clues, never the hidden face: a drawn card kept or pushed. */
  botHints?: Record<string, "kept" | "pushed">;
  /** Do not repeat a failed guess against the same live discard. */
  botMissedTop?: Record<string, string>;
  /** this round's sticks and misses, by player, for the record books */
  tally: Record<string, RoundTally>;
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
  /** say you are in during the ready check that opens a round */
  | { type: "ready" }
  /** host only, before the deal: how hard the bot in a seat plays */
  | { type: "setBotDifficulty"; seat: number; difficulty: BotDifficulty }
  /** Host only, at any point: block requests while keeping invitations available. */
  | { type: "setDoNotDisturb"; enabled: boolean }
  | { type: "advance" }             // peek window -> first turn (idempotent)
  | { type: "draw" }
  | { type: "place" }               // discard the drawn card (may trigger power)
  /** put the drawn card into any slot at the table; the card there is discarded */
  | { type: "swap"; cardId: string }
  | { type: "callCambio" }
  | { type: "peekOwn"; cardId: string }
  | { type: "peekOther"; cardId: string }
  /** J/Q: trade any two cards belonging to two different players, unseen */
  | { type: "blindSwap"; cardIdA: string; cardIdB: string }
  | { type: "kingLook"; cardIdA: string; cardIdB: string }
  | { type: "kingDecide"; swap: boolean }
  | { type: "skipPower" }
  | { type: "stick"; cardId: string }
  | { type: "give"; cardId: string }
  /** at scoring: ask for another round. A full table starts one. */
  | { type: "playAgain" }
  /** After scoring, bring every human back to the same lobby without leaving. */
  | { type: "returnToLobby" }
  /** Leave a table; a medium bot takes over during a round. */
  | { type: "leaveTable" }
  /** Host only. A medium bot takes over during a round; otherwise open the seat. */
  | { type: "kickPlayer"; playerId: string }
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

/** Server only identity maintenance, never accepted by the action HTTP route. */
export interface IdentityEnvelope {
  actionId: string;
  playerId: null;
  action:
    | { type: "syncIdentity"; profileId: string; displayName: string | null; avatarId?: number | null }
    | { type: "claimIdentity"; token: string; profileId: string; displayName: string; avatarId?: number | null };
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
  difficulty?: BotDifficulty;
  profileId?: string | null;
  avatarId?: number | null;
  /** slot -> card id or null (empty slot). No ranks. */
  hand: (string | null)[];
  cardCount: number;
}

export interface PublicView {
  code: string;
  version: number;
  hostId: string;
  doNotDisturb: boolean;
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
  /** during the ready check: who has said they are in, and when it gives up waiting */
  readyIds: string[];
  readyDeadline: number | null;
  cambio: { callerId: string; reason: "called" | "zero"; remaining: string[] } | null;
  dealingUntil: number | null;
  openingPeekUntil: number | null;
  /** see `GameState.stickWindowUntil` */
  stickWindowUntil: number | null;
  /** how hard the bot in each seat plays, by seat index */
  botDifficulty: BotDifficulty[];
  /** at scoring: who is ready for another round */
  replayVotes: string[];
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
