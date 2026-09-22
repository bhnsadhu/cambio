/**
 * The Cambio rules engine.
 *
 * Pure and deterministic: `applyAction(state, envelope, ctx)` returns a new
 * state (never mutates the input) or throws a `GameError`. All randomness and
 * time come from `ctx`, so the engine is fully unit-testable and the server
 * can serialize actions with optimistic concurrency (see server/store.ts).
 */

import {
  buildDeck,
  cardValue,
  powerOf,
  ranksMatch,
  shortLabel,
  shuffle,
} from "./cards";
import type {
  Action,
  ActionEnvelope,
  BotDifficulty,
  Card,
  CambioState,
  EventKind,
  EventWeight,
  GameState,
  LogEntry,
  PauseVote,
  Player,
  PowerKind,
  Reveal,
  RoundResult,
  RoundTally,
} from "./types";

export const SEATS = 4;
export const BOT_NAMES = ["Cameron", "Camila", "Cami"] as const;
export const DEFAULT_BOT_DIFFICULTY: BotDifficulty = "medium";
export const OPENING_PEEK_MS = 5_000;
/**
 * How long the deal takes to land before the opening peek starts. The table
 * shuffles and deals, *then* everyone looks; the client's deal animation is
 * cut to fit inside this, with a beat to spare for the round trip.
 */
export const DEAL_MS = 2_600;
/** An idle human forfeits the turn and draws a penalty after this long. */
export const TURN_TIMEOUT_MS = 30_000;
/**
 * How long a ready check waits on a seat that never answers. The round then
 * starts without them rather than leaving the table stuck on one empty chair.
 */
export const READY_TIMEOUT_MS = 45_000;
/**
 * Once the final turns are otherwise spent, how long a card still matching
 * the pile holds the score back. A stick during the window reopens it fresh,
 * so a run of several matching cards is never cut off partway through; a
 * timeout past the deadline closes it regardless, so one unclaimed match
 * cannot hold a round open forever.
 */
export const STICK_WINDOW_MS = 3_000;
export const PEEK_REVEAL_MS = 6_000;
export const KING_LOOK_MS = 120_000;
export const MAX_LOG = 40;
export const MAX_APPLIED_IDS = 200;
/** Clients may fire `advance` a hair early because of clock skew. */
export const ADVANCE_TOLERANCE_MS = 400;

export interface EngineCtx {
  now: number;
  rng: () => number;
  newId: () => string;
}

export type ErrorCode =
  | "NOT_FOUND"
  | "WRONG_PHASE"
  | "NOT_HOST"
  | "GAME_FULL"
  | "NOT_YOUR_TURN"
  | "WRONG_STAGE"
  | "INVALID_TARGET"
  | "TOO_LATE"
  | "CANT_STICK"
  | "PENDING_GIVE"
  | "NO_POWER"
  | "EMPTY_DECK"
  | "PAUSED"
  | "BAD_NAME";

export class GameError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "GameError";
  }
}

export interface ApplyResult {
  state: GameState;
  /** false when the action was a no-op (already applied, or idempotent skip) */
  changed: boolean;
  /** small structured hint for the caller's immediate UI feedback */
  note?: { kind: "stick"; correct: boolean } | { kind: "cambio" };
}

/* ------------------------------------------------------------------ */
/* Construction                                                        */
/* ------------------------------------------------------------------ */

export function createGame(
  code: string,
  hostName: string,
  ctx: EngineCtx,
  profileId?: string | null,
): { state: GameState; hostId: string; token: string } {
  const name = cleanName(hostName);
  const hostId = ctx.newId();
  const token = ctx.newId() + ctx.newId();
  const host: Player = { id: hostId, seat: 0, name, isBot: false, isHost: true, token, profileId: profileId ?? null, hand: [null, null, null, null] };
  const state: GameState = {
    code,
    hostId,
    phase: "lobby",
    round: 0,
    players: [host],
    cards: {},
    deck: [],
    discard: [],
    turn: null,
    leadSeat: 0,
    turnsTaken: 0,
    pendingPower: null,
    pendingGives: [],
    paused: false,
    pausedAt: null,
    pausedBy: null,
    pauseVote: null,
    cambio: null,
    reveals: [],
    botDifficulty: Array.from({ length: SEATS }, () => DEFAULT_BOT_DIFFICULTY),
    readyIds: [],
    readyDeadline: null,
    dealingUntil: null,
    openingPeekUntil: null,
    stickWindowUntil: null,
    replayVotes: [],
    results: [],
    log: [],
    logSeq: 0,
    botKnown: {},
    tally: {},
    appliedActionIds: [],
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  addLog(state, ctx, `${name} opened the table.`, { kind: "table", actorId: hostId });
  return { state, hostId, token };
}

export function joinGame(
  input: GameState,
  rawName: string,
  ctx: EngineCtx,
  profileId?: string | null,
): { state: GameState; playerId: string; token: string } {
  const state = clone(input);
  if (state.phase !== "lobby") throw new GameError("WRONG_PHASE", "This game has already started.");
  const humans = state.players.filter((p) => !p.isBot);
  if (humans.length >= SEATS) throw new GameError("GAME_FULL", "All four seats are taken.");
  const name = cleanName(rawName);
  const seat = nextOpenSeat(state);
  const playerId = ctx.newId();
  const token = ctx.newId() + ctx.newId();
  // A table whose last seat walked out has no host left to start it, so
  // whoever opens the link next inherits it.
  const orphaned = !state.players.some((p) => p.id === state.hostId);
  if (orphaned) state.hostId = playerId;
  state.players.push({ id: playerId, seat, name, isBot: false, isHost: orphaned, token, profileId: profileId ?? null, hand: [null, null, null, null] });
  state.players.sort((a, b) => a.seat - b.seat);
  addLog(state, ctx, `${name} took seat ${seat + 1}.`, { kind: "table", actorId: playerId, weight: "normal" });
  state.updatedAt = ctx.now;
  return { state, playerId, token };
}

export function cleanName(raw: string): string {
  const name = (raw ?? "").trim().replace(/\s+/g, " ").slice(0, 18);
  if (name.length < 1) throw new GameError("BAD_NAME", "Enter a name to play.");
  if (BOT_NAMES.some((b) => b.toLowerCase() === name.toLowerCase())) {
    throw new GameError("BAD_NAME", `${name} is one of the house bots. Pick another name.`);
  }
  return name;
}

/* ------------------------------------------------------------------ */
/* Reducer                                                             */
/* ------------------------------------------------------------------ */

export function applyAction(input: GameState, env: ActionEnvelope, ctx: EngineCtx): ApplyResult {
  if (input.appliedActionIds.includes(env.actionId)) {
    return { state: input, changed: false };
  }
  const state = clone(input);
  const a = env.action;
  // A paused table is frozen: the only moves are the ones that unfreeze it.
  // Reveals are not pruned either, so a peek that was running when the table
  // went dark still has its remaining seconds when play resumes.
  if (state.paused && a.type !== "pauseRequest" && a.type !== "pauseVote") {
    // The watchdogs (any client, and the bot runner) keep firing these; they
    // are no-ops rather than errors so nothing surfaces as a failure.
    if (a.type === "timeout" || a.type === "advance") return { state: input, changed: false };
    throw new GameError("PAUSED", "The game is paused. It resumes when everyone agrees.");
  }
  if (!state.paused) pruneReveals(state, ctx.now);
  const actor = state.players.find((p) => p.id === env.playerId);
  if (!actor) throw new GameError("NOT_FOUND", "You are not seated at this table.");

  let note: ApplyResult["note"];
  switch (a.type) {
    case "start": doStart(state, actor, ctx); break;
    case "ready": {
      if (!doReady(state, actor, ctx)) return { state: input, changed: false };
      break;
    }
    case "setBotDifficulty": {
      if (!doSetBotDifficulty(state, actor, a.seat, a.difficulty, ctx)) return { state: input, changed: false };
      break;
    }
    case "advance": {
      if (!doAdvance(state, ctx)) return { state: input, changed: false };
      break;
    }
    case "draw": doDraw(state, actor, ctx); break;
    case "place": doPlace(state, actor, ctx); break;
    case "swap": doSwap(state, actor, a.cardId, ctx); break;
    case "callCambio": doCallCambio(state, actor, ctx); note = { kind: "cambio" }; break;
    case "peekOwn": doPeekOwn(state, actor, a.cardId, ctx); break;
    case "peekOther": doPeekOther(state, actor, a.cardId, ctx); break;
    case "blindSwap": doBlindSwap(state, actor, a.cardIdA, a.cardIdB, ctx); break;
    case "kingLook": doKingLook(state, actor, a.cardIdA, a.cardIdB, ctx); break;
    case "kingDecide": doKingDecide(state, actor, a.swap, ctx); break;
    case "skipPower": doSkipPower(state, actor, ctx); break;
    case "stick": note = doStick(state, actor, a.cardId, ctx); break;
    case "give": doGive(state, actor, a.cardId, ctx); break;
    case "playAgain": {
      if (!doPlayAgain(state, actor, ctx)) return { state: input, changed: false };
      break;
    }
    case "leaveTable": doLeaveTable(state, actor, ctx); break;
    case "pauseRequest": doPauseRequest(state, actor, ctx); break;
    case "pauseVote": {
      if (!doPauseVote(state, actor, a.agree, ctx)) return { state: input, changed: false };
      break;
    }
    case "timeout": {
      if (!doTimeout(state, ctx)) return { state: input, changed: false };
      break;
    }
    default: {
      const never: never = a;
      throw new GameError("INVALID_TARGET", `Unknown action ${(never as Action).type}`);
    }
  }

  state.appliedActionIds.push(env.actionId);
  if (state.appliedActionIds.length > MAX_APPLIED_IDS) {
    state.appliedActionIds.splice(0, state.appliedActionIds.length - MAX_APPLIED_IDS);
  }
  state.updatedAt = ctx.now;
  return { state, changed: true, note };
}

/* ------------------------------------------------------------------ */
/* Lobby / round lifecycle                                             */
/* ------------------------------------------------------------------ */

function doStart(state: GameState, actor: Player, ctx: EngineCtx) {
  requirePhase(state, ["lobby"]);
  if (actor.id !== state.hostId) throw new GameError("NOT_HOST", "Only the host can start the round.");
  fillBots(state, ctx);
  // A table that came back to the lobby between rounds keeps counting up.
  state.round = state.results.length + 1;
  state.leadSeat = 0;
  openReadyCheck(state, ctx);
}

/**
 * The host closing the lobby does not deal: it sets the seats and asks every
 * one of them whether they are in. Nothing is shuffled until the last seat
 * has answered, so nobody is dealt a hand while they are still reading the
 * rules. Bots answer the instant they are asked.
 */
function openReadyCheck(state: GameState, ctx: EngineCtx) {
  state.phase = "ready";
  state.readyIds = state.players.filter((p) => p.isBot).map((p) => p.id);
  state.readyDeadline = ctx.now + READY_TIMEOUT_MS;
  state.dealingUntil = null;
  state.openingPeekUntil = null;
  state.reveals = [];
  state.replayVotes = [];
  const waiting = state.players.filter((p) => !state.readyIds.includes(p.id));
  addLog(state, ctx, waiting.length
    ? `Seats are set. Ready check: waiting on ${joinNames(waiting.map((p) => p.name))}.`
    : `Seats are set.`,
    { kind: "table", tone: "accent", weight: "loud" });
  settleReady(state, ctx);
}

/**
 * One click each. Returns false when this seat had already said yes, so a
 * double click is a harmless no-op rather than an error.
 */
function doReady(state: GameState, actor: Player, ctx: EngineCtx): boolean {
  requirePhase(state, ["ready"]);
  if (state.readyIds.includes(actor.id)) return false;
  state.readyIds.push(actor.id);
  const waiting = state.players.filter((p) => !state.readyIds.includes(p.id));
  addLog(state, ctx, waiting.length
    ? `${actor.name} is ready. Waiting on ${joinNames(waiting.map((p) => p.name))}.`
    : `${actor.name} is ready.`,
    { kind: "table", weight: "normal", actorId: actor.id });
  settleReady(state, ctx);
  return true;
}

/** Deals the moment the last seat has answered the check. */
function settleReady(state: GameState, ctx: EngineCtx) {
  if (state.players.some((p) => !state.readyIds.includes(p.id))) return;
  state.readyDeadline = null;
  addLog(state, ctx, `Everyone is ready.`, { kind: "table", tone: "accent", weight: "normal" });
  dealRound(state, ctx);
}

/**
 * Another round is the whole table's call, not the host's: everyone still
 * seated says yes, and the last yes deals. Bots agree the moment the round is
 * scored, so the only seats a table waits on are human ones. Returns false
 * when the actor had already asked, so the action is a harmless no-op.
 */
function doPlayAgain(state: GameState, actor: Player, ctx: EngineCtx): boolean {
  requirePhase(state, ["scoring"]);
  if (state.replayVotes.includes(actor.id)) return false;
  state.replayVotes.push(actor.id);
  const waiting = state.players.filter((p) => !state.replayVotes.includes(p.id));
  if (waiting.length === 0) {
    addLog(state, ctx, `Everyone is in. Dealing the next round.`, { kind: "replay", tone: "accent", weight: "loud", actorId: actor.id });
    const last = state.results[state.results.length - 1];
    state.round = state.results.length + 1;
    state.leadSeat = last && state.players.some((p) => p.seat === last.nextLeadSeat) ? last.nextLeadSeat : lowestSeat(state);
    dealRound(state, ctx);
    return true;
  }
  addLog(state, ctx, `${actor.name} is in for another round. Waiting on ${joinNames(waiting.map((p) => p.name))}.`,
    { kind: "replay", weight: "normal", actorId: actor.id });
  return true;
}

/**
 * Leaving between rounds takes the table back to the lobby rather than ending
 * it: the seats that stay can invite someone else, or let a bot fill the gap.
 * The bots are stood down on the way, since `start` seats them again.
 */
function doLeaveTable(state: GameState, actor: Player, ctx: EngineCtx) {
  requirePhase(state, ["lobby", "ready", "scoring"]);
  // A seat leaving a set table takes it apart: the bots stand down so the
  // seats can close up, and `start` seats them again.
  const wasPlaying = state.phase === "scoring" || state.phase === "ready";
  state.players = state.players.filter((p) => p.id !== actor.id && (!wasPlaying || !p.isBot));
  state.replayVotes = [];
  state.readyIds = [];
  state.readyDeadline = null;
  if (wasPlaying) {
    state.phase = "lobby";
    state.turn = null;
    state.pendingPower = null;
    state.pendingGives = [];
    state.cambio = null;
    state.reveals = [];
    state.dealingUntil = null;
    state.openingPeekUntil = null;
    state.deck = [];
    state.discard = [];
    state.cards = {};
    state.botKnown = {};
    for (const p of state.players) p.hand = [null, null, null, null];
  }
  // Seats close up behind whoever left, so the lobby reads 1, 2, 3, 4.
  state.players.sort((a, b) => a.seat - b.seat);
  state.players.forEach((p, i) => { p.seat = i; });
  state.leadSeat = 0;
  if (actor.id === state.hostId) {
    const heir = state.players[0] ?? null;
    for (const p of state.players) p.isHost = !!heir && p.id === heir.id;
    state.hostId = heir ? heir.id : "";
  }
  addLog(state, ctx, state.players.length
    ? `${actor.name} left the table. Back to the lobby: invite someone, or start and let a bot take the seat.`
    : `${actor.name} left. The table is empty.`,
    { kind: "table", tone: "bad", weight: "loud", actorId: actor.id });
}

function lowestSeat(state: GameState): number {
  return state.players.length ? Math.min(...state.players.map((p) => p.seat)) : 0;
}

function fillBots(state: GameState, ctx: EngineCtx) {
  let botIndex = 0;
  while (state.players.length < SEATS) {
    const seat = nextOpenSeat(state);
    const name = BOT_NAMES[botIndex++];
    state.players.push({
      id: ctx.newId(),
      seat,
      name,
      isBot: true,
      isHost: false,
      difficulty: difficultyForSeat(state, seat),
      hand: [null, null, null, null],
    });
  }
  state.players.sort((a, b) => a.seat - b.seat);
  const bots = state.players.filter((p) => p.isBot);
  if (bots.length) {
    addLog(state, ctx, `${joinNames(bots.map((b) => `${b.name} (${b.difficulty})`))} filled the empty seats.`, { kind: "table" });
  }
}

export function difficultyForSeat(state: GameState, seat: number): BotDifficulty {
  return state.botDifficulty?.[seat] ?? DEFAULT_BOT_DIFFICULTY;
}

/**
 * How hard each house bot plays is the host's call, and only while the table
 * is still being set: once the cards are down, a seat cannot change how it
 * thinks. The setting is kept per seat and carries to the next round.
 */
function doSetBotDifficulty(state: GameState, actor: Player, seat: number, difficulty: BotDifficulty, ctx: EngineCtx): boolean {
  requirePhase(state, ["lobby", "ready", "scoring"]);
  if (actor.id !== state.hostId) throw new GameError("NOT_HOST", "Only the host can set how the bots play.");
  if (!Number.isInteger(seat) || seat < 0 || seat >= SEATS) throw new GameError("INVALID_TARGET", "No such seat.");
  if (difficulty !== "easy" && difficulty !== "medium" && difficulty !== "hard") {
    throw new GameError("INVALID_TARGET", "Pick easy, medium or hard.");
  }
  if (!state.botDifficulty) state.botDifficulty = Array.from({ length: SEATS }, () => DEFAULT_BOT_DIFFICULTY);
  if (state.botDifficulty[seat] === difficulty) return false;
  state.botDifficulty[seat] = difficulty;
  const bot = state.players.find((p) => p.seat === seat && p.isBot);
  if (bot) {
    bot.difficulty = difficulty;
    addLog(state, ctx, `${bot.name} is playing ${difficulty} from now on.`, { kind: "table", actorId: actor.id, weight: "normal" });
  }
  return true;
}

function dealRound(state: GameState, ctx: EngineCtx) {
  const deck = shuffle(buildDeck(ctx.newId), ctx.rng);
  state.cards = {};
  for (const c of deck) state.cards[c.id] = c;
  state.deck = deck.map((c) => c.id);
  state.discard = [];
  state.turn = null;
  state.turnsTaken = 0;
  state.pendingPower = null;
  state.pendingGives = [];
  state.paused = false;
  state.pausedAt = null;
  state.pausedBy = null;
  state.pauseVote = null;
  state.cambio = null;
  state.reveals = [];
  state.botKnown = {};
  state.tally = {};
  state.readyIds = [];
  state.readyDeadline = null;
  state.dealingUntil = null;
  state.stickWindowUntil = null;
  for (const p of state.players) {
    p.hand = [null, null, null, null];
    for (let i = 0; i < 4; i++) p.hand[i] = state.deck.pop()!;
  }
  state.phase = "peek";
  // Shuffle, deal, *then* look: the peek clock only starts once the last card
  // has landed, so nobody is memorising a hand that is still being dealt.
  state.dealingUntil = ctx.now + DEAL_MS;
  state.openingPeekUntil = state.dealingUntil + OPENING_PEEK_MS;
  state.replayVotes = [];
  for (const p of state.players) {
    const bottom = [p.hand[2]!, p.hand[3]!];
    if (p.isBot) remember(state, p.id, bottom);
    else addReveal(state, ctx, p.id, "opening", bottom, state.openingPeekUntil);
  }
  addLog(state, ctx, `Round ${state.round}. The deck is shuffled and dealt.`, { kind: "deal", tone: "accent", weight: "loud" });
}

function doAdvance(state: GameState, ctx: EngineCtx): boolean {
  if (state.phase !== "peek") return false;
  if (state.openingPeekUntil !== null && ctx.now < state.openingPeekUntil - ADVANCE_TOLERANCE_MS) return false;
  state.phase = "playing";
  state.reveals = state.reveals.filter((r) => r.kind !== "opening");
  const lead = state.players.find((p) => p.seat === state.leadSeat) ?? state.players[0];
  state.turn = { playerId: lead.id, stage: "draw", drawnCardId: null, startedAt: ctx.now };
  addLog(state, ctx, `Cards down. ${lead.name} leads.`, { kind: "table", actorId: lead.id, weight: "normal" });
  return true;
}

/* ------------------------------------------------------------------ */
/* Turn actions                                                        */
/* ------------------------------------------------------------------ */

function doDraw(state: GameState, actor: Player, ctx: EngineCtx) {
  requireTurn(state, actor, "draw");
  const id = drawFromDeck(state, ctx);
  if (!id) throw new GameError("EMPTY_DECK", "There are no cards left to draw.");
  state.turn!.drawnCardId = id;
  state.turn!.stage = "decide";
  if (actor.isBot) remember(state, actor.id, [id]);
  addLog(state, ctx, `${actor.name} drew a card from the deck.`, { kind: "draw", actorId: actor.id });
}

function doPlace(state: GameState, actor: Player, ctx: EngineCtx) {
  requireTurn(state, actor, "decide");
  const id = state.turn!.drawnCardId!;
  const card = state.cards[id];
  state.turn!.drawnCardId = null;
  toDiscard(state, id);
  const power = powerOf(card);
  addLog(state, ctx,
    power
      ? `${actor.name} placed ${shortLabel(card)} on the pile, which carries ${aPower(power)}.`
      : `${actor.name} placed ${shortLabel(card)} on the pile.`,
    { kind: "place", actorId: actor.id, tone: power ? "accent" : "neutral", weight: power ? "normal" : "quiet" });
  if (power && powerIsUsable(state, actor, power)) {
    state.pendingPower = { playerId: actor.id, kind: power };
    state.turn!.stage = "power";
    return;
  }
  if (power) addLog(state, ctx, `There was no one to use the power on. It fizzles.`, { kind: "place", actorId: actor.id });
  endTurn(state, ctx);
}

/**
 * The drawn card goes into any slot at the table, not only your own: the card
 * that was there is discarded, and its owner is left holding whatever you drew.
 */
function doSwap(state: GameState, actor: Player, cardId: string, ctx: EngineCtx) {
  requireTurn(state, actor, "decide");
  const at = ownerOf(state, cardId);
  if (!at) throw new GameError("INVALID_TARGET", "Pick a card on the table to swap the drawn card into.");
  const drawn = state.turn!.drawnCardId!;
  const old = state.cards[cardId];
  const where = placeOf(at.player, at.slot, actor);
  at.player.hand[at.slot] = drawn;
  state.turn!.drawnCardId = null;
  toDiscard(state, cardId);
  const own = at.player.id === actor.id;
  addLog(state, ctx,
    own
      ? `${actor.name} swapped the drawn card into ${where}, discarding ${shortLabel(old)}.`
      : `${actor.name} pushed the drawn card into ${where}, discarding ${shortLabel(old)}. ${at.player.name} is holding it now.`,
    {
      kind: "swap",
      actorId: actor.id,
      subjectIds: [at.player.id],
      cardIds: [drawn],
      tone: own ? "neutral" : "accent",
      // Pushing your drawn card into someone else's hand is the loudest thing
      // a plain turn can do: it always gets the big notification.
      weight: own ? (state.phase === "final" ? "loud" : "normal") : "loud",
    });
  endTurn(state, ctx);
}

function doCallCambio(state: GameState, actor: Player, ctx: EngineCtx) {
  requirePhase(state, ["playing"]);
  requireTurn(state, actor, "draw");
  addLog(state, ctx, `${actor.name} called Cambio. Everyone else gets one last turn.`, { kind: "cambio", actorId: actor.id, tone: "accent", weight: "loud" });
  startCambio(state, actor.id, "called", actor.id);
  endTurn(state, ctx);
}

/* ------------------------------------------------------------------ */
/* Powers                                                              */
/* ------------------------------------------------------------------ */

function requirePower(state: GameState, actor: Player, kind: PowerKind) {
  const pp = state.pendingPower;
  if (!pp || pp.playerId !== actor.id) throw new GameError("NO_POWER", "You have no power to use right now.");
  if (pp.kind !== kind) throw new GameError("NO_POWER", `That is not how a ${describePower(pp.kind)} works.`);
}

function doPeekOwn(state: GameState, actor: Player, cardId: string, ctx: EngineCtx) {
  requirePower(state, actor, "peekOwn");
  if (!actor.hand.includes(cardId)) throw new GameError("INVALID_TARGET", "Pick one of your own cards.");
  const where = place(state, cardId, actor);
  reveal(state, ctx, actor, "peekOwn", [cardId], ctx.now + PEEK_REVEAL_MS);
  addLog(state, ctx, `${actor.name} looked at ${where}. Only they saw it.`,
    { kind: "peekOwn", actorId: actor.id, subjectIds: [actor.id], cardIds: [cardId], weight: "normal" });
  endTurn(state, ctx);
}

function doPeekOther(state: GameState, actor: Player, cardId: string, ctx: EngineCtx) {
  requirePower(state, actor, "peekOther");
  const owner = ownerOf(state, cardId);
  if (!owner || owner.player.id === actor.id) throw new GameError("INVALID_TARGET", "Pick a card from another player.");
  const where = place(state, cardId, actor);
  reveal(state, ctx, actor, "peekOther", [cardId], ctx.now + PEEK_REVEAL_MS);
  addLog(state, ctx, `${actor.name} looked at ${where}. Only they saw it.`,
    { kind: "peekOther", actorId: actor.id, subjectIds: [owner.player.id], cardIds: [cardId], weight: "normal" });
  endTurn(state, ctx);
}

/**
 * J/Q: trade any two cards between two different players, sight unseen. The
 * actor need not be one of them, so a jack can just as easily rearrange the
 * table as raid it.
 */
function doBlindSwap(state: GameState, actor: Player, aId: string, bId: string, ctx: EngineCtx) {
  requirePower(state, actor, "blindSwap");
  const a = ownerOf(state, aId);
  const b = ownerOf(state, bId);
  if (!a || !b) throw new GameError("INVALID_TARGET", "Pick two cards that are still on the table.");
  if (a.player.id === b.player.id) throw new GameError("INVALID_TARGET", "The two cards must belong to different players.");
  const from = placeOf(a.player, a.slot, actor);
  const to = placeOf(b.player, b.slot, actor);
  a.player.hand[a.slot] = bId;
  b.player.hand[b.slot] = aId;
  addLog(state, ctx, `${actor.name} blind swapped ${from} with ${to}. Nobody saw either card.`, {
    kind: "blindSwap",
    actorId: actor.id,
    subjectIds: [a.player.id, b.player.id],
    cardIds: [aId, bId],
    tone: "accent",
    weight: swapWeight(state, actor, a.player, b.player),
  });
  endTurn(state, ctx);
}

function doKingLook(state: GameState, actor: Player, aId: string, bId: string, ctx: EngineCtx) {
  requirePower(state, actor, "kingLook");
  if (state.pendingPower!.looked) throw new GameError("WRONG_STAGE", "You have already looked. Decide whether to swap.");
  const a = ownerOf(state, aId);
  const b = ownerOf(state, bId);
  if (!a || !b) throw new GameError("INVALID_TARGET", "Pick two cards that are still on the table.");
  if (a.player.id === b.player.id) throw new GameError("INVALID_TARGET", "The two cards must belong to different players.");
  state.pendingPower!.looked = { a: aId, b: bId };
  reveal(state, ctx, actor, "kingLook", [aId, bId], ctx.now + KING_LOOK_MS);
  addLog(state, ctx, `${actor.name} is looking at ${placeOf(a.player, a.slot, actor)} and ${placeOf(b.player, b.slot, actor)}, then decides whether to swap them.`, {
    kind: "kingLook",
    actorId: actor.id,
    subjectIds: [a.player.id, b.player.id],
    cardIds: [aId, bId],
    weight: "normal",
  });
}

function doKingDecide(state: GameState, actor: Player, swap: boolean, ctx: EngineCtx) {
  requirePower(state, actor, "kingLook");
  const looked = state.pendingPower!.looked;
  if (!looked) throw new GameError("WRONG_STAGE", "Look at two cards first.");
  state.reveals = state.reveals.filter((r) => !(r.kind === "kingLook" && r.toPlayerId === actor.id));
  if (swap) {
    const a = ownerOf(state, looked.a);
    const b = ownerOf(state, looked.b);
    if (a && b) {
      const from = placeOf(a.player, a.slot, actor);
      const to = placeOf(b.player, b.slot, actor);
      a.player.hand[a.slot] = looked.b;
      b.player.hand[b.slot] = looked.a;
      addLog(state, ctx, `${actor.name} swapped ${from} with ${to}, having seen both.`, {
        kind: "kingSwap",
        actorId: actor.id,
        subjectIds: [a.player.id, b.player.id],
        cardIds: [looked.a, looked.b],
        tone: "accent",
        weight: swapWeight(state, actor, a.player, b.player),
      });
    } else {
      addLog(state, ctx, `${actor.name} wanted to swap, but one of the cards had already gone.`, { kind: "kingLeave", actorId: actor.id, weight: "normal" });
    }
  } else {
    addLog(state, ctx, `${actor.name} looked at both cards and left them where they were.`, {
      kind: "kingLeave",
      actorId: actor.id,
      cardIds: [looked.a, looked.b],
      weight: "normal",
    });
  }
  endTurn(state, ctx);
}

function doSkipPower(state: GameState, actor: Player, ctx: EngineCtx) {
  const pp = state.pendingPower;
  if (!pp || pp.playerId !== actor.id) throw new GameError("NO_POWER", "You have no power to skip.");
  state.reveals = state.reveals.filter((r) => !(r.kind === "kingLook" && r.toPlayerId === actor.id));
  addLog(state, ctx, `${actor.name} passed on ${aPower(pp.kind)}.`, { kind: "skipPower", actorId: actor.id });
  endTurn(state, ctx);
}

function powerIsUsable(state: GameState, actor: Player, kind: PowerKind): boolean {
  const others = state.players.filter((p) => p.id !== actor.id && cardCount(p) > 0);
  switch (kind) {
    case "peekOwn": return cardCount(actor) > 0;
    case "peekOther": return others.length > 0;
    case "blindSwap": return state.players.filter((p) => cardCount(p) > 0).length >= 2;
    case "kingLook": return state.players.filter((p) => cardCount(p) > 0).length >= 2;
  }
}

export function describePower(kind: PowerKind): string {
  switch (kind) {
    case "peekOwn": return "peek at one of your cards";
    case "peekOther": return "peek at someone else's card";
    case "blindSwap": return "blind swap";
    case "kingLook": return "look at two cards and maybe swap them";
  }
}

/** The same power in the log's third person: "passed on a blind swap". */
function aPower(kind: PowerKind): string {
  switch (kind) {
    case "peekOwn": return "a look at one of their own cards";
    case "peekOther": return "a look at someone else's card";
    case "blindSwap": return "a blind swap";
    case "kingLook": return "a look at two cards, and the swap that follows";
  }
}

/* ------------------------------------------------------------------ */
/* Sticking                                                            */
/* ------------------------------------------------------------------ */

/**
 * Sticking is an anytime action, and that includes the player whose turn it
 * is: the pile is face up for everyone, and a rank you can see is a rank you
 * can claim. Nothing about drawing or holding a card takes that away, so the
 * only things that stop a stick are a frozen table, a hand with nothing in
 * it, and a debt you have not paid yet.
 */
export function canStick(state: GameState, playerId: string): boolean {
  if (state.paused) return false;
  if (state.phase !== "playing" && state.phase !== "final") return false;
  if (state.discard.length === 0) return false;
  const p = state.players.find((x) => x.id === playerId);
  if (!p || cardCount(p) === 0) return false;
  if (state.pendingGives.some((g) => g.from === playerId)) return false;
  return true;
}

function doStick(state: GameState, actor: Player, cardId: string, ctx: EngineCtx): ApplyResult["note"] {
  if (state.phase !== "playing" && state.phase !== "final") throw new GameError("WRONG_PHASE", "Nothing to stick right now.");
  if (state.discard.length === 0) throw new GameError("CANT_STICK", "The discard pile is empty.");
  if (state.pendingGives.some((g) => g.from === actor.id)) throw new GameError("PENDING_GIVE", "Give a card away first.");
  if (cardCount(actor) === 0) throw new GameError("CANT_STICK", "You have no cards left.");
  const owner = ownerOf(state, cardId);
  if (!owner) throw new GameError("TOO_LATE", "Too late. That card is already gone.");
  const card = state.cards[cardId];
  const top = state.cards[state.discard[state.discard.length - 1]];
  const own = owner.player.id === actor.id;
  let note: ApplyResult["note"];

  if (ranksMatch(card, top)) {
    const where = placeOf(owner.player, owner.slot, actor);
    owner.player.hand[owner.slot] = null;
    trimHand(owner.player);
    toDiscard(state, cardId);
    addLog(state, ctx,
      own
        ? `${actor.name} stuck ${where}: it was ${shortLabel(card)}, and it is gone.`
        : `${actor.name} stuck ${where}: it was ${shortLabel(card)}. ${owner.player.name} is a card lighter, and ${actor.name} owes them one.`,
      { kind: "stick", tone: "good", weight: "normal", actorId: actor.id, subjectIds: [owner.player.id], cardIds: [cardId] });
    tallyFor(state, actor.id).sticks += 1;
    if (!own) state.pendingGives.push({ from: actor.id, to: owner.player.id, since: ctx.now });
    if (cardCount(owner.player) === 0) handleZero(state, owner.player, ctx);
    note = { kind: "stick", correct: true };
  } else {
    // The card stays where it is and its value is never shown: a wrong stick
    // must not become a free peek for the table.
    tallyFor(state, actor.id).misses += 1;
    const penalty = drawFromDeck(state, ctx);
    // Which card was wrongly stuck is never named or highlighted: that it is
    // *not* the rank on the pile is information the table has not earned.
    if (penalty) {
      addToHand(actor, penalty);
      addLog(state, ctx, `${actor.name} stuck a card that did not match ${shortLabel(top)}, and took a penalty card.`,
        { kind: "stickMiss", tone: "bad", weight: "normal", actorId: actor.id, subjectIds: [actor.id] });
    } else {
      addLog(state, ctx, `${actor.name} stuck a card that did not match ${shortLabel(top)}, but there was no penalty card left to draw.`,
        { kind: "stickMiss", tone: "bad", weight: "normal", actorId: actor.id, subjectIds: [actor.id] });
    }
    note = { kind: "stick", correct: false };
  }

  // Sticking is anytime and can land after the final turns are otherwise all
  // spent. Recheck here rather than leaving that to whatever happened to call
  // `maybeEndRound` last: a fresh, full window reopens if another card still
  // matches, so a run of several correct sticks is never cut off partway
  // through by the moment the last turn happened to end.
  state.stickWindowUntil = null;
  maybeEndRound(state, ctx);
  return note;
}

function doGive(state: GameState, actor: Player, cardId: string, ctx: EngineCtx) {
  const idx = state.pendingGives.findIndex((g) => g.from === actor.id);
  if (idx < 0) throw new GameError("INVALID_TARGET", "You have nothing to give.");
  const give = state.pendingGives[idx];
  const slot = actor.hand.indexOf(cardId);
  if (slot < 0) throw new GameError("INVALID_TARGET", "Pick one of your own cards to give.");
  const to = state.players.find((p) => p.id === give.to)!;
  const from = placeOf(actor, slot, actor);
  actor.hand[slot] = null;
  trimHand(actor);
  addToHand(to, cardId);
  state.pendingGives.splice(idx, 1);
  addLog(state, ctx, `${actor.name} paid the debt with ${from}. ${to.name} takes it face down, unseen.`,
    { kind: "give", weight: "normal", actorId: actor.id, subjectIds: [to.id], cardIds: [cardId] });
  if (cardCount(actor) === 0) handleZero(state, actor, ctx);
  maybeEndRound(state, ctx);
}

/* ------------------------------------------------------------------ */
/* Idle humans                                                         */
/* ------------------------------------------------------------------ */

/**
 * Resolves whatever an idle human is holding the table up with. Returns
 * false when nothing is overdue, so the action is a harmless no-op that
 * any client or the bot runner may fire on a timer.
 */
function doTimeout(state: GameState, ctx: EngineCtx): boolean {
  // A ready check nobody answers cannot hold the table forever: once the
  // window closes, every remaining seat is taken as ready and the round is
  // dealt. A seat that walked away forfeits its turns to the turn clock.
  if (state.phase === "ready") {
    if (state.readyDeadline === null || ctx.now < state.readyDeadline) return false;
    const waiting = state.players.filter((p) => !state.readyIds.includes(p.id));
    if (waiting.length === 0) return false;
    for (const p of waiting) state.readyIds.push(p.id);
    addLog(state, ctx, `${joinNames(waiting.map((p) => p.name))} did not answer the ready check. The round starts anyway.`,
      { kind: "timeout", tone: "bad", weight: "normal", subjectIds: waiting.map((p) => p.id) });
    settleReady(state, ctx);
    return true;
  }
  if (state.phase !== "playing" && state.phase !== "final") return false;
  let acted = false;

  // An owed card that was never handed over: give one at random.
  for (const give of state.pendingGives.slice()) {
    const from = state.players.find((p) => p.id === give.from)!;
    if (from.isBot || give.since === undefined || ctx.now - give.since < TURN_TIMEOUT_MS) continue;
    const to = state.players.find((p) => p.id === give.to)!;
    const ids = from.hand.filter((id): id is string => !!id);
    if (ids.length) {
      const cardId = ids[Math.floor(ctx.rng() * ids.length)];
      from.hand[from.hand.indexOf(cardId)] = null;
      trimHand(from);
      addToHand(to, cardId);
      addLog(state, ctx, `${from.name} ran out of time. One of their cards went to ${to.name} at random.`,
        { kind: "timeout", tone: "bad", weight: "normal", actorId: from.id, subjectIds: [to.id], cardIds: [cardId] });
    }
    state.pendingGives.splice(state.pendingGives.indexOf(give), 1);
    acted = true;
    if (cardCount(from) === 0) handleZero(state, from, ctx);
  }

  const t = state.turn;
  if (t) {
    const player = state.players.find((p) => p.id === t.playerId)!;
    if (!player.isBot && ctx.now - t.startedAt >= TURN_TIMEOUT_MS) {
      // A drawn card that was never decided on lands on the pile with no power.
      if (t.drawnCardId) {
        const drawn = t.drawnCardId;
        t.drawnCardId = null;
        toDiscard(state, drawn);
      }
      const penalty = drawFromDeck(state, ctx);
      if (penalty) addToHand(player, penalty);
      addLog(state, ctx, penalty
        ? `${player.name} ran out of time. The turn is skipped and a penalty card goes into their hand.`
        : `${player.name} ran out of time. The turn is skipped.`,
        { kind: "timeout", tone: "bad", weight: "normal", actorId: player.id, subjectIds: [player.id] });
      state.reveals = state.reveals.filter((r) => !(r.kind === "kingLook" && r.toPlayerId === player.id));
      endTurn(state, ctx);
      acted = true;
    }
  }

  // A card was still sitting on the table matching the pile when the final
  // turns finished, and the grace window given for it has now run out with
  // nobody claiming it: close the round anyway rather than holding it open
  // forever on one unclaimed match.
  if (state.phase === "final" && state.stickWindowUntil !== null && ctx.now >= state.stickWindowUntil) {
    acted = true;
  }

  if (!acted) return false;
  maybeEndRound(state, ctx);
  return true;
}

/* ------------------------------------------------------------------ */
/* Pausing                                                             */
/* ------------------------------------------------------------------ */

/** The phases where a pause means anything: a clock or a turn is running. */
const PAUSABLE: GameState["phase"][] = ["peek", "playing", "final"];

/**
 * Pausing is unanimous, in both directions. A request opens a vote; play
 * carries on normally while it is open, and only a full table turns it into
 * an actual pause. One decline cancels it outright, so a request never sits
 * in limbo. Bots agree the instant they are asked, so the only seats a table
 * ever waits on are human ones.
 */
function doPauseRequest(state: GameState, actor: Player, ctx: EngineCtx) {
  if (!PAUSABLE.includes(state.phase)) throw new GameError("WRONG_PHASE", "There is nothing to pause right now.");
  if (state.pauseVote) throw new GameError("WRONG_STAGE", "There is already a request on the table.");
  const kind: PauseVote["kind"] = state.paused ? "resume" : "pause";
  const agreed = [actor.id, ...state.players.filter((p) => p.isBot && p.id !== actor.id).map((p) => p.id)];
  state.pauseVote = { kind, byId: actor.id, agreed, at: ctx.now };
  addLog(state, ctx, kind === "pause"
    ? `${actor.name} asked to pause. Everyone has to agree.`
    : `${actor.name} asked to resume. Everyone has to agree.`,
    { kind: "pause", tone: "accent", weight: "normal", actorId: actor.id });
  settlePause(state, ctx);
}

function doPauseVote(state: GameState, actor: Player, agree: boolean, ctx: EngineCtx): boolean {
  const vote = state.pauseVote;
  if (!vote) throw new GameError("WRONG_STAGE", "There is no request on the table.");
  if (!agree) {
    state.pauseVote = null;
    addLog(state, ctx, vote.kind === "pause"
      ? `${actor.name} declined the pause. Play continues.`
      : `${actor.name} declined to resume. The table stays paused.`,
      { kind: "pause", tone: "bad", weight: "normal", actorId: actor.id });
    return true;
  }
  if (vote.agreed.includes(actor.id)) return false;
  vote.agreed.push(actor.id);
  addLog(state, ctx, `${actor.name} agreed to ${vote.kind}.`, { kind: "pause", actorId: actor.id });
  settlePause(state, ctx);
  return true;
}

/** Applies an open request once every seat at the table has agreed to it. */
function settlePause(state: GameState, ctx: EngineCtx) {
  const vote = state.pauseVote!;
  if (state.players.some((p) => !vote.agreed.includes(p.id))) return;
  state.pauseVote = null;
  if (vote.kind === "pause") {
    state.paused = true;
    state.pausedAt = ctx.now;
    state.pausedBy = vote.byId;
    addLog(state, ctx, "Everyone agreed. The table is paused.", { kind: "pause", tone: "accent", weight: "loud" });
    return;
  }
  // Every clock picks up where it left off rather than starting again.
  const held = state.pausedAt === null ? 0 : Math.max(0, ctx.now - state.pausedAt);
  if (state.turn) state.turn.startedAt += held;
  for (const g of state.pendingGives) if (g.since !== undefined) g.since += held;
  if (state.dealingUntil !== null) state.dealingUntil += held;
  if (state.openingPeekUntil !== null) state.openingPeekUntil += held;
  if (state.stickWindowUntil !== null) state.stickWindowUntil += held;
  for (const r of state.reveals) r.until += held;
  state.paused = false;
  state.pausedAt = null;
  state.pausedBy = null;
  addLog(state, ctx, "Everyone agreed. Play resumes.", { kind: "pause", tone: "accent", weight: "loud" });
}

/* ------------------------------------------------------------------ */
/* Cambio / round end                                                  */
/* ------------------------------------------------------------------ */

function startCambio(state: GameState, callerId: string, reason: CambioState["reason"], anchorId: string) {
  const anchor = state.players.find((p) => p.id === anchorId)!;
  const remaining: string[] = [];
  for (let i = 1; i < SEATS; i++) {
    const p = state.players.find((x) => x.seat === (anchor.seat + i) % SEATS);
    if (!p || p.id === callerId || p.id === anchorId || cardCount(p) === 0) continue;
    remaining.push(p.id);
  }
  state.cambio = { callerId, reason, remaining };
  state.phase = "final";
}

function handleZero(state: GameState, player: Player, ctx: EngineCtx) {
  if (state.cambio) {
    state.cambio.remaining = state.cambio.remaining.filter((id) => id !== player.id);
    addLog(state, ctx, `${player.name} is out of cards and out of the round.`,
      { kind: "zero", tone: "accent", weight: "loud", actorId: player.id, subjectIds: [player.id] });
  } else {
    addLog(state, ctx, `${player.name} is out of cards. That calls Cambio: everyone else gets one last turn.`,
      { kind: "cambio", tone: "accent", weight: "loud", actorId: player.id, subjectIds: [player.id] });
    const anchorId = state.turn ? state.turn.playerId : player.id;
    startCambio(state, player.id, "zero", anchorId);
  }
  if (!state.turn) maybeEndRound(state, ctx);
}

function endTurn(state: GameState, ctx: EngineCtx) {
  const finished = state.turn!.playerId;
  state.turn = null;
  state.pendingPower = null;
  state.turnsTaken += 1;

  if (state.cambio) {
    const rem = state.cambio.remaining;
    while (rem.length && cardCount(state.players.find((p) => p.id === rem[0])!) === 0) rem.shift();
    const next = rem.shift();
    if (!next) { maybeEndRound(state, ctx); return; }
    state.turn = { playerId: next, stage: "draw", drawnCardId: null, startedAt: ctx.now };
    return;
  }

  const cur = state.players.find((p) => p.id === finished)!;
  for (let i = 1; i <= SEATS; i++) {
    const p = state.players.find((x) => x.seat === (cur.seat + i) % SEATS);
    if (p && cardCount(p) > 0) {
      state.turn = { playerId: p.id, stage: "draw", drawnCardId: null, startedAt: ctx.now };
      return;
    }
  }
  maybeEndRound(state, ctx);
}

function maybeEndRound(state: GameState, ctx: EngineCtx) {
  if (state.phase !== "final") return;
  if (state.turn) return;
  if (state.cambio && state.cambio.remaining.length > 0) return;
  if (state.pendingGives.length > 0) return;

  // Every turn is spent and nothing is owed: the round is otherwise ready to
  // score. But a card still sitting in some hand may match the pile, and
  // sticking is anytime — it must not be cut off by the very moment the last
  // turn ends. Hold the round open for a beat instead. `doStick` clears the
  // deadline before calling back in here, so a fresh stick reopens a full
  // window rather than racing an old one; only a `timeout` past an
  // already-set deadline is allowed to close it with a match still unclaimed.
  const expired = state.stickWindowUntil !== null && ctx.now >= state.stickWindowUntil;
  if (!expired && stickAvailable(state)) {
    if (state.stickWindowUntil === null) state.stickWindowUntil = ctx.now + STICK_WINDOW_MS;
    return;
  }
  state.stickWindowUntil = null;
  scoreRound(state, ctx);
}

/** Does any card still on the table match the rank on top of the discard? */
function stickAvailable(state: GameState): boolean {
  if (state.discard.length === 0) return false;
  const rank = state.cards[state.discard[state.discard.length - 1]].rank;
  return state.players.some((p) => cardCount(p) > 0 && p.hand.some((id) => id !== null && state.cards[id].rank === rank));
}

function scoreRound(state: GameState, ctx: EngineCtx) {
  const scores = state.players.map((p) => {
    const cards = p.hand.filter((id): id is string => !!id).map((id) => state.cards[id]);
    return { playerId: p.id, score: cards.reduce((s, c) => s + cardValue(c), 0), cards };
  });
  const min = Math.min(...scores.map((s) => s.score));
  const winnerIds = scores.filter((s) => s.score === min).map((s) => s.playerId);
  const winners = state.players.filter((p) => winnerIds.includes(p.id));
  const nextLeadSeat = Math.min(...winners.map((w) => w.seat));
  const result: RoundResult = {
    round: state.round,
    scores,
    winnerIds,
    nextLeadSeat,
    callerId: state.cambio && state.cambio.reason === "called" ? state.cambio.callerId : null,
    tally: structuredClone(state.tally ?? {}),
  };
  state.results.push(result);
  state.phase = "scoring";
  // Bots are always in for another round; the table only waits on humans.
  state.replayVotes = state.players.filter((p) => p.isBot).map((p) => p.id);
  state.turn = null;
  state.pendingPower = null;
  state.pendingGives = [];
  state.paused = false;
  state.pausedAt = null;
  state.pausedBy = null;
  state.pauseVote = null;
  state.reveals = [];
  state.stickWindowUntil = null;
  const names = winners.map((w) => w.name);
  addLog(state, ctx, winners.length > 1
    ? `Round ${state.round} ends in a tie: ${joinNames(names)} on ${min}.`
    : `${names[0]} wins round ${state.round} with ${min}.`,
    { kind: "roundEnd", tone: "accent", weight: "loud", subjectIds: winnerIds });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function tallyFor(state: GameState, playerId: string): RoundTally {
  if (!state.tally) state.tally = {};
  if (!state.tally[playerId]) state.tally[playerId] = { sticks: 0, misses: 0 };
  return state.tally[playerId];
}

export function cardCount(p: Player): number {
  return p.hand.filter((c) => c !== null).length;
}

export function ownerOf(state: GameState, cardId: string): { player: Player; slot: number } | null {
  for (const player of state.players) {
    const slot = player.hand.indexOf(cardId);
    if (slot >= 0) return { player, slot };
  }
  return null;
}

function addToHand(p: Player, cardId: string) {
  const empty = p.hand.indexOf(null);
  if (empty >= 0) p.hand[empty] = cardId;
  else p.hand.push(cardId);
}

function trimHand(p: Player) {
  while (p.hand.length > 4 && p.hand[p.hand.length - 1] === null) p.hand.pop();
}

function toDiscard(state: GameState, cardId: string) {
  state.discard.push(cardId);
  for (const id of Object.keys(state.botKnown)) {
    state.botKnown[id] = state.botKnown[id].filter((c) => c !== cardId);
  }
}

/** Pops the top of the deck, reshuffling the discard (minus its top card) if needed. */
function drawFromDeck(state: GameState, ctx: EngineCtx): string | null {
  if (state.deck.length === 0) reshuffle(state, ctx);
  return state.deck.pop() ?? null;
}

function reshuffle(state: GameState, ctx: EngineCtx) {
  if (state.discard.length <= 1) return;
  const top = state.discard.pop()!;
  const recycled = state.discard;
  state.discard = [top];
  // Fresh ids so a card's identity from its face-up life on the pile cannot be tracked.
  const fresh: Card[] = recycled.map((oldId) => {
    const c = state.cards[oldId];
    delete state.cards[oldId];
    return { id: ctx.newId(), rank: c.rank, suit: c.suit };
  });
  for (const c of fresh) state.cards[c.id] = c;
  state.deck = shuffle(fresh.map((c) => c.id), ctx.rng);
  addLog(state, ctx, `The deck ran out. ${fresh.length} cards were shuffled back under ${shortLabel(state.cards[top])}.`,
    { kind: "reshuffle", weight: "normal" });
}

function reveal(state: GameState, ctx: EngineCtx, to: Player, kind: Reveal["kind"], cardIds: string[], until: number) {
  if (to.isBot) remember(state, to.id, cardIds);
  else addReveal(state, ctx, to.id, kind, cardIds, until);
}

function addReveal(state: GameState, ctx: EngineCtx, toPlayerId: string, kind: Reveal["kind"], cardIds: string[], until: number) {
  state.reveals.push({ id: ctx.newId(), toPlayerId, kind, cardIds, until });
}

function pruneReveals(state: GameState, now: number) {
  state.reveals = state.reveals.filter((r) => r.until > now);
}

function remember(state: GameState, botId: string, cardIds: string[]) {
  const known = new Set(state.botKnown[botId] ?? []);
  for (const id of cardIds) known.add(id);
  state.botKnown[botId] = [...known];
}

function nextOpenSeat(state: GameState): number {
  const taken = new Set(state.players.map((p) => p.seat));
  for (let s = 0; s < SEATS; s++) if (!taken.has(s)) return s;
  throw new GameError("GAME_FULL", "All four seats are taken.");
}

function requirePhase(state: GameState, phases: GameState["phase"][]) {
  if (!phases.includes(state.phase)) throw new GameError("WRONG_PHASE", `Not possible while the game is ${describePhase(state.phase)}.`);
}

function requireTurn(state: GameState, actor: Player, stage: GameState["turn"] extends infer T ? (T extends { stage: infer S } ? S : never) : never) {
  requirePhase(state, ["playing", "final"]);
  const t = state.turn;
  if (!t || t.playerId !== actor.id) throw new GameError("NOT_YOUR_TURN", "It is not your turn.");
  if (t.stage !== stage) {
    const hint = t.stage === "draw" ? "Draw a card first." : t.stage === "decide" ? "Place or swap your drawn card first." : "Resolve your power first.";
    throw new GameError("WRONG_STAGE", hint);
  }
}

function describePhase(phase: GameState["phase"]): string {
  switch (phase) {
    case "lobby": return "in the lobby";
    case "ready": return "waiting on the ready check";
    case "peek": return "in the opening peek";
    case "playing": return "in play";
    case "final": return "in its final turns";
    case "scoring": return "being scored";
  }
}

/**
 * Every log line is also the event the table sees on screen: who moved, whose
 * cards it touched, which cards to highlight, and how loudly to say it. Card
 * ids are safe to carry here; ranks are only ever written into `text` for a
 * card that is already face up on the pile.
 */
interface EventMeta {
  kind: EventKind;
  tone?: LogEntry["tone"];
  weight?: EventWeight;
  actorId?: string | null;
  subjectIds?: string[];
  cardIds?: string[];
}

function addLog(state: GameState, ctx: EngineCtx, text: string, meta: EventMeta) {
  state.logSeq += 1;
  state.log.push({
    seq: state.logSeq,
    at: ctx.now,
    text,
    tone: meta.tone ?? "neutral",
    kind: meta.kind,
    actorId: meta.actorId ?? null,
    subjectIds: meta.subjectIds ?? [],
    cardIds: meta.cardIds ?? [],
    weight: meta.weight ?? "quiet",
  });
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

/* ------------------------------------------------------------------ */
/* Naming what moved                                                   */
/* ------------------------------------------------------------------ */

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th"];

function ordinal(n: number): string {
  return ORDINALS[n] ?? `${n + 1}th`;
}

/**
 * Names a card by where it sits, never by what it is: "Cami's 2nd card".
 * This is the only way a face down card is ever described in the log, so the
 * story of a round can be told without leaking a single value.
 */
function place(state: GameState, cardId: string, viewpoint?: Player): string {
  const at = ownerOf(state, cardId);
  if (!at) return "a card";
  if (viewpoint && at.player.id === viewpoint.id) return `their own ${ordinal(at.slot)} card`;
  return `${at.player.name}'s ${ordinal(at.slot)} card`;
}

/** The same, captured before a move so the log can describe where a card *was*. */
function placeOf(player: Player, slot: number, viewpoint?: Player): string {
  return viewpoint && player.id === viewpoint.id
    ? `their own ${ordinal(slot)} card`
    : `${player.name}'s ${ordinal(slot)} card`;
}

/**
 * A swap during the final turns can decide the round, and a swap between two
 * other players is rare enough to be worth stopping for: both get the big
 * treatment. Everything else is a standard notification.
 */
function swapWeight(state: GameState, actor: Player, a: Player, b: Player): EventWeight {
  if (state.phase === "final") return "loud";
  if (a.id !== actor.id && b.id !== actor.id) return "loud";
  return "normal";
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}
