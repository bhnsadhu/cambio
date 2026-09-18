/**
 * The Cambio rules engine.
 *
 * Pure and deterministic: `applyAction(state, envelope, ctx)` returns a new
 * state (never mutates the input) or throws a `GameError`. All randomness and
 * time come from `ctx`, so the engine is fully unit-testable and the server
 * can serialise actions with optimistic concurrency (see server/store.ts).
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
  Card,
  CambioState,
  GameState,
  LogEntry,
  Player,
  PowerKind,
  Reveal,
  RoundResult,
} from "./types";

export const SEATS = 4;
export const BOT_NAMES = ["Camryn", "Camron", "Cami"] as const;
export const OPENING_PEEK_MS = 10_000;
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
): { state: GameState; hostId: string; token: string } {
  const name = cleanName(hostName);
  const hostId = ctx.newId();
  const token = ctx.newId() + ctx.newId();
  const host: Player = { id: hostId, seat: 0, name, isBot: false, isHost: true, token, hand: [null, null, null, null] };
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
    cambio: null,
    reveals: [],
    openingPeekUntil: null,
    results: [],
    log: [],
    logSeq: 0,
    botKnown: {},
    appliedActionIds: [],
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  addLog(state, ctx, `${name} opened the table.`);
  return { state, hostId, token };
}

export function joinGame(
  input: GameState,
  rawName: string,
  ctx: EngineCtx,
): { state: GameState; playerId: string; token: string } {
  const state = clone(input);
  if (state.phase !== "lobby") throw new GameError("WRONG_PHASE", "This game has already started.");
  const humans = state.players.filter((p) => !p.isBot);
  if (humans.length >= SEATS) throw new GameError("GAME_FULL", "All four seats are taken.");
  const name = cleanName(rawName);
  const seat = nextOpenSeat(state);
  const playerId = ctx.newId();
  const token = ctx.newId() + ctx.newId();
  state.players.push({ id: playerId, seat, name, isBot: false, isHost: false, token, hand: [null, null, null, null] });
  state.players.sort((a, b) => a.seat - b.seat);
  addLog(state, ctx, `${name} took seat ${seat + 1}.`);
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
  pruneReveals(state, ctx.now);
  const actor = state.players.find((p) => p.id === env.playerId);
  if (!actor) throw new GameError("NOT_FOUND", "You are not seated at this table.");

  let note: ApplyResult["note"];
  const a = env.action;
  switch (a.type) {
    case "start": doStart(state, actor, ctx); break;
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
    case "blindSwap": doBlindSwap(state, actor, a.myCardId, a.theirCardId, ctx); break;
    case "kingLook": doKingLook(state, actor, a.cardIdA, a.cardIdB, ctx); break;
    case "kingDecide": doKingDecide(state, actor, a.swap, ctx); break;
    case "skipPower": doSkipPower(state, actor, ctx); break;
    case "stick": note = doStick(state, actor, a.cardId, ctx); break;
    case "give": doGive(state, actor, a.cardId, ctx); break;
    case "playAgain": doPlayAgain(state, actor, ctx); break;
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
  state.round = 1;
  state.leadSeat = 0;
  dealRound(state, ctx);
}

function doPlayAgain(state: GameState, actor: Player, ctx: EngineCtx) {
  requirePhase(state, ["scoring"]);
  if (actor.id !== state.hostId) throw new GameError("NOT_HOST", "Only the host can start the next round.");
  const last = state.results[state.results.length - 1];
  state.round += 1;
  state.leadSeat = last ? last.nextLeadSeat : 0;
  dealRound(state, ctx);
}

function fillBots(state: GameState, ctx: EngineCtx) {
  let botIndex = 0;
  while (state.players.length < SEATS) {
    const seat = nextOpenSeat(state);
    const name = BOT_NAMES[botIndex++];
    state.players.push({ id: ctx.newId(), seat, name, isBot: true, isHost: false, hand: [null, null, null, null] });
  }
  state.players.sort((a, b) => a.seat - b.seat);
  const bots = state.players.filter((p) => p.isBot).map((p) => p.name);
  if (bots.length) addLog(state, ctx, `${joinNames(bots)} filled the empty seats.`);
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
  state.cambio = null;
  state.reveals = [];
  state.botKnown = {};
  for (const p of state.players) {
    p.hand = [null, null, null, null];
    for (let i = 0; i < 4; i++) p.hand[i] = state.deck.pop()!;
  }
  state.phase = "peek";
  state.openingPeekUntil = ctx.now + OPENING_PEEK_MS;
  for (const p of state.players) {
    const bottom = [p.hand[2]!, p.hand[3]!];
    if (p.isBot) remember(state, p.id, bottom);
    else addReveal(state, ctx, p.id, "opening", bottom, state.openingPeekUntil);
  }
  addLog(state, ctx, `Round ${state.round}. Cards dealt.`, "accent");
}

function doAdvance(state: GameState, ctx: EngineCtx): boolean {
  if (state.phase !== "peek") return false;
  if (state.openingPeekUntil !== null && ctx.now < state.openingPeekUntil - ADVANCE_TOLERANCE_MS) return false;
  state.phase = "playing";
  state.reveals = state.reveals.filter((r) => r.kind !== "opening");
  const lead = state.players.find((p) => p.seat === state.leadSeat) ?? state.players[0];
  state.turn = { playerId: lead.id, stage: "draw", drawnCardId: null };
  addLog(state, ctx, `Cards down. ${lead.name} leads.`);
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
  addLog(state, ctx, `${actor.name} drew a card.`);
}

function doPlace(state: GameState, actor: Player, ctx: EngineCtx) {
  requireTurn(state, actor, "decide");
  const id = state.turn!.drawnCardId!;
  const card = state.cards[id];
  state.turn!.drawnCardId = null;
  toDiscard(state, id);
  const power = powerOf(card);
  addLog(state, ctx, power ? `${actor.name} placed ${shortLabel(card)}, a power card.` : `${actor.name} placed ${shortLabel(card)}.`, power ? "accent" : "neutral");
  if (power && powerIsUsable(state, actor, power)) {
    state.pendingPower = { playerId: actor.id, kind: power };
    state.turn!.stage = "power";
    return;
  }
  if (power) addLog(state, ctx, `No valid target for the power. It fizzles.`);
  endTurn(state, ctx);
}

function doSwap(state: GameState, actor: Player, cardId: string, ctx: EngineCtx) {
  requireTurn(state, actor, "decide");
  const slot = actor.hand.indexOf(cardId);
  if (slot < 0) throw new GameError("INVALID_TARGET", "Pick one of your own cards to swap.");
  const drawn = state.turn!.drawnCardId!;
  const old = state.cards[cardId];
  actor.hand[slot] = drawn;
  state.turn!.drawnCardId = null;
  toDiscard(state, cardId);
  addLog(state, ctx, `${actor.name} swapped the drawn card in and let go of ${shortLabel(old)}.`);
  endTurn(state, ctx);
}

function doCallCambio(state: GameState, actor: Player, ctx: EngineCtx) {
  requirePhase(state, ["playing"]);
  requireTurn(state, actor, "draw");
  addLog(state, ctx, `${actor.name} called Cambio. Everyone else gets one more turn.`, "accent");
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
  reveal(state, ctx, actor, "peekOwn", [cardId], ctx.now + PEEK_REVEAL_MS);
  addLog(state, ctx, `${actor.name} peeked at one of their own cards.`);
  endTurn(state, ctx);
}

function doPeekOther(state: GameState, actor: Player, cardId: string, ctx: EngineCtx) {
  requirePower(state, actor, "peekOther");
  const owner = ownerOf(state, cardId);
  if (!owner || owner.player.id === actor.id) throw new GameError("INVALID_TARGET", "Pick a card from another player.");
  reveal(state, ctx, actor, "peekOther", [cardId], ctx.now + PEEK_REVEAL_MS);
  addLog(state, ctx, `${actor.name} peeked at one of ${owner.player.name}'s cards.`);
  endTurn(state, ctx);
}

function doBlindSwap(state: GameState, actor: Player, myCardId: string, theirCardId: string, ctx: EngineCtx) {
  requirePower(state, actor, "blindSwap");
  const mine = actor.hand.indexOf(myCardId);
  if (mine < 0) throw new GameError("INVALID_TARGET", "Pick one of your own cards to give.");
  const theirs = ownerOf(state, theirCardId);
  if (!theirs || theirs.player.id === actor.id) throw new GameError("INVALID_TARGET", "Pick a card from another player.");
  actor.hand[mine] = theirCardId;
  theirs.player.hand[theirs.slot] = myCardId;
  addLog(state, ctx, `${actor.name} swapped a card blind with ${theirs.player.name}.`);
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
  addLog(state, ctx, `${actor.name} is looking at one of ${a.player.name}'s cards and one of ${b.player.name}'s.`);
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
      a.player.hand[a.slot] = looked.b;
      b.player.hand[b.slot] = looked.a;
      addLog(state, ctx, `${actor.name} swapped the two cards, ${a.player.name}'s for ${b.player.name}'s.`);
    } else {
      addLog(state, ctx, `${actor.name} wanted to swap, but one of the cards had already gone.`);
    }
  } else {
    addLog(state, ctx, `${actor.name} left both cards where they were.`);
  }
  endTurn(state, ctx);
}

function doSkipPower(state: GameState, actor: Player, ctx: EngineCtx) {
  const pp = state.pendingPower;
  if (!pp || pp.playerId !== actor.id) throw new GameError("NO_POWER", "You have no power to skip.");
  state.reveals = state.reveals.filter((r) => !(r.kind === "kingLook" && r.toPlayerId === actor.id));
  addLog(state, ctx, `${actor.name} passed on the ${describePower(pp.kind)}.`);
  endTurn(state, ctx);
}

function powerIsUsable(state: GameState, actor: Player, kind: PowerKind): boolean {
  const others = state.players.filter((p) => p.id !== actor.id && cardCount(p) > 0);
  switch (kind) {
    case "peekOwn": return cardCount(actor) > 0;
    case "peekOther": return others.length > 0;
    case "blindSwap": return cardCount(actor) > 0 && others.length > 0;
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

/* ------------------------------------------------------------------ */
/* Sticking                                                            */
/* ------------------------------------------------------------------ */

export function canStick(state: GameState, playerId: string): boolean {
  if (state.phase !== "playing" && state.phase !== "final") return false;
  if (state.discard.length === 0) return false;
  const p = state.players.find((x) => x.id === playerId);
  if (!p || cardCount(p) === 0) return false;
  if (state.pendingGives.some((g) => g.from === playerId)) return false;
  const t = state.turn;
  if (t && t.playerId === playerId && (t.stage === "draw" || t.stage === "decide")) return false;
  return true;
}

function doStick(state: GameState, actor: Player, cardId: string, ctx: EngineCtx): ApplyResult["note"] {
  if (state.phase !== "playing" && state.phase !== "final") throw new GameError("WRONG_PHASE", "Nothing to stick right now.");
  if (state.discard.length === 0) throw new GameError("CANT_STICK", "The discard pile is empty.");
  if (state.pendingGives.some((g) => g.from === actor.id)) throw new GameError("PENDING_GIVE", "Give a card away first.");
  if (cardCount(actor) === 0) throw new GameError("CANT_STICK", "You have no cards left.");
  const t = state.turn;
  if (t && t.playerId === actor.id && (t.stage === "draw" || t.stage === "decide")) {
    throw new GameError("CANT_STICK", "Finish your turn before sticking.");
  }
  const owner = ownerOf(state, cardId);
  if (!owner) throw new GameError("TOO_LATE", "Too late. That card is already gone.");
  const card = state.cards[cardId];
  const top = state.cards[state.discard[state.discard.length - 1]];
  const own = owner.player.id === actor.id;

  if (ranksMatch(card, top)) {
    owner.player.hand[owner.slot] = null;
    trimHand(owner.player);
    toDiscard(state, cardId);
    addLog(state, ctx, `${actor.name} stuck ${own ? "their own" : `${owner.player.name}'s`} ${shortLabel(card)}.`, "good");
    if (!own) state.pendingGives.push({ from: actor.id, to: owner.player.id });
    if (cardCount(owner.player) === 0) handleZero(state, owner.player, ctx);
    return { kind: "stick", correct: true };
  }

  // The card stays where it is and its value is never shown: a wrong stick
  // must not become a free peek for the table.
  const penalty = drawFromDeck(state, ctx);
  if (penalty) {
    addToHand(actor, penalty);
    addLog(state, ctx, `${actor.name} stuck the wrong card and drew a penalty.`, "bad");
  } else {
    addLog(state, ctx, `${actor.name} stuck the wrong card, but there was no penalty card left to draw.`, "bad");
  }
  return { kind: "stick", correct: false };
}

function doGive(state: GameState, actor: Player, cardId: string, ctx: EngineCtx) {
  const idx = state.pendingGives.findIndex((g) => g.from === actor.id);
  if (idx < 0) throw new GameError("INVALID_TARGET", "You have nothing to give.");
  const give = state.pendingGives[idx];
  const slot = actor.hand.indexOf(cardId);
  if (slot < 0) throw new GameError("INVALID_TARGET", "Pick one of your own cards to give.");
  const to = state.players.find((p) => p.id === give.to)!;
  actor.hand[slot] = null;
  trimHand(actor);
  addToHand(to, cardId);
  state.pendingGives.splice(idx, 1);
  addLog(state, ctx, `${actor.name} handed a card to ${to.name}.`);
  if (cardCount(actor) === 0) handleZero(state, actor, ctx);
  maybeEndRound(state, ctx);
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
    addLog(state, ctx, `${player.name} is out of cards.`, "accent");
  } else {
    addLog(state, ctx, `${player.name} is out of cards. Cambio.`, "accent");
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
    state.turn = { playerId: next, stage: "draw", drawnCardId: null };
    return;
  }

  const cur = state.players.find((p) => p.id === finished)!;
  for (let i = 1; i <= SEATS; i++) {
    const p = state.players.find((x) => x.seat === (cur.seat + i) % SEATS);
    if (p && cardCount(p) > 0) {
      state.turn = { playerId: p.id, stage: "draw", drawnCardId: null };
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
  scoreRound(state, ctx);
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
  const result: RoundResult = { round: state.round, scores, winnerIds, nextLeadSeat };
  state.results.push(result);
  state.phase = "scoring";
  state.turn = null;
  state.pendingPower = null;
  state.pendingGives = [];
  state.reveals = [];
  const names = winners.map((w) => w.name);
  addLog(state, ctx, winners.length > 1
    ? `Round ${state.round} ends in a tie: ${joinNames(names)} on ${min}.`
    : `${names[0]} wins round ${state.round} with ${min}.`, "accent");
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

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
  addLog(state, ctx, `Deck ran out. ${fresh.length} cards reshuffled under ${shortLabel(state.cards[top])}.`);
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
    case "peek": return "in the opening peek";
    case "playing": return "in play";
    case "final": return "in its final turns";
    case "scoring": return "being scored";
  }
}

function addLog(state: GameState, ctx: EngineCtx, text: string, tone: LogEntry["tone"] = "neutral") {
  state.logSeq += 1;
  state.log.push({ seq: state.logSeq, at: ctx.now, text, tone });
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}
