import { describe, expect, it } from "vitest";
import { applyAction, canStick, cardCount, createGame, GameError, joinGame, OPENING_PEEK_MS, ownerOf, TURN_TIMEOUT_MS } from "./engine";
import { cardValue, powerOf } from "./cards";
import { projectFor } from "./view";
import { act, card, makeCtx, player, rig, rigDeck, started, table } from "./testkit";
import type { GameState } from "./types";

const topOf = (s: GameState) => s.cards[s.discard[s.discard.length - 1]];

describe("lobby", () => {
  it("creates a game with the host in seat 0 and fills bots on start", () => {
    const ctx = makeCtx();
    const t = table(ctx, 2);
    expect(t.state.players.map((p) => p.seat)).toEqual([0, 1]);
    const s = act(t.state, t.hostId, { type: "start" }, ctx);
    expect(s.players.map((p) => p.name)).toEqual(["Host", "P2", "Camryn", "Camron"]);
    expect(s.players.filter((p) => p.isBot).map((p) => p.seat)).toEqual([2, 3]);
    expect(s.phase).toBe("peek");
    expect(s.deck.length).toBe(54 - 16);
    for (const p of s.players) expect(cardCount(p)).toBe(4);
  });

  it("rejects a fifth human and bot names", () => {
    const ctx = makeCtx();
    const open = table(ctx, 2);
    expect(() => joinGame(open.state, "camryn", ctx)).toThrow(/house bots/);
    const t = table(ctx, 4);
    expect(() => joinGame(t.state, "Fifth", ctx)).toThrow(GameError);
    expect(() => createGame("X", "   ", ctx)).toThrow(/Enter a name/);
  });

  it("only the host can start", () => {
    const ctx = makeCtx();
    const t = table(ctx, 2);
    expect(() => act(t.state, t.ids[1], { type: "start" }, ctx)).toThrow(/host/);
  });

  it("gives humans a 10s opening reveal of their bottom two cards, bots remember theirs", () => {
    const ctx = makeCtx();
    const t = table(ctx, 1);
    const s = act(t.state, t.hostId, { type: "start" }, ctx);
    const host = player(s, t.hostId);
    const rev = s.reveals.find((r) => r.toPlayerId === host.id)!;
    expect(rev.kind).toBe("opening");
    expect(rev.cardIds).toEqual([host.hand[2], host.hand[3]]);
    expect(rev.until).toBe(ctx.now + OPENING_PEEK_MS);
    const bot = s.players.find((p) => p.isBot)!;
    expect(s.botKnown[bot.id]).toEqual([bot.hand[2], bot.hand[3]]);
    // advance is refused until the window closes, then idempotent
    expect(applyAction(s, { actionId: "adv1", playerId: host.id, action: { type: "advance" } }, ctx).changed).toBe(false);
    ctx.tick(OPENING_PEEK_MS);
    const s2 = act(s, host.id, { type: "advance" }, ctx);
    expect(s2.phase).toBe("playing");
    expect(s2.turn).toMatchObject({ playerId: host.id, stage: "draw", drawnCardId: null, startedAt: ctx.now });
    expect(s2.reveals).toHaveLength(0);
    expect(applyAction(s2, { actionId: "adv2", playerId: host.id, action: { type: "advance" } }, ctx).changed).toBe(false);
  });
});

describe("turn loop", () => {
  it("draw then place moves the turn clockwise", () => {
    const ctx = makeCtx();
    const { state, ids } = started(ctx);
    let s = rigDeck(state, [card("d1", "3")]);
    s = act(s, ids[0], { type: "draw" }, ctx);
    expect(s.turn?.stage).toBe("decide");
    expect(s.turn?.drawnCardId).toBe("d1");
    expect(() => act(s, ids[1], { type: "draw" }, ctx)).toThrow(/not your turn/i);
    s = act(s, ids[0], { type: "place" }, ctx);
    expect(topOf(s).id).toBe("d1");
    expect(s.turn?.playerId).toBe(ids[1]);
    expect(s.turn?.stage).toBe("draw");
  });

  it("swap keeps the drawn card, discards the old one and never triggers a power", () => {
    const ctx = makeCtx();
    const { state, ids } = started(ctx);
    let s = rig(state, ids[0], [card("h1", "9"), card("h2", "2"), card("h3", "5"), card("h4", "K", "H")]);
    s = rigDeck(s, [card("d1", "J")]);
    s = act(s, ids[0], { type: "draw" }, ctx);
    expect(() => act(s, ids[0], { type: "swap", cardId: "nope" }, ctx)).toThrow(/your own/);
    s = act(s, ids[0], { type: "swap", cardId: "h1" }, ctx);
    expect(player(s, ids[0]).hand[0]).toBe("d1");
    expect(topOf(s).id).toBe("h1");
    expect(s.pendingPower).toBeNull();
    expect(s.turn?.playerId).toBe(ids[1]);
  });

  it("the drawn card is private to the drawer and hidden from everyone else", () => {
    const ctx = makeCtx();
    const { state, ids } = started(ctx);
    const s = act(state, ids[0], { type: "draw" }, ctx);
    const mine = projectFor(s, 5, ids[0], ctx.now);
    const theirs = projectFor(s, 5, ids[1], ctx.now);
    expect(mine.private?.drawnCard?.id).toBe(s.turn?.drawnCardId);
    expect(theirs.private?.drawnCard).toBeNull();
    const json = JSON.stringify(theirs.public);
    expect(json).not.toContain('"rank"'); // no ranks leak before anything is discarded
  });

  it("reshuffles the discard pile under its top card when the deck runs out, with fresh ids", () => {
    const ctx = makeCtx();
    const { state, ids } = started(ctx);
    let s = structuredClone(state);
    // Move the whole deck onto the discard pile; leave a single known card to draw.
    while (s.deck.length) s.discard.push(s.deck.pop()!);
    const recycledIds = s.discard.slice();
    s = rigDeck(s, [card("keep", "3")]);
    s = act(s, ids[0], { type: "draw" }, ctx);
    s = act(s, ids[0], { type: "place" }, ctx); // "keep" is now the top card, deck is empty
    expect(s.deck).toEqual([]);
    s = act(s, ids[1], { type: "draw" }, ctx);  // forces the reshuffle
    expect(s.discard).toEqual(["keep"]);
    expect(s.deck.length).toBe(recycledIds.length - 1); // everything under the top came back, minus the drawn card
    for (const id of recycledIds) expect(s.cards[id]).toBeUndefined();
    expect(Object.keys(s.cards).length).toBe(54 + 1);
    expect(s.log.at(-2)?.text).toMatch(/reshuffled under 3♠/);
  });
});

describe("powers", () => {
  const withDrawn = (ctx: ReturnType<typeof makeCtx>, drawn: ReturnType<typeof card>) => {
    const t = started(ctx);
    let s = rigDeck(t.state, [drawn]);
    s = act(s, t.ids[0], { type: "draw" }, ctx);
    s = act(s, t.ids[0], { type: "place" }, ctx);
    return { ...t, state: s };
  };

  it("7/8 peek at your own card: temporary reveal, then the turn ends", () => {
    const ctx = makeCtx();
    const { state, ids } = withDrawn(ctx, card("d1", "7"));
    expect(state.pendingPower).toEqual({ playerId: ids[0], kind: "peekOwn" });
    expect(state.turn?.stage).toBe("power");
    const other = player(state, ids[1]).hand[0]!;
    expect(() => act(state, ids[0], { type: "peekOwn", cardId: other }, ctx)).toThrow(/your own/);
    const mine = player(state, ids[0]).hand[1]!;
    const s = act(state, ids[0], { type: "peekOwn", cardId: mine }, ctx);
    const v = projectFor(s, 1, ids[0], ctx.now);
    expect(v.private?.reveals[0].cards[0].id).toBe(mine);
    expect(s.turn?.playerId).toBe(ids[1]);
    ctx.tick(7000);
    expect(projectFor(s, 1, ids[0], ctx.now).private?.reveals).toHaveLength(0);
  });

  it("9/10 peek at someone else's card", () => {
    const ctx = makeCtx();
    const { state, ids } = withDrawn(ctx, card("d1", "10"));
    expect(state.pendingPower?.kind).toBe("peekOther");
    const mine = player(state, ids[0]).hand[0]!;
    expect(() => act(state, ids[0], { type: "peekOther", cardId: mine }, ctx)).toThrow(/another player/);
    const target = player(state, ids[2]).hand[3]!;
    const s = act(state, ids[0], { type: "peekOther", cardId: target }, ctx);
    expect(s.reveals[0]).toMatchObject({ toPlayerId: ids[0], cardIds: [target], kind: "peekOther" });
    expect(s.turn?.playerId).toBe(ids[1]);
  });

  it("J/Q blind swap exchanges cards with no reveal", () => {
    const ctx = makeCtx();
    const { state, ids } = withDrawn(ctx, card("d1", "Q"));
    const mine = player(state, ids[0]).hand[0]!;
    const theirs = player(state, ids[3]).hand[2]!;
    const s = act(state, ids[0], { type: "blindSwap", myCardId: mine, theirCardId: theirs }, ctx);
    expect(player(s, ids[0]).hand[0]).toBe(theirs);
    expect(player(s, ids[3]).hand[2]).toBe(mine);
    expect(s.reveals).toHaveLength(0);
  });

  it("black king: look at two cards of different players, then choose to swap", () => {
    const ctx = makeCtx();
    const { state, ids } = withDrawn(ctx, card("d1", "K", "S"));
    expect(state.pendingPower?.kind).toBe("kingLook");
    const a = player(state, ids[1]).hand[0]!;
    const a2 = player(state, ids[1]).hand[1]!;
    const b = player(state, ids[2]).hand[0]!;
    expect(() => act(state, ids[0], { type: "kingLook", cardIdA: a, cardIdB: a2 }, ctx)).toThrow(/different players/);
    expect(() => act(state, ids[0], { type: "kingDecide", swap: true }, ctx)).toThrow(/Look at two cards first/);
    let s = act(state, ids[0], { type: "kingLook", cardIdA: a, cardIdB: b }, ctx);
    expect(s.reveals[0].cardIds).toEqual([a, b]);
    expect(s.turn?.stage).toBe("power");
    s = act(s, ids[0], { type: "kingDecide", swap: true }, ctx);
    expect(player(s, ids[1]).hand[0]).toBe(b);
    expect(player(s, ids[2]).hand[0]).toBe(a);
    expect(s.reveals).toHaveLength(0);
    expect(s.turn?.playerId).toBe(ids[1]);
  });

  it("red king has no power; a power with no valid target fizzles", () => {
    const ctx = makeCtx();
    expect(powerOf(card("x", "K", "H"))).toBeNull();
    expect(powerOf(card("x", "K", "D"))).toBeNull();
    const { state, ids } = withDrawn(ctx, card("d1", "K", "H"));
    expect(state.pendingPower).toBeNull();
    expect(state.turn?.playerId).toBe(ids[1]);
  });

  it("powers can be skipped", () => {
    const ctx = makeCtx();
    const { state, ids } = withDrawn(ctx, card("d1", "8"));
    const s = act(state, ids[0], { type: "skipPower" }, ctx);
    expect(s.pendingPower).toBeNull();
    expect(s.turn?.playerId).toBe(ids[1]);
  });
});

describe("sticking", () => {
  /** P1 places a 7; P2..P4 hands rigged so we know what matches. */
  const setup = () => {
    const ctx = makeCtx();
    const t = started(ctx);
    let s = rig(t.state, t.ids[1], [card("b1", "7", "H"), card("b2", "2"), card("b3", "4"), card("b4", "9")]);
    s = rig(s, t.ids[2], [card("c1", "7", "C"), card("c2", "A"), card("c3", "3"), card("c4", "6")]);
    s = rig(s, t.ids[3], [card("e1", "5"), card("e2", "Q"), card("e3", "7", "D"), card("e4", "10")]);
    s = rig(s, t.ids[0], [card("a1", "K", "H"), card("a2", "7", "S"), card("a3", "8"), card("a4", "J")]);
    s = rigDeck(s, [card("pen", "4"), card("d1", "7", "S")]);
    s = act(s, t.ids[0], { type: "draw" }, ctx);
    s = act(s, t.ids[0], { type: "place" }, ctx); // 7♠ on top, P1 must resolve peekOwn
    return { ctx, ...t, state: s };
  };

  it("a correct stick of your own card removes it, leaving an empty slot", () => {
    const { ctx, state, ids } = setup();
    const s = act(state, ids[1], { type: "stick", cardId: "b1" }, ctx);
    expect(player(s, ids[1]).hand).toEqual([null, "b2", "b3", "b4"]);
    expect(topOf(s).id).toBe("b1");
    expect(s.pendingGives).toEqual([]);
  });

  it("a correct stick of someone else's card makes you owe them a card of your choice", () => {
    const { ctx, state, ids } = setup();
    let s = act(state, ids[2], { type: "stick", cardId: "e3" }, ctx); // P3 sticks P4's 7♦
    expect(player(s, ids[3]).hand).toEqual(["e1", "e2", null, "e4"]);
    expect(s.pendingGives).toMatchObject([{ from: ids[2], to: ids[3] }]);
    expect(() => act(s, ids[2], { type: "stick", cardId: "b1" }, ctx)).toThrow(/Give a card away first/);
    s = act(s, ids[2], { type: "give", cardId: "c4" }, ctx);
    expect(player(s, ids[2]).hand).toEqual(["c1", "c2", "c3", null]);
    expect(player(s, ids[3]).hand).toEqual(["e1", "e2", "c4", "e4"]);
    expect(s.pendingGives).toEqual([]);
  });

  it("a wrong stick draws a penalty card into the sticker's hand, off-turn", () => {
    const { ctx, state, ids } = setup();
    const s = act(state, ids[1], { type: "stick", cardId: "b4" }, ctx); // 9 vs 7
    expect(player(s, ids[1]).hand).toEqual(["b1", "b2", "b3", "b4", "pen"]);
    expect(cardCount(player(s, ids[1]))).toBe(5);
    expect(topOf(s).id).toBe("d1");
  });

  it("the active player cannot stick before finishing their turn action, but can once the card is down", () => {
    const { ctx, state, ids } = setup();
    // P1 is in the power stage: the card is down, so P1 may stick.
    expect(canStick(state, ids[0])).toBe(true);
    let s = act(state, ids[0], { type: "stick", cardId: "a2" }, ctx);
    expect(player(s, ids[0]).hand).toEqual(["a1", null, "a3", "a4"]);
    // resolve power, now P2's turn: P2 cannot stick until they place/swap
    s = act(s, ids[0], { type: "peekOwn", cardId: "a3" }, ctx);
    expect(s.turn?.playerId).toBe(ids[1]);
    expect(canStick(s, ids[1])).toBe(false);
    expect(() => act(s, ids[1], { type: "stick", cardId: "b1" }, ctx)).toThrow(/Finish your turn/);
    s = act(s, ids[1], { type: "draw" }, ctx);
    expect(canStick(s, ids[1])).toBe(false);
    expect(canStick(s, ids[2])).toBe(true);
  });

  it("two players sticking the same card: first wins, the second is 'too late' with no penalty", () => {
    const { ctx, state, ids } = setup();
    const s1 = act(state, ids[1], { type: "stick", cardId: "c1" }, ctx);
    expect(ownerOf(s1, "c1")).toBeNull();
    expect(() => act(s1, ids[3], { type: "stick", cardId: "c1" }, ctx)).toThrow(/Too late/);
    expect(cardCount(player(s1, ids[3]))).toBe(4);
  });

  it("multiple different sticks in one window all resolve independently, in order", () => {
    const { ctx, state, ids } = setup();
    let s = act(state, ids[1], { type: "stick", cardId: "b1" }, ctx);
    s = act(s, ids[3], { type: "stick", cardId: "e3" }, ctx);
    s = act(s, ids[2], { type: "stick", cardId: "c1" }, ctx);
    expect(s.discard.slice(-4).map((id) => s.cards[id].id)).toEqual(["d1", "b1", "e3", "c1"]);
    expect(cardCount(player(s, ids[1]))).toBe(3);
    expect(cardCount(player(s, ids[2]))).toBe(3);
    expect(cardCount(player(s, ids[3]))).toBe(3);
  });

  it("the window follows the top card: after the next player commits, the old rank no longer matches", () => {
    const { ctx, state, ids } = setup();
    let s = act(state, ids[0], { type: "peekOwn", cardId: "a3" }, ctx);
    s = rigDeck(s, [card("d2", "2")]);
    s = act(s, ids[1], { type: "draw" }, ctx);
    s = act(s, ids[1], { type: "place" }, ctx); // 2 on top now, P3 to act
    expect(canStick(s, ids[2])).toBe(false); // active player, hasn't committed
    s = act(s, ids[3], { type: "stick", cardId: "e3" }, ctx); // 7 vs 2 → penalty
    expect(cardCount(player(s, ids[3]))).toBe(5);
    s = act(s, ids[3], { type: "stick", cardId: "b2" }, ctx); // P2's 2 → correct
    expect(cardCount(player(s, ids[1]))).toBe(3);
    expect(s.pendingGives).toMatchObject([{ from: ids[3], to: ids[1] }]);
  });

  it("stick targets use card identity, so a card that moved is still the card you pointed at", () => {
    const { ctx, state, ids } = setup();
    // P1 (power stage) is peekOwn; skip it, then P2 draws a J and blind-swaps b1 (a 7) into P4's hand.
    let s = act(state, ids[0], { type: "skipPower" }, ctx);
    s = rigDeck(s, [card("d2", "J")]);
    s = act(s, ids[1], { type: "draw" }, ctx);
    s = act(s, ids[1], { type: "place" }, ctx);
    s = act(s, ids[1], { type: "blindSwap", myCardId: "b1", theirCardId: "e1" }, ctx);
    expect(player(s, ids[3]).hand[0]).toBe("b1");
    // J is on top now; a 7 no longer matches. Put a 7 back on top via P3.
    s = rigDeck(s, [card("d3", "7", "C")]);
    s = act(s, ids[2], { type: "draw" }, ctx);
    s = act(s, ids[2], { type: "place" }, ctx);
    s = act(s, ids[2], { type: "skipPower" }, ctx);
    s = act(s, ids[0], { type: "stick", cardId: "b1" }, ctx); // now in P4's hand
    expect(s.pendingGives).toMatchObject([{ from: ids[0], to: ids[3] }]);
    expect(player(s, ids[3]).hand[0]).toBeNull();
  });
});

describe("cambio and round end", () => {
  it("calling cambio ends your turn; everyone else gets exactly one more turn in order", () => {
    const ctx = makeCtx();
    const { state, ids } = started(ctx);
    let s = act(state, ids[0], { type: "callCambio" }, ctx);
    expect(s.phase).toBe("final");
    expect(s.cambio).toEqual({ callerId: ids[0], reason: "called", remaining: [ids[2], ids[3]] });
    expect(s.turn?.playerId).toBe(ids[1]);
    for (const id of [ids[1], ids[2], ids[3]]) {
      expect(s.turn?.playerId).toBe(id);
      s = act(s, id, { type: "draw" }, ctx);
      s = act(s, id, { type: "swap", cardId: player(s, id).hand[0]! }, ctx);
    }
    expect(s.phase).toBe("scoring");
    expect(s.results).toHaveLength(1);
    expect(s.turn).toBeNull();
  });

  it("cambio can only be called at the start of your own turn, once per round", () => {
    const ctx = makeCtx();
    const { state, ids } = started(ctx);
    expect(() => act(state, ids[1], { type: "callCambio" }, ctx)).toThrow(/not your turn/i);
    let s = rigDeck(state, [card("d1", "3")]);
    s = act(s, ids[0], { type: "draw" }, ctx);
    expect(() => act(s, ids[0], { type: "callCambio" }, ctx)).toThrow(/Place or swap/);
    s = act(s, ids[0], { type: "place" }, ctx);
    s = act(s, ids[1], { type: "callCambio" }, ctx);
    expect(() => act(s, ids[2], { type: "callCambio" }, ctx)).toThrow(/final turns/);
  });

  it("hitting zero via a stick mid-turn: the active player finishes as their last, others get one more, zero player is done", () => {
    const ctx = makeCtx();
    const { state, ids } = started(ctx);
    // P3 (ids[2]) has a single 5; P1 places a 5 to open the window.
    let s = rig(state, ids[2], [card("c1", "5", "H")]);
    s = rigDeck(s, [card("d1", "5", "S")]);
    s = act(s, ids[0], { type: "draw" }, ctx);
    s = act(s, ids[0], { type: "place" }, ctx); // no power on a 5 → P2's turn now
    expect(s.turn?.playerId).toBe(ids[1]);
    s = act(s, ids[2], { type: "stick", cardId: "c1" }, ctx); // P3 sticks own last card → zero
    expect(cardCount(player(s, ids[2]))).toBe(0);
    expect(s.phase).toBe("final");
    expect(s.cambio).toEqual({ callerId: ids[2], reason: "zero", remaining: [ids[3], ids[0]] });
    // P2 finishes the current turn as their last.
    expect(s.turn?.playerId).toBe(ids[1]);
    s = rigDeck(s, [card("n1", "3"), card("n2", "3"), card("n3", "3")]);
    s = act(s, ids[1], { type: "draw" }, ctx);
    s = act(s, ids[1], { type: "place" }, ctx);
    expect(s.turn?.playerId).toBe(ids[3]);
    s = act(s, ids[3], { type: "draw" }, ctx);
    s = act(s, ids[3], { type: "place" }, ctx);
    expect(s.turn?.playerId).toBe(ids[0]);
    s = act(s, ids[0], { type: "draw" }, ctx);
    s = act(s, ids[0], { type: "place" }, ctx);
    expect(s.phase).toBe("scoring");
    const r = s.results[0];
    expect(r.scores.find((x) => x.playerId === ids[2])!.score).toBe(0);
    expect(r.winnerIds).toContain(ids[2]);
  });

  it("hitting zero by giving away your last card also triggers cambio", () => {
    const ctx = makeCtx();
    const { state, ids } = started(ctx);
    let s = rig(state, ids[2], [card("c1", "9")]);
    s = rig(s, ids[3], [card("e1", "5", "D"), card("e2", "A"), card("e3", "3"), card("e4", "4")]);
    s = rigDeck(s, [card("d1", "5", "S")]);
    s = act(s, ids[0], { type: "draw" }, ctx);
    s = act(s, ids[0], { type: "place" }, ctx);
    s = act(s, ids[2], { type: "stick", cardId: "e1" }, ctx); // P3 sticks P4's 5
    expect(s.phase).toBe("playing");
    s = act(s, ids[2], { type: "give", cardId: "c1" }, ctx);
    expect(cardCount(player(s, ids[2]))).toBe(0);
    expect(s.phase).toBe("final");
    expect(s.cambio?.callerId).toBe(ids[2]);
    expect(player(s, ids[3]).hand).toEqual(["c1", "e2", "e3", "e4"]);
  });

  it("a zero during the final turns just removes that player from the queue", () => {
    const ctx = makeCtx();
    const { state, ids } = started(ctx);
    let s = rig(state, ids[3], [card("e1", "6", "H")]);
    s = act(s, ids[0], { type: "callCambio" }, ctx);
    expect(s.cambio?.remaining).toEqual([ids[2], ids[3]]);
    s = rigDeck(s, [card("d1", "6", "S")]);
    s = act(s, ids[1], { type: "draw" }, ctx);
    s = act(s, ids[1], { type: "place" }, ctx);
    s = act(s, ids[3], { type: "stick", cardId: "e1" }, ctx);
    expect(s.cambio?.remaining).toEqual([]);
    expect(s.cambio?.callerId).toBe(ids[0]);
    expect(s.turn?.playerId).toBe(ids[2]);
    s = rigDeck(s, [card("n1", "3")]);
    s = act(s, ids[2], { type: "draw" }, ctx);
    s = act(s, ids[2], { type: "place" }, ctx);
    expect(s.phase).toBe("scoring");
  });

  it("the round waits for an owed card before scoring", () => {
    const ctx = makeCtx();
    const { state, ids } = started(ctx);
    let s = rig(state, ids[3], [card("e1", "6", "H"), card("e2", "2"), card("e3", "3"), card("e4", "4")]);
    s = rig(s, ids[2], [card("c1", "9"), card("c2", "10"), card("c3", "3"), card("c4", "4")]);
    s = act(s, ids[0], { type: "callCambio" }, ctx);
    for (const id of [ids[1], ids[2]]) {
      s = act(s, id, { type: "draw" }, ctx);
      s = act(s, id, { type: "place" }, ctx);
      if (s.pendingPower) s = act(s, id, { type: "skipPower" }, ctx);
    }
    s = rigDeck(s, [card("d9", "6", "S")]);
    s = act(s, ids[3], { type: "draw" }, ctx);
    s = act(s, ids[3], { type: "place" }, ctx); // last turn done
    expect(s.phase).toBe("scoring");
  });

  it("scores: number=face, J/Q=10, A=1, red K=-1, black K=0, joker=0; lowest wins; ties stand", () => {
    expect(cardValue(card("x", "A"))).toBe(1);
    expect(cardValue(card("x", "J"))).toBe(10);
    expect(cardValue(card("x", "Q"))).toBe(10);
    expect(cardValue(card("x", "K", "H"))).toBe(-1);
    expect(cardValue(card("x", "K", "D"))).toBe(-1);
    expect(cardValue(card("x", "K", "S"))).toBe(0);
    expect(cardValue(card("x", "JOKER", null))).toBe(0);
    expect(cardValue(card("x", "10"))).toBe(10);

    const ctx = makeCtx();
    const { state, ids } = started(ctx);
    let s = rig(state, ids[0], [card("a1", "2"), card("a2", "3")]);
    s = rig(s, ids[1], [card("b1", "A"), card("b2", "4")]);
    s = rig(s, ids[2], [card("c1", "K", "H"), card("c2", "6")]);
    s = rig(s, ids[3], [card("e1", "JOKER", null), card("e2", "5")]);
    s = act(s, ids[0], { type: "callCambio" }, ctx);
    for (const id of [ids[1], ids[2], ids[3]]) {
      s = rigDeck(s, [card(`z${id}`, "2")]);
      s = act(s, id, { type: "draw" }, ctx);
      s = act(s, id, { type: "place" }, ctx);
    }
    expect(s.phase).toBe("scoring");
    const r = s.results[0];
    const score = (id: string) => r.scores.find((x) => x.playerId === id)!.score;
    expect(score(ids[0])).toBe(5);
    expect(score(ids[1])).toBe(5);
    expect(score(ids[2])).toBe(5);
    expect(score(ids[3])).toBe(5);
    expect(r.winnerIds).toEqual(ids); // four-way tie stands
    expect(r.nextLeadSeat).toBe(0);
  });

  it("play again deals a fresh round with the same seats and the winner leading", () => {
    const ctx = makeCtx();
    const { state, ids, hostId } = started(ctx);
    let s = rig(state, ids[0], [card("a1", "9"), card("a2", "9")]);
    s = rig(s, ids[1], [card("b1", "9"), card("b2", "9")]);
    s = rig(s, ids[2], [card("c1", "A")]);
    s = rig(s, ids[3], [card("e1", "9"), card("e2", "9")]);
    s = act(s, ids[0], { type: "callCambio" }, ctx);
    for (const id of [ids[1], ids[2], ids[3]]) {
      s = rigDeck(s, [card(`z${id}`, "2")]);
      s = act(s, id, { type: "draw" }, ctx);
      s = act(s, id, { type: "place" }, ctx);
    }
    expect(s.results[0].winnerIds).toEqual([ids[2]]);
    expect(s.results[0].nextLeadSeat).toBe(2);
    expect(() => act(s, ids[1], { type: "playAgain" }, ctx)).toThrow(/host/);
    s = act(s, hostId, { type: "playAgain" }, ctx);
    expect(s.round).toBe(2);
    expect(s.phase).toBe("peek");
    expect(s.players.map((p) => p.id)).toEqual(ids);
    for (const p of s.players) expect(cardCount(p)).toBe(4);
    ctx.tick(OPENING_PEEK_MS);
    s = act(s, hostId, { type: "advance" }, ctx);
    expect(s.turn?.playerId).toBe(ids[2]);
  });
});

describe("idempotency", () => {
  it("re-applying the same action id is a no-op", () => {
    const ctx = makeCtx();
    const { state, ids } = started(ctx);
    const env = { actionId: "same", playerId: ids[0], action: { type: "draw" } as const };
    const r1 = applyAction(state, env, ctx);
    expect(r1.changed).toBe(true);
    const r2 = applyAction(r1.state, env, ctx);
    expect(r2.changed).toBe(false);
    expect(r2.state).toBe(r1.state);
  });
});


describe("winner determination", () => {
  /** Rig four hands, end the round by cambio, and return the result. */
  const play = (hands: ReturnType<typeof card>[][]) => {
    const ctx = makeCtx(3);
    const { state, ids } = started(ctx);
    let s = state;
    hands.forEach((h, i) => { s = rig(s, ids[i], h); });
    s = act(s, ids[0], { type: "callCambio" }, ctx);
    for (const id of [ids[1], ids[2], ids[3]]) {
      s = rigDeck(s, [card(`f${id}`, "2")]);
      s = act(s, id, { type: "draw" }, ctx);
      s = act(s, id, { type: "place" }, ctx);
    }
    expect(s.phase).toBe("scoring");
    const r = s.results[0];
    return { s, ids, r, score: (id: string) => r.scores.find((x) => x.playerId === id)!.score };
  };

  it("credits the lowest hand, not the first seat or the caller", () => {
    const { ids, r, score } = play([
      [card("a1", "9"), card("a2", "9")],                 // caller, 18
      [card("b1", "5"), card("b2", "5"), card("b3", "5")], // 15
      [card("c1", "Q"), card("c2", "2")],                  // 12
      [card("d1", "3"), card("d2", "4")],                  // 7  <- winner, seat 3
    ]);
    expect(score(ids[3])).toBe(7);
    expect(r.winnerIds).toEqual([ids[3]]);
    expect(r.nextLeadSeat).toBe(3);
  });

  it("scores red kings negative and jokers zero, so a five card hand can still win", () => {
    const { ids, r, score } = play([
      [card("a1", "A")],                                                                        // 1
      [card("b1", "K", "H"), card("b2", "K", "D"), card("b3", "JOKER", null), card("b4", "A"), card("b5", "A")], // -2 + 0 + 2 = 0
      [card("c1", "JOKER", null), card("c2", "K", "S")],                                        // 0
      [card("d1", "2")],                                                                        // 2
    ]);
    expect(score(ids[0])).toBe(1);
    expect(score(ids[1])).toBe(0);
    expect(score(ids[2])).toBe(0);
    expect(score(ids[3])).toBe(2);
    expect(r.winnerIds.sort()).toEqual([ids[1], ids[2]].sort());
    expect(r.nextLeadSeat).toBe(1);
  });

  it("an empty hand scores zero and beats everyone with cards", () => {
    const ctx = makeCtx(4);
    const { state, ids } = started(ctx);
    let s = rig(state, ids[2], [card("c1", "4", "H")]);
    s = rig(s, ids[0], [card("a1", "A")]);
    s = rigDeck(s, [card("d1", "4", "S")]);
    s = act(s, ids[0], { type: "draw" }, ctx);
    s = act(s, ids[0], { type: "place" }, ctx);
    s = act(s, ids[2], { type: "stick", cardId: "c1" }, ctx); // P3 to zero
    s = rigDeck(s, [card("n1", "3"), card("n2", "3"), card("n3", "3")]);
    for (const id of [ids[1], ids[3], ids[0]]) {
      s = act(s, id, { type: "draw" }, ctx);
      s = act(s, id, { type: "place" }, ctx);
    }
    expect(s.phase).toBe("scoring");
    const r = s.results[0];
    expect(r.scores.find((x) => x.playerId === ids[2])!.score).toBe(0);
    expect(r.winnerIds).toEqual([ids[2]]);
  });

  it("scores exactly the cards in each hand at the end, after gives and penalties", () => {
    const ctx = makeCtx(5);
    const { state, ids } = started(ctx);
    let s = rig(state, ids[0], [card("a1", "5", "S"), card("a2", "9")]);
    s = rig(s, ids[1], [card("b1", "5", "H"), card("b2", "3")]);
    s = rig(s, ids[2], [card("c1", "8"), card("c2", "8")]);
    s = rig(s, ids[3], [card("d1", "2"), card("d2", "2")]);
    s = rigDeck(s, [card("pen", "10"), card("x1", "5", "D")]);
    s = act(s, ids[0], { type: "draw" }, ctx);
    s = act(s, ids[0], { type: "place" }, ctx);           // 5♦ on the pile, P2's turn
    s = act(s, ids[3], { type: "stick", cardId: "b1" }, ctx); // P4 sticks P2's 5♥, owes a card
    s = act(s, ids[3], { type: "give", cardId: "d1" }, ctx);  // P4 gives a 2 to P2
    s = act(s, ids[2], { type: "stick", cardId: "c1" }, ctx); // P3 wrong: 8 vs 5 → penalty 10
    s = act(s, ids[1], { type: "callCambio" }, ctx);
    for (const id of [ids[2], ids[3], ids[0]]) {
      s = rigDeck(s, [card(`f${id}`, "3")]);
      s = act(s, id, { type: "draw" }, ctx);
      s = act(s, id, { type: "place" }, ctx);
    }
    const r = s.results[0];
    const score = (id: string) => r.scores.find((x) => x.playerId === id)!.score;
    expect(score(ids[0])).toBe(5 + 9);
    expect(score(ids[1])).toBe(3 + 2);
    expect(score(ids[2])).toBe(8 + 8 + 10);
    expect(score(ids[3])).toBe(2);
    expect(r.winnerIds).toEqual([ids[3]]);
    for (const p of s.players) {
      const cards = r.scores.find((x) => x.playerId === p.id)!.cards.map((c) => c.id).sort();
      expect(cards).toEqual(p.hand.filter((c): c is string => !!c).sort());
    }
  });
});

describe("idle timeout", () => {
  it("opening peek is five seconds", () => {
    expect(OPENING_PEEK_MS).toBe(5000);
  });

  it("does nothing before the deadline or for a bot's turn", () => {
    const ctx = makeCtx(6);
    const t = table(ctx, 1);
    let s = act(t.state, t.hostId, { type: "start" }, ctx);
    ctx.tick(OPENING_PEEK_MS + 1);
    s = act(s, t.hostId, { type: "advance" }, ctx);
    ctx.tick(TURN_TIMEOUT_MS - 1000);
    expect(applyAction(s, { actionId: "t1", playerId: t.hostId, action: { type: "timeout" } }, ctx).changed).toBe(false);
    // hand the turn to a bot and let 30s pass: bots are never timed out
    s = rigDeck(s, [card("d1", "3")]);
    s = act(s, t.hostId, { type: "draw" }, ctx);
    s = act(s, t.hostId, { type: "place" }, ctx);
    expect(s.players.find((p) => p.id === s.turn!.playerId)!.isBot).toBe(true);
    ctx.tick(TURN_TIMEOUT_MS + 5000);
    expect(applyAction(s, { actionId: "t2", playerId: t.hostId, action: { type: "timeout" } }, ctx).changed).toBe(false);
  });

  it("skips an idle human at the draw stage and hands them a penalty card", () => {
    const ctx = makeCtx(7);
    const { state, ids } = started(ctx);
    let s = rigDeck(state, [card("pen", "9")]);
    ctx.tick(TURN_TIMEOUT_MS);
    s = act(s, ids[2], { type: "timeout" }, ctx); // anyone may report it
    expect(player(s, ids[0]).hand).toContain("pen");
    expect(cardCount(player(s, ids[0]))).toBe(5);
    expect(s.turn?.playerId).toBe(ids[1]);
    expect(s.turn?.startedAt).toBe(ctx.now);
    expect(s.log.at(-1)?.text).toMatch(/ran out of time/);
  });

  it("an undecided drawn card goes to the pile with no power, plus the penalty", () => {
    const ctx = makeCtx(8);
    const { state, ids } = started(ctx);
    let s = rigDeck(state, [card("pen", "4"), card("d1", "8")]);
    s = act(s, ids[0], { type: "draw" }, ctx);
    ctx.tick(TURN_TIMEOUT_MS);
    s = act(s, ids[0], { type: "timeout" }, ctx);
    expect(s.discard.at(-1)).toBe("d1");
    expect(s.pendingPower).toBeNull();
    expect(player(s, ids[0]).hand).toContain("pen");
    expect(s.turn?.playerId).toBe(ids[1]);
  });

  it("an owed card that is never handed over is given at random after the timeout", () => {
    const ctx = makeCtx(9);
    const { state, ids } = started(ctx);
    let s = rig(state, ids[1], [card("b1", "6", "H"), card("b2", "2")]);
    s = rig(s, ids[2], [card("c1", "A"), card("c2", "3")]);
    s = rigDeck(s, [card("d1", "6", "S")]);
    s = act(s, ids[0], { type: "draw" }, ctx);
    s = act(s, ids[0], { type: "place" }, ctx);
    s = act(s, ids[2], { type: "stick", cardId: "b1" }, ctx);
    expect(s.pendingGives).toHaveLength(1);
    ctx.tick(TURN_TIMEOUT_MS);
    s = act(s, ids[3], { type: "timeout" }, ctx);
    expect(s.pendingGives).toHaveLength(0);
    expect(cardCount(player(s, ids[2]))).toBe(1);
    // P2 got the owed card and, being idle on their own turn, a penalty card too.
    expect(cardCount(player(s, ids[1]))).toBe(3);
    expect(s.turn?.playerId).toBe(ids[2]);
  });
});
