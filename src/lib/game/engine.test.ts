import { describe, expect, it } from "vitest";
import { applyAction, canStick, cardCount, createGame, DEAL_MS, GameError, joinGame, OPENING_PEEK_MS, ownerOf, READY_TIMEOUT_MS, STICK_WINDOW_MS, TURN_TIMEOUT_MS } from "./engine";
import { cardValue, powerOf } from "./cards";
import { projectFor } from "./view";
import { planBots } from "./bots";
import { act, card, makeCtx, player, readyAll, rig, rigDeck, settleFinalTurns, started, table } from "./testkit";
import type { Action, GameState } from "./types";

const topOf = (s: GameState) => s.cards[s.discard[s.discard.length - 1]];

describe("temporary guest identity", () => {
  it.each(["lobby", "ready", "peek", "playing", "final", "scoring"] as const)("changes only name and avatar during %s, including while paused", (phase) => {
    const ctx = makeCtx();
    const { state, ids } = started(ctx, 2);
    state.phase = phase;
    state.reveals.push({ id: "old-reveal", kind: "peekOwn", toPlayerId: ids[1], cardIds: [state.players[1].hand[0]!], until: ctx.now - 1 });
    for (const paused of [false, true]) {
      const input = { ...state, paused };
      const before = structuredClone(input);
      const result = applyAction(input, { actionId: "guest-edit", playerId: ids[1], action: {
        type: "setGuestIdentity", name: "  New   Guest ", avatarId: 35,
      } }, ctx);
      expect(result.changed).toBe(true);
      expect(result.state).toEqual({ ...before,
        players: before.players.map((p) => p.id === ids[1] ? { ...p, name: "New Guest", avatarId: 35 } : p),
        appliedActionIds: [...before.appliedActionIds, "guest-edit"], updatedAt: ctx.now,
      });
      expect(input).toEqual(before);
      expect(projectFor(result.state, 2, ids[1], ctx.now).public.players[1]).toMatchObject({ name: "New Guest", avatarId: 35 });
      expect(applyAction(result.state, { actionId: "same-identity", playerId: ids[1], action: {
        type: "setGuestIdentity", name: "New Guest", avatarId: 35,
      } }, ctx).changed).toBe(false);
    }
  });

  it("keeps duplicate submissions idempotent", () => {
    const ctx = makeCtx();
    const { state, hostId } = table(ctx, 1);
    const envelope = { actionId: "guest-edit", playerId: hostId, action: { type: "setGuestIdentity" as const, name: "Guest", avatarId: 0 } };
    const result = applyAction(state, envelope, ctx);
    expect(applyAction(result.state, envelope, ctx)).toEqual({ state: result.state, changed: false });
  });

  it("rejects account seats, house bots and spectators", () => {
    const ctx = makeCtx();
    const { state, hostId } = started(ctx, 1);
    state.players[0].profileId = "account";
    for (const id of [hostId, state.players[1].id, "spectator"]) {
      expect(() => act(state, id, { type: "setGuestIdentity", name: "New name", avatarId: 0 }, ctx)).toThrow(GameError);
    }
  });

  it.each([undefined, null, -1, 36, 0.5, "0", {}])("rejects malformed avatar %j without altering the seat", (avatarId) => {
    const ctx = makeCtx();
    const { state, hostId } = table(ctx, 1);
    const before = structuredClone(state);
    expect(() => act(state, hostId, { type: "setGuestIdentity", name: "New name", avatarId } as Action, ctx)).toThrow(/valid avatar/);
    expect(state).toEqual(before);
  });

  it.each([undefined, null, 7, "", "   ", "Cameron", "CaMiLlE", "guest\u0000name"])("rejects malformed or reserved name %j", (name) => {
    const ctx = makeCtx();
    const { state, hostId } = table(ctx, 1);
    expect(() => act(state, hostId, { type: "setGuestIdentity", name, avatarId: 0 } as Action, ctx)).toThrow(GameError);
  });

  it("carries selected guest avatars into new seats and preserves omitted defaults", () => {
    const ctx = makeCtx();
    const { state } = createGame("TEST1", "Guest host", ctx, undefined, 35);
    const selected = joinGame(state, "Guest friend", ctx, undefined, 0).state;
    const defaulted = joinGame(selected, "Guest default", ctx).state;
    expect(defaulted.players.map((p) => [p.profileId, p.avatarId])).toEqual([[null, 35], [null, 0], [null, null]]);
  });
});

describe("mid-round bot handoff", () => {
  it("preserves the exact slots, extra cards, drawn card and turn while revoking the old player", () => {
    const ctx = makeCtx(71);
    const t = started(ctx, 2);
    const s = act(t.state, t.hostId, { type: "draw" }, ctx);
    const human = player(s, t.hostId);
    human.profileId = "departing-account";
    s.discard.push(human.hand[1]!);
    human.hand[1] = null;
    human.hand.push(s.deck.pop()!);
    s.botDifficulty![human.seat] = "hard";
    s.tally[human.id] = { sticks: 2, misses: 1 };
    const before = structuredClone(s);
    const env = { actionId: "leave-once", playerId: human.id, action: { type: "leaveTable" as const } };
    const after = applyAction(s, env, ctx).state;
    const bot = after.players[0];
    expect(s).toEqual(before);
    expect(bot).toMatchObject({ seat: human.seat, hand: human.hand, isBot: true, isHost: false, difficulty: "medium" });
    expect(bot.id).not.toBe(human.id);
    expect(bot.token).toBeUndefined();
    expect(bot.profileId).toBeUndefined();
    expect(after.botDifficulty![bot.seat]).toBe("medium");
    expect(after).toMatchObject({ phase: "playing", round: before.round, cards: before.cards, deck: before.deck,
      discard: before.discard, turn: { ...before.turn!, playerId: bot.id }, results: before.results, hostId: t.ids[1] });
    expect(after.players.slice(1).map((p) => p.hand)).toEqual(before.players.slice(1).map((p) => p.hand));
    expect(after.players[1].isHost).toBe(true);
    expect(after.tally[bot.id]).toEqual({ sticks: 2, misses: 1 });
    expect(after.tally[human.id]).toBeUndefined();
    expect(after.botKnown[bot.id]).toEqual([before.turn!.drawnCardId]);
    expect(projectFor(after, 2, human.id, ctx.now).private).toBeNull();
    expect(() => act(after, human.id, { type: "place" }, ctx)).toThrow(/not seated/);
    expect(applyAction(after, env, ctx).changed).toBe(false);
    const plan = planBots(after, ctx.now, () => 0.5).find((p) => p.playerId === bot.id && ["place", "swap"].includes(p.action.type))!;
    expect(plan).toBeDefined();
    const played = act(after, bot.id, plan.action, ctx);
    expect(played.turn?.drawnCardId).toBeNull();
  });

  it("preserves the opening peek and gives the replacement only that seat's revealed faces", () => {
    const ctx = makeCtx(72);
    const t = table(ctx, 2);
    const s = readyAll(act(t.state, t.hostId, { type: "start" }, ctx), t.ids, ctx);
    const after = act(s, t.ids[1], { type: "leaveTable" }, ctx);
    const bot = after.players[1];
    expect(after).toMatchObject({ phase: "peek", openingPeekUntil: s.openingPeekUntil, dealingUntil: s.dealingUntil, deck: s.deck });
    expect(bot.hand).toEqual(s.players[1].hand);
    expect(after.botKnown[bot.id]).toEqual(bot.hand.slice(2));
    expect(after.reveals).toEqual(s.reveals.filter((r) => r.toPlayerId !== t.ids[1]));
  });

  it("lets the replacement finish a king look without losing the chosen cards", () => {
    const ctx = makeCtx(73);
    const t = started(ctx, 2);
    let s = rigDeck(t.state, [card("takeover-king", "K", "S")]);
    s = act(s, t.hostId, { type: "draw" }, ctx);
    s = act(s, t.hostId, { type: "place" }, ctx);
    const a = s.players[0].hand[0]!, b = s.players[1].hand[0]!;
    s = act(s, t.hostId, { type: "kingLook", cardIdA: a, cardIdB: b }, ctx);
    const after = act(s, t.hostId, { type: "leaveTable" }, ctx);
    const bot = after.players[0];
    expect(after.pendingPower).toEqual({ ...s.pendingPower, playerId: bot.id });
    expect(after.turn).toEqual({ ...s.turn, playerId: bot.id });
    expect(after.botKnown[bot.id].sort()).toEqual([a, b].sort());
    const plan = planBots(after, ctx.now, () => 0.5).find((p) => p.playerId === bot.id && p.action.type === "kingDecide")!;
    expect(plan).toBeDefined();
    expect(act(after, bot.id, plan.action, ctx).pendingPower).toBeNull();
  });

  it("keeps cards owed to and from departing seats and lets their bots give them", () => {
    const ctx = makeCtx(74);
    const t = started(ctx, 3);
    t.state.pendingGives = [
      { from: t.ids[0], to: t.ids[1], since: ctx.now },
      { from: t.ids[1], to: t.ids[2], since: ctx.now },
    ];
    let s = act(t.state, t.ids[0], { type: "leaveTable" }, ctx);
    s = act(s, t.ids[1], { type: "leaveTable" }, ctx);
    expect(s.pendingGives).toEqual([
      { from: s.players[0].id, to: s.players[1].id, since: ctx.now },
      { from: s.players[1].id, to: t.ids[2], since: ctx.now },
    ]);
    for (const giver of s.players.slice(0, 2)) {
      const plan = planBots(s, ctx.now, () => 0.5).find((p) => p.playerId === giver.id && p.action.type === "give")!;
      expect(plan).toBeDefined();
      s = act(s, giver.id, plan.action, ctx);
    }
    expect(s.pendingGives).toEqual([]);
    expect(s.players.map(cardCount)).toEqual([3, 4, 5, 4]);
    expect(s.phase).toBe("playing");
  });

  it("keeps the caller, final turn order, and reaction window until the round scores normally", () => {
    const ctx = makeCtx(75);
    const t = started(ctx, 4);
    let s = act(t.state, t.hostId, { type: "callCambio" }, ctx);
    const turn = s.turn!, remaining = s.cambio!.remaining;
    for (const id of t.ids) s = act(s, id, { type: "leaveTable" }, ctx);
    const replacement = (id: string) => s.players[t.ids.indexOf(id)].id;
    expect(s.phase).toBe("final");
    expect(s.cambio).toEqual({ callerId: replacement(t.hostId), reason: "called", remaining: remaining.map(replacement), zeroedIds: [] });
    expect(s.turn).toEqual({ ...turn, playerId: replacement(turn.playerId) });
    expect(s.results).toEqual([]);
    for (let step = 0; step < 100 && s.phase !== "scoring"; step++) {
      const plan = planBots(s, ctx.now, () => 0.5).sort((a, b) => a.delayMs - b.delayMs)[0];
      expect(plan).toBeDefined();
      ctx.tick(plan.delayMs + 1);
      s = act(s, plan.playerId, plan.action, ctx);
    }
    expect(s.phase).toBe("scoring");
    expect(s.results).toHaveLength(1);
    expect(s.results[0].callerId).toBe(s.players[0].id);
    expect(s.results[0].scores.map((r) => r.playerId).sort()).toEqual(s.players.map((p) => p.id).sort());
  });

  it("does not restart an active final stick window when a player leaves", () => {
    const ctx = makeCtx(76);
    const t = started(ctx, 4);
    let s = act(t.state, t.hostId, { type: "callCambio" }, ctx);
    s.stickWindowUntil = ctx.now + STICK_WINDOW_MS;
    s = act(s, t.ids[2], { type: "leaveTable" }, ctx);
    expect(s.stickWindowUntil).toBe(ctx.now + STICK_WINDOW_MS);
    expect(s.phase).toBe("final");
    expect(s.results).toEqual([]);
  });

  it("agrees to an outstanding pause or resume when its human leaves", () => {
    const ctx = makeCtx(77);
    const t = started(ctx, 3);
    let s = act(t.state, t.hostId, { type: "pauseRequest" }, ctx);
    s = act(s, t.ids[1], { type: "pauseVote", agree: true }, ctx);
    s = act(s, t.ids[2], { type: "leaveTable" }, ctx);
    expect(s.paused).toBe(true);
    ctx.tick(5_000);
    s = act(s, t.hostId, { type: "pauseRequest" }, ctx);
    const turn = s.turn!;
    s = act(s, t.ids[1], { type: "leaveTable" }, ctx);
    expect(s.paused).toBe(false);
    expect(s.pauseVote).toBeNull();
    expect(s.turn).toEqual({ ...turn, startedAt: turn.startedAt + 5_000 });
  });

  it("keeps a paused ready check frozen and opens the peek when the remaining host resumes", () => {
    const ctx = makeCtx(81);
    const t = table(ctx, 2);
    let s = act(t.state, t.hostId, { type: "start" }, ctx);
    s = act(s, t.hostId, { type: "ready" }, ctx);
    s = act(s, t.hostId, { type: "pauseRequest" }, ctx);
    s = act(s, t.ids[1], { type: "pauseVote", agree: true }, ctx);
    ctx.tick(8_000);
    s = act(s, t.ids[1], { type: "leaveTable" }, ctx);
    expect(s).toMatchObject({ phase: "ready", paused: true, openingPeekUntil: null });
    expect(s.readyIds).toContain(s.players[1].id);
    s = act(s, t.hostId, { type: "pauseRequest" }, ctx);
    expect(s).toMatchObject({ phase: "peek", paused: false });
    expect(s.openingPeekUntil).toBe(s.dealingUntil! + OPENING_PEEK_MS);
    expect(s.reveals.find((r) => r.toPlayerId === t.hostId)?.until).toBe(s.openingPeekUntil);
  });

  it.each([78, 79, 80])("finishes with four distinct medium bots after the last human leaves a paused game (seed %i)", (seed) => {
    const ctx = makeCtx(seed);
    const t = started(ctx, 1);
    let s = act(t.state, t.hostId, { type: "pauseRequest" }, ctx);
    expect(s.paused).toBe(true);
    ctx.tick(10_000);
    s = act(s, t.hostId, { type: "leaveTable" }, ctx);
    expect(s.paused).toBe(false);
    expect(s.hostId).toBe("");
    expect(s.turn).toEqual({ ...t.state.turn!, playerId: s.players[0].id, startedAt: t.state.turn!.startedAt + 10_000 });
    expect(new Set(s.players.map((p) => p.name)).size).toBe(4);
    expect(s.players.every((p) => p.isBot && !p.isHost && p.difficulty === "medium")).toBe(true);
    for (let step = 0; step < 600 && s.phase !== "scoring"; step++) {
      const plan = planBots(s, ctx.now, () => 0.5).sort((a, b) => a.delayMs - b.delayMs)[0];
      expect(plan).toBeDefined();
      ctx.tick(plan.delayMs + 1);
      s = act(s, plan.playerId, plan.action, ctx);
      const cards = [...s.deck, ...s.discard, ...s.players.flatMap((p) => p.hand.filter(Boolean)), ...(s.turn?.drawnCardId ? [s.turn.drawnCardId] : [])];
      expect(cards).toHaveLength(54);
      expect(new Set(cards).size).toBe(54);
    }
    expect(s.phase).toBe("scoring");
    expect(s.results).toHaveLength(1);
  });
});

describe("room settings", () => {
  it("lets only the host set Do not disturb and preserves it across rounds and host changes", () => {
    const ctx = makeCtx();
    const t = table(ctx, 2);
    expect(projectFor(t.state, 1, t.hostId, ctx.now).public.doNotDisturb).toBe(false);
    expect(() => act(t.state, t.ids[1], { type: "setDoNotDisturb", enabled: true }, ctx)).toThrow(/Only the host/);
    expect(() => act(t.state, t.hostId, { type: "setDoNotDisturb", enabled: "yes" as unknown as boolean }, ctx)).toThrow(/on or off/);
    const quiet = act(t.state, t.hostId, { type: "setDoNotDisturb", enabled: true }, ctx);
    expect(t.state.doNotDisturb).toBe(false);
    expect(projectFor(quiet, 2, t.ids[1], ctx.now).public.doNotDisturb).toBe(true);
    expect(act(quiet, t.hostId, { type: "start" }, ctx).doNotDisturb).toBe(true);
    const inherited = act(quiet, t.hostId, { type: "leaveTable" }, ctx);
    expect(inherited.doNotDisturb).toBe(true);
    expect(act(inherited, inherited.hostId, { type: "setDoNotDisturb", enabled: false }, ctx).doNotDisturb).toBe(false);
    expect(joinGame(quiet, "Invited by code", ctx).state.players).toHaveLength(3);
  });

  it("supports older saved tables and changes a paused room without advancing play", () => {
    const ctx = makeCtx();
    const t = started(ctx, 2);
    delete t.state.doNotDisturb;
    expect(projectFor(t.state, 1, t.hostId, ctx.now).public.doNotDisturb).toBe(false);
    const paused = { ...t.state, paused: true, pausedAt: ctx.now };
    const quiet = act(paused, t.hostId, { type: "setDoNotDisturb", enabled: true }, ctx);
    expect(quiet.paused).toBe(true);
    expect(quiet.turn).toEqual(paused.turn);
    expect(quiet.cards).toEqual(paused.cards);
    expect(quiet.players).toEqual(paused.players);
    expect(applyAction(quiet, { actionId: "repeat-setting", playerId: t.hostId, action: { type: "setDoNotDisturb", enabled: true } }, ctx).changed).toBe(false);
  });
});

describe("lobby", () => {
  it("creates a game with the host in seat 0 and fills bots on start", () => {
    const ctx = makeCtx();
    const t = table(ctx, 2);
    expect(t.state.players.map((p) => p.seat)).toEqual([0, 1]);
    const ready = act(t.state, t.hostId, { type: "start" }, ctx);
    expect(ready.players.map((p) => p.name)).toEqual(["Host", "P2", "Cameron", "Camila"]);
    expect(ready.players.filter((p) => p.isBot).map((p) => p.seat)).toEqual([2, 3]);
    // Starting deals: four cards each, face down, and *then* the table is
    // asked whether it is ready. The bots are in the moment the cards land.
    expect(ready.phase).toBe("ready");
    expect(ready.deck.length).toBe(54 - 16);
    for (const p of ready.players) expect(cardCount(p)).toBe(4);
    expect(ready.readyIds).toEqual(ready.players.filter((p) => p.isBot).map((p) => p.id));
    // Nothing is shown to anyone yet: the peek has not opened.
    expect(ready.openingPeekUntil).toBeNull();
    expect(ready.reveals).toHaveLength(0);
    const half = act(ready, t.hostId, { type: "ready" }, ctx);
    expect(half.phase).toBe("ready");
    expect(half.reveals).toHaveLength(0);
    // a second click from the same seat changes nothing
    expect(applyAction(half, { actionId: "r2", playerId: t.hostId, action: { type: "ready" } }, ctx).changed).toBe(false);
    const s = act(half, t.ids[1], { type: "ready" }, ctx);
    // The last seat in opens the five second peek, for everyone at once.
    expect(s.phase).toBe("peek");
    expect(s.openingPeekUntil).toBe(s.dealingUntil! + OPENING_PEEK_MS);
    for (const human of [t.hostId, t.ids[1]]) {
      const rev = s.reveals.find((r) => r.toPlayerId === human)!;
      expect(rev.kind).toBe("opening");
      expect(rev.cardIds).toEqual([player(s, human).hand[2], player(s, human).hand[3]]);
    }
  });

  it("says the deal out loud and the peek quietly, so nothing covers the cards", () => {
    const ctx = makeCtx();
    const t = table(ctx, 2);
    const ready = act(t.state, t.hostId, { type: "start" }, ctx);
    // The deal is the round's headline, and it lands while the cards are in
    // the air rather than after anyone has looked at theirs.
    const deal = ready.log[ready.log.length - 1];
    expect(deal.kind).toBe("deal");
    expect(deal.weight).toBe("loud");
    expect(ready.phase).toBe("ready");
    const s = readyAll(ready, t.ids, ctx);
    // The peek opens with a line, never a banner over the table: a loud entry
    // would sit on top of the hands for most of the five seconds.
    const peek = s.log[s.log.length - 1];
    expect(peek.kind).toBe("deal");
    expect(peek.text).toContain("bottom two cards");
    expect(peek.weight).toBe("normal");
    expect(s.log.filter((e) => e.seq > deal.seq && e.weight === "loud")).toEqual([]);
  });

  it("rejects a fifth human and bot names", () => {
    const ctx = makeCtx();
    const open = table(ctx, 2);
    expect(() => joinGame(open.state, "cameron", ctx)).toThrow(/house bots/);
    const t = table(ctx, 4);
    expect(() => joinGame(t.state, "Fifth", ctx)).toThrow(GameError);
    expect(() => createGame("X", "   ", ctx)).toThrow(/Enter a name/);
  });

  it("only the host can start", () => {
    const ctx = makeCtx();
    const t = table(ctx, 2);
    expect(() => act(t.state, t.ids[1], { type: "start" }, ctx)).toThrow(/host/);
  });

  it("deals before the peek: the reveal window opens once the cards have landed", () => {
    const ctx = makeCtx();
    const t = table(ctx, 1);
    const s = readyAll(act(t.state, t.hostId, { type: "start" }, ctx), t.ids, ctx);
    const host = player(s, t.hostId);
    const rev = s.reveals.find((r) => r.toPlayerId === host.id)!;
    expect(rev.kind).toBe("opening");
    expect(rev.cardIds).toEqual([host.hand[2], host.hand[3]]);
    expect(s.dealingUntil).toBe(ctx.now + DEAL_MS);
    expect(s.openingPeekUntil).toBe(ctx.now + DEAL_MS + OPENING_PEEK_MS);
    expect(rev.until).toBe(ctx.now + DEAL_MS + OPENING_PEEK_MS);
    const bot = s.players.find((p) => p.isBot)!;
    expect(s.botKnown[bot.id]).toEqual([bot.hand[2], bot.hand[3]]);
    // advance is refused until the window closes, then idempotent
    expect(applyAction(s, { actionId: "adv1", playerId: host.id, action: { type: "advance" } }, ctx).changed).toBe(false);
    ctx.tick(DEAL_MS);
    // still the peek: the window only starts once the deal is down
    expect(applyAction(s, { actionId: "adv1b", playerId: host.id, action: { type: "advance" } }, ctx).changed).toBe(false);
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
    expect(() => act(s, ids[0], { type: "swap", cardId: "nope" }, ctx)).toThrow(/card on the table/);
    s = act(s, ids[0], { type: "swap", cardId: "h1" }, ctx);
    expect(player(s, ids[0]).hand[0]).toBe("d1");
    expect(topOf(s).id).toBe("h1");
    expect(s.pendingPower).toBeNull();
    expect(s.turn?.playerId).toBe(ids[1]);
  });

  it("the drawn card can be swapped into another player's hand, discarding what was there", () => {
    const ctx = makeCtx();
    const { state, ids } = started(ctx);
    let s = rig(state, ids[2], [card("c1", "A"), card("c2", "2"), card("c3", "5"), card("c4", "3")]);
    s = rigDeck(s, [card("d1", "10")]);
    s = act(s, ids[0], { type: "draw" }, ctx);
    s = act(s, ids[0], { type: "swap", cardId: "c1" }, ctx);
    expect(player(s, ids[2]).hand[0]).toBe("d1");
    expect(cardCount(player(s, ids[2]))).toBe(4);
    expect(topOf(s).id).toBe("c1");
    expect(s.pendingPower).toBeNull();
    expect(s.turn?.playerId).toBe(ids[1]);
    const entry = s.log[s.log.length - 1];
    expect(entry.kind).toBe("swap");
    expect(entry.weight).toBe("loud");
    expect(entry.text).toContain("P3's 1st card");
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
    expect(s.log.at(-2)?.text).toMatch(/shuffled back under 3♠/);
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
    const s = act(state, ids[0], { type: "blindSwap", cardIdA: mine, cardIdB: theirs }, ctx);
    expect(player(s, ids[0]).hand[0]).toBe(theirs);
    expect(player(s, ids[3]).hand[2]).toBe(mine);
    expect(s.reveals).toHaveLength(0);
  });

  it("a blind swap can trade two other players' cards, but not two of one player's", () => {
    const ctx = makeCtx();
    const { state, ids } = withDrawn(ctx, card("d1", "J"));
    const a = player(state, ids[1]).hand[0]!;
    const a2 = player(state, ids[1]).hand[1]!;
    const b = player(state, ids[2]).hand[3]!;
    expect(() => act(state, ids[0], { type: "blindSwap", cardIdA: a, cardIdB: a2 }, ctx)).toThrow(/different players/);
    const s = act(state, ids[0], { type: "blindSwap", cardIdA: a, cardIdB: b }, ctx);
    expect(player(s, ids[1]).hand[0]).toBe(b);
    expect(player(s, ids[2]).hand[3]).toBe(a);
    expect(s.reveals).toHaveLength(0);
    expect(s.turn?.playerId).toBe(ids[1]);
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

  it("sticking stays open to the player whose turn it is, at every stage of it", () => {
    const { ctx, state, ids } = setup();
    // P1 is in the power stage: the card is down, so P1 may stick.
    expect(canStick(state, ids[0])).toBe(true);
    let s = act(state, ids[0], { type: "stick", cardId: "a2" }, ctx);
    expect(player(s, ids[0]).hand).toEqual(["a1", null, "a3", "a4"]);
    // resolve power, now P2's turn, before they have drawn
    s = act(s, ids[0], { type: "peekOwn", cardId: "a3" }, ctx);
    expect(s.turn?.playerId).toBe(ids[1]);
    expect(canStick(s, ids[1])).toBe(true);
    const early = act(s, ids[1], { type: "stick", cardId: "b1" }, ctx);
    expect(player(early, ids[1]).hand).toEqual([null, "b2", "b3", "b4"]);
    // the turn is untouched by the stick: P2 still has to draw
    expect(early.turn).toMatchObject({ playerId: ids[1], stage: "draw" });
    // and again while they are holding a drawn card they have not committed
    s = act(s, ids[1], { type: "draw" }, ctx);
    expect(canStick(s, ids[1])).toBe(true);
    const holding = act(s, ids[1], { type: "stick", cardId: "b1" }, ctx);
    expect(player(holding, ids[1]).hand).toEqual([null, "b2", "b3", "b4"]);
    expect(holding.turn).toMatchObject({ playerId: ids[1], stage: "decide", drawnCardId: s.turn!.drawnCardId });
    // the drawn card is still theirs to place afterwards
    expect(() => act(holding, ids[1], { type: "place" }, ctx)).not.toThrow();
    expect(canStick(s, ids[2])).toBe(true);
  });

  it("a stick that empties the hand of the player holding a drawn card still ends their turn cleanly", () => {
    const { ctx, state, ids } = setup();
    // P2 down to one card, which matches the 7 on the pile
    let s = rig(state, ids[1], [card("b1", "7", "H")]);
    s = act(s, ids[0], { type: "peekOwn", cardId: "a3" }, ctx);
    s = rigDeck(s, [card("d9", "3")]);
    s = act(s, ids[1], { type: "draw" }, ctx);
    s = act(s, ids[1], { type: "stick", cardId: "b1" }, ctx);
    expect(cardCount(player(s, ids[1]))).toBe(0);
    // The server places the held draw immediately; the excluded player has no further move.
    expect(s.phase).toBe("final");
    expect(s.cambio).toMatchObject({ callerId: ids[1], reason: "zero" });
    expect(s.discard.at(-1)).toBe("d9");
    expect(() => act(s, ids[1], { type: "place" }, ctx)).toThrow(/out of this round/);
    expect(s.turn?.playerId).not.toBe(ids[1]);
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
    expect(canStick(s, ids[2])).toBe(true); // sticking never waits on whose turn it is
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
    s = act(s, ids[1], { type: "blindSwap", cardIdA: "b1", cardIdB: "e1" }, ctx);
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
    expect(s.cambio).toEqual({ callerId: ids[0], reason: "called", remaining: [ids[2], ids[3]], zeroedIds: [] });
    expect(s.turn?.playerId).toBe(ids[1]);
    for (const id of [ids[1], ids[2], ids[3]]) {
      expect(s.turn?.playerId).toBe(id);
      s = act(s, id, { type: "draw" }, ctx);
      s = act(s, id, { type: "swap", cardId: player(s, id).hand[0]! }, ctx);
    }
    s = settleFinalTurns(s, ctx);
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
    expect(s.cambio).toEqual({ callerId: ids[2], reason: "zero", remaining: [ids[3], ids[0]], zeroedIds: [ids[2]] });
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
    s = settleFinalTurns(s, ctx);
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
    s = settleFinalTurns(s, ctx);
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
    s = settleFinalTurns(s, ctx);
    expect(s.phase).toBe("scoring");
  });

  it("sticking is never capped at one: every matching card can be stuck in sequence during the final turns, even the player's own last turn", () => {
    const ctx = makeCtx();
    const { state, ids } = started(ctx);
    // Nobody but the last player to act holds a 7, so the only matches
    // available are the two sevens sitting in their own hand.
    let s = rig(state, ids[0], [card("a1", "9"), card("a2", "9"), card("a3", "K", "S"), card("a4", "K", "C")]);
    s = rig(s, ids[1], [card("b1", "9"), card("b2", "K", "S"), card("b3", "K", "C"), card("b4", "9")]);
    s = rig(s, ids[2], [card("c1", "9"), card("c2", "K", "S"), card("c3", "K", "C"), card("c4", "9")]);
    // ids[3] is last in the queue and holds two sevens of their own, plus filler.
    s = rig(s, ids[3], [card("e1", "7", "H"), card("e2", "7", "D"), card("e3", "K", "S"), card("e4", "K", "C")]);
    s = act(s, ids[0], { type: "callCambio" }, ctx);
    expect(s.cambio?.remaining).toEqual([ids[2], ids[3]]);
    for (const id of [ids[1], ids[2]]) {
      s = rigDeck(s, [card(`h${id}`, "K", "H")]); // harmless, carries no power
      s = act(s, id, { type: "draw" }, ctx);
      s = act(s, id, { type: "place" }, ctx);
    }
    // ids[3] takes their own last turn and places a third seven — the card
    // that opens the match against the two still sitting in their hand. A 7
    // carries a peek-own power, which has to be resolved before the turn
    // (and the round) can close.
    s = rigDeck(s, [card("d1", "7", "S")]);
    s = act(s, ids[3], { type: "draw" }, ctx);
    s = act(s, ids[3], { type: "place" }, ctx);
    expect(s.pendingPower).toMatchObject({ playerId: ids[3], kind: "peekOwn" });
    s = act(s, ids[3], { type: "skipPower" }, ctx);
    expect(s.turn).toBeNull();

    // The round is otherwise ready to score, but a card still on the table
    // matches the pile: it must not close out from under it.
    expect(s.phase).toBe("final");
    expect(s.stickWindowUntil).not.toBeNull();
    expect(canStick(s, ids[3])).toBe(true);

    // First stick: the round holds open because a second seven remains.
    s = act(s, ids[3], { type: "stick", cardId: "e1" }, ctx);
    expect(player(s, ids[3]).hand).toEqual([null, "e2", "e3", "e4"]);
    expect(s.phase).toBe("final");
    expect(s.stickWindowUntil).not.toBeNull();

    // The second stick is accepted too. Even with no matches left, the same
    // final window is preserved so its timing never leaks hidden ranks.
    s = act(s, ids[3], { type: "stick", cardId: "e2" }, ctx);
    expect(player(s, ids[3]).hand).toEqual([null, null, "e3", "e4"]);
    expect(s.phase).toBe("final");
    s = settleFinalTurns(s, ctx);
    expect(s.phase).toBe("scoring");
    expect(s.results).toHaveLength(1);
    expect(s.results[0].tally?.[ids[3]]).toMatchObject({ sticks: 2, misses: 0 });
  });

  it("an available stick that nobody claims closes the round once its window runs out, not before", () => {
    const ctx = makeCtx();
    const { state, ids } = started(ctx);
    let s = rig(state, ids[0], [card("a1", "9"), card("a2", "9"), card("a3", "K", "S"), card("a4", "K", "C")]);
    s = rig(s, ids[1], [card("b1", "9"), card("b2", "K", "S"), card("b3", "K", "C"), card("b4", "9")]);
    // ids[2] holds a 7 that nobody ever sticks.
    s = rig(s, ids[2], [card("c1", "7", "H"), card("c2", "K", "S"), card("c3", "K", "C"), card("c4", "9")]);
    s = rig(s, ids[3], [card("e1", "9"), card("e2", "K", "S"), card("e3", "K", "C"), card("e4", "9")]);
    s = act(s, ids[0], { type: "callCambio" }, ctx);
    for (const id of [ids[1], ids[2]]) {
      s = rigDeck(s, [card(`h${id}`, "K", "H")]);
      s = act(s, id, { type: "draw" }, ctx);
      s = act(s, id, { type: "place" }, ctx);
    }
    s = rigDeck(s, [card("d1", "7", "S")]);
    s = act(s, ids[3], { type: "draw" }, ctx);
    s = act(s, ids[3], { type: "place" }, ctx); // carries peek-own; resolve it to close the turn
    s = act(s, ids[3], { type: "skipPower" }, ctx);
    expect(s.phase).toBe("final");
    const deadline = s.stickWindowUntil!;
    expect(deadline).toBe(s.updatedAt + STICK_WINDOW_MS);

    // Not due yet: a timeout this early changes nothing.
    ctx.tick(STICK_WINDOW_MS - 1);
    expect(applyAction(s, { actionId: "sw1", playerId: ids[0], action: { type: "timeout" } }, ctx).changed).toBe(false);
    expect(s.phase).toBe("final");

    // Past the deadline: the window closes even though c1 was never stuck.
    ctx.tick(2);
    s = act(s, ids[0], { type: "timeout" }, ctx);
    expect(s.phase).toBe("scoring");
    expect(player(s, ids[2]).hand[0]).toBe("c1"); // untouched, just scored as-is
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
    s = settleFinalTurns(s, ctx);
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

  it("another round needs every seat, and deals with the winner leading", () => {
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
    s = settleFinalTurns(s, ctx);
    expect(s.results[0].winnerIds).toEqual([ids[2]]);
    expect(s.results[0].nextLeadSeat).toBe(2);
    // Every seat has to ask, not just the host, and asking twice is a no-op.
    s = act(s, hostId, { type: "playAgain" }, ctx);
    expect(s.phase).toBe("scoring");
    expect(applyAction(s, { actionId: "pa-again", playerId: hostId, action: { type: "playAgain" } }, ctx).changed).toBe(false);
    s = act(s, ids[1], { type: "playAgain" }, ctx);
    s = act(s, ids[2], { type: "playAgain" }, ctx);
    expect(s.phase).toBe("scoring");
    s = act(s, ids[3], { type: "playAgain" }, ctx);
    expect(s.round).toBe(2);
    // Every round deals first and asks after: the next one opens on its own
    // ready check, with the cards already down.
    expect(s.phase).toBe("ready");
    expect(s.players.map((p) => p.id)).toEqual(ids);
    for (const p of s.players) expect(cardCount(p)).toBe(4);
    s = readyAll(s, ids, ctx);
    expect(s.phase).toBe("peek");
    ctx.tick(DEAL_MS + OPENING_PEEK_MS);
    s = act(s, hostId, { type: "advance" }, ctx);
    expect(s.turn?.playerId).toBe(ids[2]);
  });

  it("bots are in for another round the moment it is scored, so a table only waits on people", () => {
    const ctx = makeCtx(7);
    const { state, ids, hostId } = started(ctx, 2);
    let s = rig(state, ids[0], [card("a1", "9")]);
    s = rig(s, ids[1], [card("b1", "A")]);
    s = act(s, ids[0], { type: "callCambio" }, ctx);
    for (const p of s.players.filter((x) => x.id !== ids[0])) {
      s = rigDeck(s, [card(`z${p.id}`, "2")]);
      s = act(s, p.id, { type: "draw" }, ctx);
      s = act(s, p.id, { type: "place" }, ctx);
      if (s.pendingPower) s = act(s, p.id, { type: "skipPower" }, ctx);
    }
    s = settleFinalTurns(s, ctx);
    expect(s.phase).toBe("scoring");
    const bots = s.players.filter((p) => p.isBot).map((p) => p.id);
    expect(s.replayVotes.sort()).toEqual(bots.sort());
    s = act(s, hostId, { type: "playAgain" }, ctx);
    expect(s.phase).toBe("scoring"); // still waiting on the other human
    s = act(s, ids[1], { type: "playAgain" }, ctx);
    // Dealt and waiting on the people again; the bots are already in.
    expect(s.phase).toBe("ready");
    expect(s.round).toBe(2);
    expect(s.readyIds.sort()).toEqual(bots.sort());
    expect(readyAll(s, [hostId, ids[1]], ctx).phase).toBe("peek");
  });

  it("one player leaving takes the rest back to the lobby with the seats closed up", () => {
    const ctx = makeCtx(11);
    const { state, ids, hostId } = started(ctx, 3);
    let s = rig(state, ids[0], [card("a1", "9")]);
    s = act(s, ids[0], { type: "callCambio" }, ctx);
    for (const p of s.players.filter((x) => x.id !== ids[0])) {
      s = rigDeck(s, [card(`z${p.id}`, "2")]);
      s = act(s, p.id, { type: "draw" }, ctx);
      s = act(s, p.id, { type: "place" }, ctx);
      if (s.pendingPower) s = act(s, p.id, { type: "skipPower" }, ctx);
    }
    s = settleFinalTurns(s, ctx);
    expect(s.phase).toBe("scoring");
    s = act(s, ids[1], { type: "leaveTable" }, ctx);
    expect(s.phase).toBe("lobby");
    expect(s.players.map((p) => p.id)).toEqual([ids[0], ids[2]]);
    expect(s.players.map((p) => p.seat)).toEqual([0, 1]);
    expect(s.players.every((p) => cardCount(p) === 0)).toBe(true);
    expect(s.replayVotes).toEqual([]);
    expect(s.results).toHaveLength(1);
    // The table plays on: bots fill the seats again and the round count carries.
    s = act(s, hostId, { type: "start" }, ctx);
    expect(s.round).toBe(2);
    expect(s.players).toHaveLength(4);
  });

  it("the last seat leaving orphans the table, and the next to join inherits it", () => {
    const ctx = makeCtx(13);
    const t = table(ctx, 1);
    const empty = act(t.state, t.hostId, { type: "leaveTable" }, ctx);
    expect(empty.players).toHaveLength(0);
    const { state: rejoined, playerId } = joinGame(empty, "Late", ctx);
    expect(rejoined.hostId).toBe(playerId);
    expect(rejoined.players[0].isHost).toBe(true);
    const set = act(rejoined, playerId, { type: "start" }, ctx);
    expect(set.phase).toBe("ready");
    expect(act(set, playerId, { type: "ready" }, ctx).phase).toBe("peek");
  });

  it("the host leaving hands the table to the next seat", () => {
    const ctx = makeCtx(12);
    const t = table(ctx, 3);
    const s = act(t.state, t.hostId, { type: "leaveTable" }, ctx);
    expect(s.hostId).toBe(t.ids[1]);
    expect(s.players.find((p) => p.id === t.ids[1])!.isHost).toBe(true);
    expect(s.phase).toBe("lobby");
  });
});

describe("hosting follows human join order", () => {
  function withEarlierSeatFilled() {
    const ctx = makeCtx(83);
    const t = started(ctx, 4);
    let state = act(t.state, t.hostId, { type: "leaveTable" }, ctx);
    expect(state.hostId).toBe(t.ids[1]);
    const bot = state.players[0];
    state = act(state, bot.id, { type: "draw" }, ctx);
    state = act(state, bot.id, { type: "swap", cardId: bot.hand[0]! }, ctx);
    state = act(state, state.hostId, { type: "callCambio" }, ctx);
    while (state.turn) {
      const id = state.turn.playerId;
      state = act(state, id, { type: "draw" }, ctx);
      state = act(state, id, { type: "swap", cardId: player(state, id).hand[0]! }, ctx);
    }
    state = settleFinalTurns(state, ctx);
    state = act(state, state.hostId, { type: "returnToLobby" }, ctx);
    const joined = joinGame(state, "Late arrival", ctx);
    expect(player(joined.state, joined.playerId).seat).toBe(0);
    return { ...t, state: joined.state, newcomer: joined.playerId, ctx };
  }

  it.each(["lobby", "ready", "peek", "playing", "final", "scoring"] as const)("promotes the earliest remaining human instead of a newer lower seat in %s", (phase) => {
    const t = withEarlierSeatFilled();
    let state = t.state;
    if (phase !== "lobby") state = act(state, state.hostId, { type: "start" }, t.ctx);
    // The departure rule is shared across all active stages and results.
    state.phase = phase;
    const host = player(state, t.ids[1]);
    const before = structuredClone(state);
    const after = act(state, host.id, { type: "leaveTable" }, t.ctx);
    expect(state).toEqual(before);
    expect(after.hostId).toBe(t.ids[2]);
    expect(after.players.filter((p) => p.isHost).map((p) => p.id)).toEqual([t.ids[2]]);
    expect(player(after, t.newcomer).isHost).toBe(false);
    expect(after.humanJoinOrder).toEqual([t.ids[2], t.ids[3], t.newcomer]);
    if (phase !== "lobby" && phase !== "scoring") {
      expect(after.phase).toBe(phase);
      expect(after.players.find((p) => p.seat === host.seat)).toMatchObject({ isBot: true, isHost: false, difficulty: "medium", hand: host.hand });
    }
    expect(act(after, t.ids[2], { type: "setDoNotDisturb", enabled: true }, t.ctx).doNotDisturb).toBe(true);
    expect(() => act(after, t.newcomer, { type: "setDoNotDisturb", enabled: true }, t.ctx)).toThrow(/Only the host/);
  });

  it("keeps arrival order across departures, signup, compaction and later returns", () => {
    const t = withEarlierSeatFilled();
    const token = player(t.state, t.ids[2]).token!;
    let state = applyAction(t.state, { actionId: "join-order-signup", playerId: null,
      action: { type: "claimIdentity", token, profileId: "early-account", displayName: "New identity", avatarId: 25 } }, t.ctx).state;
    const departed = t.ids[1];
    state = act(state, departed, { type: "leaveTable" }, t.ctx);
    expect(state.hostId).toBe(t.ids[2]);
    const returning = joinGame(state, "Returning host", t.ctx);
    expect(returning.state.hostId).toBe(t.ids[2]);
    state = act(returning.state, t.ids[2], { type: "leaveTable" }, t.ctx);
    expect(state.hostId).toBe(t.ids[3]);
    state = act(state, t.ids[3], { type: "leaveTable" }, t.ctx);
    expect(state.hostId).toBe(t.newcomer);
    expect(state.humanJoinOrder).toEqual([t.newcomer, returning.playerId]);
  });

  it("skips a departed nonhost without changing the current host", () => {
    const t = withEarlierSeatFilled();
    let state = act(t.state, t.ids[2], { type: "leaveTable" }, t.ctx);
    expect(state.hostId).toBe(t.ids[1]);
    expect(state.humanJoinOrder).toEqual([t.ids[1], t.ids[3], t.newcomer]);
    state = act(state, t.ids[1], { type: "leaveTable" }, t.ctx);
    expect(state.hostId).toBe(t.ids[3]);
  });

  it.each([false, true])("recovers legacy join order with trimmed history=%s", (trimmed) => {
    const t = withEarlierSeatFilled();
    delete t.state.humanJoinOrder;
    if (trimmed) t.state.log = t.state.log.filter((entry) => entry.actorId === t.newcomer);
    const after = act(t.state, t.ids[1], { type: "leaveTable" }, t.ctx);
    expect(after.hostId).toBe(t.ids[2]);
    expect(after.humanJoinOrder).toEqual([t.ids[2], t.ids[3], t.newcomer]);
    expect(t.state.humanJoinOrder).toBeUndefined();
  });

  it("records old seats before a newcomer even if no legacy log survives", () => {
    const ctx = makeCtx(84);
    const t = table(ctx, 3);
    delete t.state.humanJoinOrder;
    t.state.log = [];
    t.state.players.forEach((p) => { p.seat++; });
    const joined = joinGame(t.state, "New in seat zero", ctx);
    expect(player(joined.state, joined.playerId).seat).toBe(0);
    const after = act(joined.state, t.hostId, { type: "leaveTable" }, ctx);
    expect(after.hostId).toBe(t.ids[1]);
    expect(after.humanJoinOrder).toEqual([t.ids[1], t.ids[2], joined.playerId]);
  });
});

describe("returning to the table after scoring", () => {
  function scored(humans = 4, hostLeft = false) {
    const ctx = makeCtx(82);
    const t = started(ctx, humans);
    let state = t.state;
    if (hostLeft) {
      state = act(state, t.hostId, { type: "leaveTable" }, ctx);
      const bot = state.players[0];
      state = act(state, bot.id, { type: "draw" }, ctx);
      state = act(state, bot.id, { type: "swap", cardId: bot.hand[0]! }, ctx);
    }
    state = act(state, state.hostId, { type: "callCambio" }, ctx);
    while (state.turn) {
      const id = state.turn.playerId;
      state = act(state, id, { type: "draw" }, ctx);
      state = act(state, id, { type: "swap", cardId: player(state, id).hand[0]! }, ctx);
    }
    state = settleFinalTurns(state, ctx);
    expect(state.phase).toBe("scoring");
    return { ...t, state, ctx };
  }

  it("lets a nonhost bring everyone back without losing seats, credentials or results", () => {
    const t = scored();
    t.state.players.forEach((p, index) => { p.profileId = `account-${index}`; p.avatarId = index; });
    let state = act(t.state, t.hostId, { type: "setDoNotDisturb", enabled: true }, t.ctx);
    state = act(state, t.ids[1], { type: "playAgain" }, t.ctx);
    const before = structuredClone(state);
    const returned = act(state, t.ids[1], { type: "returnToLobby" }, t.ctx);
    expect(state).toEqual(before);
    expect(returned.players).toEqual(before.players.map((p) => ({ ...p, hand: [null, null, null, null] })));
    expect(returned).toMatchObject({
      code: before.code, hostId: before.hostId, phase: "lobby", round: before.round,
      doNotDisturb: true, results: before.results, botDifficulty: before.botDifficulty,
      turn: null, turnsTaken: 0, pendingPower: null, pendingGives: [], cambio: null,
      cards: {}, deck: [], discard: [], reveals: [], botKnown: {}, botHints: {}, botMissedTop: {},
      readyIds: [], replayVotes: [], readyDeadline: null, dealingUntil: null, openingPeekUntil: null,
      paused: false, pauseVote: null, pausedAt: null, pausedBy: null, stickWindowUntil: null, tally: {},
    });
    for (const id of t.ids) expect(projectFor(returned, 2, id, t.ctx.now).private?.playerId).toBe(id);
    expect(returned.log.at(-1)?.text).toContain("Everyone stays seated");
    const next = act(returned, t.hostId, { type: "start" }, t.ctx);
    expect(next.phase).toBe("ready");
    expect(next.round).toBe(2);
    expect(next.players.map((p) => p.id)).toEqual(t.ids);
    expect(next.players.every((p) => cardCount(p) === 4)).toBe(true);
    expect(next.results).toEqual(before.results);
  });

  it("opens bot seats for friends while keeping human positions and the replacement host", () => {
    const t = scored(3, true);
    const state = act(t.state, t.state.hostId, { type: "setBotDifficulty", seat: 3, difficulty: "hard" }, t.ctx);
    const returned = act(state, t.ids[2], { type: "returnToLobby" }, t.ctx);
    expect(returned.hostId).toBe(t.ids[1]);
    expect(returned.players.map((p) => ({ id: p.id, seat: p.seat, isHost: p.isHost }))).toEqual([
      { id: t.ids[1], seat: 1, isHost: true }, { id: t.ids[2], seat: 2, isHost: false },
    ]);
    const joined = joinGame(returned, "New friend", t.ctx);
    expect(player(joined.state, joined.playerId).seat).toBe(0);
    const next = act(joined.state, returned.hostId, { type: "start" }, t.ctx);
    expect(next.phase).toBe("ready");
    expect(next.players).toHaveLength(4);
    expect(next.players.find((p) => p.seat === 3)).toMatchObject({ isBot: true, difficulty: "hard" });
    expect(next.results).toEqual(state.results);
    expect(next.round).toBe(2);
  });

  it("handles repeated clicks and a pending replay request without starting a round", () => {
    const t = scored(2);
    const state = act(t.state, t.hostId, { type: "playAgain" }, t.ctx);
    const env = { actionId: "back-together", playerId: t.ids[1], action: { type: "returnToLobby" as const } };
    const returned = applyAction(state, env, t.ctx).state;
    expect(applyAction(returned, env, t.ctx)).toMatchObject({ state: returned, changed: false });
    expect(applyAction(returned, { ...env, playerId: t.hostId, actionId: "other-player-back" }, t.ctx).changed).toBe(false);
    expect(() => act(returned, t.ids[1], { type: "playAgain" }, t.ctx)).toThrow(/Not possible/);
    const next = act(returned, t.hostId, { type: "start" }, t.ctx);
    expect(() => act(next, t.ids[1], { type: "returnToLobby" }, t.ctx)).toThrow(/Not possible/);
    // If unanimous replay won the race, a stale return request cannot cancel the new deal.
    const replayed = act(state, t.ids[1], { type: "playAgain" }, t.ctx);
    expect(replayed.phase).toBe("ready");
    expect(() => act(replayed, t.hostId, { type: "returnToLobby" }, t.ctx)).toThrow(/Not possible/);
  });

  it("rejects bots, spectators and attempts to cancel an active round", () => {
    const t = scored(2);
    expect(() => act(t.state, t.state.players.find((p) => p.isBot)!.id, { type: "returnToLobby" }, t.ctx)).toThrow(/Only players/);
    expect(() => act(t.state, "spectator", { type: "returnToLobby" }, t.ctx)).toThrow(/not seated/);
    for (const phase of ["ready", "peek", "playing", "final"] as const) {
      expect(() => act({ ...t.state, phase }, t.ids[1], { type: "returnToLobby" }, t.ctx)).toThrow(/Not possible/);
    }
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
    s = settleFinalTurns(s, ctx);
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
    s = settleFinalTurns(s, ctx);
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
    s = settleFinalTurns(s, ctx);
    expect(s.phase).toBe("scoring");
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
    let s = readyAll(act(t.state, t.hostId, { type: "start" }, ctx), t.ids, ctx);
    ctx.tick(DEAL_MS + OPENING_PEEK_MS + 1);
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

describe("pausing", () => {
  it("needs every seat, pauses on the last agreement, and freezes play", () => {
    const ctx = makeCtx(20);
    const { state, ids } = started(ctx, 3); // three humans, one bot
    const bot = state.players.find((p) => p.isBot)!;

    let s = act(state, ids[1], { type: "pauseRequest" }, ctx);
    // the requester and every bot are counted straight away
    expect(s.pauseVote).toMatchObject({ kind: "pause", byId: ids[1] });
    expect(s.pauseVote!.agreed.slice().sort()).toEqual([ids[1], bot.id].sort());
    expect(s.paused).toBe(false);
    // play carries on while a request is open
    expect(() => act(s, ids[0], { type: "draw" }, ctx)).not.toThrow();

    s = act(s, ids[0], { type: "pauseVote", agree: true }, ctx);
    expect(s.paused).toBe(false); // one human still to answer
    s = act(s, ids[2], { type: "pauseVote", agree: true }, ctx);
    expect(s.paused).toBe(true);
    expect(s.pausedAt).toBe(ctx.now);
    expect(s.pauseVote).toBeNull();

    for (const a of [{ type: "draw" }, { type: "callCambio" }] as const) {
      expect(() => act(s, ids[0], a, ctx)).toThrow(/paused/i);
    }
    expect(canStick(s, ids[1])).toBe(false);
    expect(planBots(s, ctx.now, () => 0)).toEqual([]);
  });

  it("a single decline cancels the request and leaves the game running", () => {
    const ctx = makeCtx(21);
    const { state, ids } = started(ctx, 3);
    let s = act(state, ids[0], { type: "pauseRequest" }, ctx);
    s = act(s, ids[1], { type: "pauseVote", agree: true }, ctx);
    s = act(s, ids[2], { type: "pauseVote", agree: false }, ctx);
    expect(s.pauseVote).toBeNull();
    expect(s.paused).toBe(false);
    expect(s.log.at(-1)?.text).toMatch(/declined/);
    expect(() => act(s, ids[0], { type: "draw" }, ctx)).not.toThrow();
  });

  it("resuming needs the same unanimity, and the turn clock picks up where it left off", () => {
    const ctx = makeCtx(22);
    const { state, ids } = started(ctx, 2); // two humans, two bots
    ctx.tick(9_000); // nine seconds of this turn are already gone
    const startedAt = state.turn!.startedAt;

    let s = act(state, ids[0], { type: "pauseRequest" }, ctx);
    s = act(s, ids[1], { type: "pauseVote", agree: true }, ctx);
    expect(s.paused).toBe(true);

    ctx.tick(120_000); // two minutes away from the table
    expect(applyAction(s, { actionId: "t1", playerId: ids[0], action: { type: "timeout" } }, ctx).changed).toBe(false);

    s = act(s, ids[1], { type: "pauseRequest" }, ctx);
    expect(s.pauseVote!.kind).toBe("resume");
    expect(s.paused).toBe(true); // still paused until the last seat agrees
    s = act(s, ids[0], { type: "pauseVote", agree: true }, ctx);
    expect(s.paused).toBe(false);
    expect(s.pausedAt).toBeNull();
    // the turn is 9s old again, not 129s old, so nobody is auto-skipped
    expect(ctx.now - s.turn!.startedAt).toBe(9_000);
    expect(s.turn!.startedAt).toBe(startedAt + 120_000);
    expect(() => act(s, ids[0], { type: "draw" }, ctx)).not.toThrow();
  });

  it("holds the opening peek and its reveals for the length of the pause", () => {
    const ctx = makeCtx(23);
    const t = table(ctx, 2);
    let s = readyAll(act(t.state, t.hostId, { type: "start" }, ctx), t.ids, ctx);
    const peekUntil = s.openingPeekUntil!;
    ctx.tick(1_000);
    s = act(s, t.hostId, { type: "pauseRequest" }, ctx);
    s = act(s, t.ids[1], { type: "pauseVote", agree: true }, ctx);
    ctx.tick(60_000);
    // the peek must not advance underneath a paused table
    expect(applyAction(s, { actionId: "a1", playerId: t.hostId, action: { type: "advance" } }, ctx).changed).toBe(false);
    const frozen = projectFor(s, 1, t.hostId, ctx.now);
    expect(frozen.private!.reveals).toHaveLength(1);

    s = act(s, t.hostId, { type: "pauseRequest" }, ctx);
    s = act(s, t.ids[1], { type: "pauseVote", agree: true }, ctx);
    expect(s.openingPeekUntil).toBe(peekUntil + 60_000);
    expect(s.reveals[0].until).toBe(peekUntil + 60_000);
  });

  it("refuses a second request, a vote with nothing on the table, and a pause outside a round", () => {
    const ctx = makeCtx(24);
    const t = table(ctx, 2);
    expect(() => act(t.state, t.hostId, { type: "pauseRequest" }, ctx)).toThrow(/nothing to pause/);
    const { state, ids } = started(ctx, 3);
    expect(() => act(state, ids[0], { type: "pauseVote", agree: true }, ctx)).toThrow(/no request/);
    const s = act(state, ids[0], { type: "pauseRequest" }, ctx);
    expect(() => act(s, ids[1], { type: "pauseRequest" }, ctx)).toThrow(/already a request/);
    // agreeing twice is a no-op rather than an error
    expect(applyAction(s, { actionId: "v2", playerId: ids[0], action: { type: "pauseVote", agree: true } }, ctx).changed).toBe(false);
  });
});

describe("ready check", () => {
  it("carries a seat that never answers, once the window closes", () => {
    const ctx = makeCtx(41);
    const t = table(ctx, 2);
    let s = act(t.state, t.hostId, { type: "start" }, ctx);
    // The clock starts once the deal has landed, not while it is in the air.
    expect(s.readyDeadline).toBe(ctx.now + DEAL_MS + READY_TIMEOUT_MS);
    s = act(s, t.hostId, { type: "ready" }, ctx);
    // the other human is still reading the rules: nobody has peeked yet
    ctx.tick(DEAL_MS + READY_TIMEOUT_MS - 1);
    expect(applyAction(s, { actionId: "rt0", playerId: t.hostId, action: { type: "timeout" } }, ctx).changed).toBe(false);
    expect(s.phase).toBe("ready");
    ctx.tick(2);
    s = act(s, t.hostId, { type: "timeout" }, ctx);
    expect(s.phase).toBe("peek");
    expect(s.readyDeadline).toBeNull();
    expect(s.log.some((l) => /did not answer the ready check/.test(l.text))).toBe(true);
    // and the check does not fire twice
    expect(applyAction(s, { actionId: "rt2", playerId: t.hostId, action: { type: "timeout" } }, ctx).changed).toBe(false);
  });

  it("bots answer at once and the runner carries the deadline", () => {
    const ctx = makeCtx(42);
    const t = table(ctx, 2);
    const s = act(t.state, t.hostId, { type: "start" }, ctx);
    const bots = s.players.filter((p) => p.isBot);
    expect(bots.map((p) => p.id).every((id) => s.readyIds.includes(id))).toBe(true);
    const plans = planBots(s, ctx.now, () => 0.5);
    expect(plans.map((p) => p.action.type)).toEqual(["timeout"]);
    expect(plans[0].delayMs).toBe(DEAL_MS + READY_TIMEOUT_MS);
  });

  it("the cards are dealt face down and shown to nobody until the last seat is in", () => {
    const ctx = makeCtx(43);
    const t = table(ctx, 3);
    const s = act(t.state, t.hostId, { type: "start" }, ctx);
    // Dealt, but seen by no one: no reveals, no bot memory, no peek clock.
    expect(Object.keys(s.cards)).toHaveLength(54);
    expect(s.players.every((p) => cardCount(p) === 4)).toBe(true);
    expect(s.reveals).toHaveLength(0);
    expect(s.botKnown).toEqual({});
    expect(s.openingPeekUntil).toBeNull();
    // A private view of a dealt-but-unready table shows a seat nothing.
    expect(projectFor(s, 1, t.hostId, ctx.now).private!.reveals).toHaveLength(0);
    // And the round has not begun: there is no turn to take.
    expect(s.turn).toBeNull();
    expect(() => act(s, t.hostId, { type: "draw" }, ctx)).toThrow(/ready check/);

    const peeking = readyAll(s, t.ids, ctx);
    expect(peeking.phase).toBe("peek");
    // Only now does anyone see anything, and only their own bottom two.
    expect(projectFor(peeking, 2, t.hostId, ctx.now).private!.reveals).toHaveLength(1);
    const bot = peeking.players.find((p) => p.isBot)!;
    expect(peeking.botKnown[bot.id]).toEqual([bot.hand[2], bot.hand[3]]);
    // The round itself only starts once the five seconds are up.
    expect(peeking.turn).toBeNull();
    ctx.tick(OPENING_PEEK_MS + DEAL_MS);
    const playing = act(peeking, t.hostId, { type: "advance" }, ctx);
    expect(playing.phase).toBe("playing");
    expect(playing.turn).not.toBeNull();
  });

  it("a seat leaving the ready check hands its dealt cards to a ready medium bot", () => {
    const ctx = makeCtx(44);
    const t = table(ctx, 2);
    let s = act(t.state, t.hostId, { type: "start" }, ctx);
    expect(s.players).toHaveLength(4);
    const hand = player(s, t.ids[1]).hand;
    const deadline = s.readyDeadline;
    s = act(s, t.ids[1], { type: "leaveTable" }, ctx);
    expect(s.phase).toBe("ready");
    expect(s.players).toHaveLength(4);
    const bot = s.players[1];
    expect(bot).toMatchObject({ seat: 1, isBot: true, difficulty: "medium", hand });
    expect(s.readyIds).toContain(bot.id);
    expect(s.readyIds).not.toContain(t.ids[1]);
    expect(s.readyDeadline).toBe(deadline);
    const peeking = act(s, t.hostId, { type: "ready" }, ctx);
    expect(peeking.phase).toBe("peek");
    expect(peeking.botKnown[bot.id]).toEqual(hand.slice(2));
  });

  it("the ready check is projected to every seat", () => {
    const ctx = makeCtx(45);
    const t = table(ctx, 2);
    const s = act(t.state, t.hostId, { type: "start" }, ctx);
    const v = projectFor(s, 1, t.ids[1], ctx.now).public;
    expect(v.phase).toBe("ready");
    expect(v.readyIds).toEqual(s.readyIds);
    expect(v.readyDeadline).toBe(s.readyDeadline);
  });
});

describe("bot difficulty", () => {
  it("is the host's call, is kept per seat, and reaches the bot that fills it", () => {
    const ctx = makeCtx(51);
    const t = table(ctx, 2);
    expect(() => act(t.state, t.ids[1], { type: "setBotDifficulty", seat: 3, difficulty: "hard" }, ctx)).toThrow(/host/);
    let s = act(t.state, t.hostId, { type: "setBotDifficulty", seat: 2, difficulty: "easy" }, ctx);
    s = act(s, t.hostId, { type: "setBotDifficulty", seat: 3, difficulty: "hard" }, ctx);
    expect(s.botDifficulty).toEqual(["medium", "medium", "easy", "hard"]);
    // setting the same level twice changes nothing
    expect(applyAction(s, { actionId: "d1", playerId: t.hostId, action: { type: "setBotDifficulty", seat: 3, difficulty: "hard" } }, ctx).changed).toBe(false);
    s = act(s, t.hostId, { type: "start" }, ctx);
    expect(s.players.map((p) => p.difficulty ?? null)).toEqual([null, null, "easy", "hard"]);
    // and it can still be changed while the table waits on the ready check
    s = act(s, t.hostId, { type: "setBotDifficulty", seat: 2, difficulty: "hard" }, ctx);
    expect(s.players.find((p) => p.seat === 2)!.difficulty).toBe("hard");
    expect(projectFor(s, 1, t.hostId, ctx.now).public.players.find((p) => p.seat === 2)!.difficulty).toBe("hard");
  });

  it("is refused once the cards are down, and refuses a level or seat that does not exist", () => {
    const ctx = makeCtx(52);
    const { state, hostId } = started(ctx, 2);
    expect(() => act(state, hostId, { type: "setBotDifficulty", seat: 2, difficulty: "easy" }, ctx)).toThrow(/Not possible/);
    const t = table(ctx, 2);
    expect(() => act(t.state, t.hostId, { type: "setBotDifficulty", seat: 9, difficulty: "easy" }, ctx)).toThrow(/No such seat/);
    expect(() => act(t.state, t.hostId, { type: "setBotDifficulty", seat: 2, difficulty: "brutal" as "hard" }, ctx)).toThrow(/easy, medium or hard/);
  });

  it("carries the setting into the next round at the same table", () => {
    const ctx = makeCtx(53);
    const t = table(ctx, 1);
    let s = act(t.state, t.hostId, { type: "setBotDifficulty", seat: 1, difficulty: "hard" }, ctx);
    s = readyAll(act(s, t.hostId, { type: "start" }, ctx), t.ids, ctx);
    expect(s.players.find((p) => p.seat === 1)!.difficulty).toBe("hard");
    expect(s.botDifficulty[1]).toBe("hard");
  });
});
