import { describe, expect, it } from "vitest";
import { DEAL_MS, OPENING_PEEK_MS } from "./engine";
import { act, card, makeCtx, readyAll, rig, rigDeck, settleFinalTurns, started, table } from "./testkit";
import type { GameState } from "./types";

type Context = ReturnType<typeof makeCtx>;
const seats = (state: GameState) => state.players.map(({ id, seat }) => ({ id, seat }));

function openRound(state: GameState, ctx: Context): GameState {
  state = readyAll(state, state.players.filter((p) => !p.isBot).map((p) => p.id), ctx);
  ctx.tick(DEAL_MS + OPENING_PEEK_MS);
  return act(state, state.hostId, { type: "advance" }, ctx);
}

function takeTurn(state: GameState, ctx: Context): GameState {
  const id = state.turn!.playerId;
  state = rigDeck(state, [card(ctx.newId(), "2")]);
  state = act(state, id, { type: "draw" }, ctx);
  return act(state, id, { type: "place" }, ctx);
}

function finishRound(state: GameState, winners: string[], ctx: Context): GameState {
  for (const p of state.players) {
    state = rig(state, p.id, [card(ctx.newId(), winners.includes(p.id) ? "A" : "9")]);
  }
  const caller = state.players.find((p) => p.id === state.turn!.playerId)!;
  state = act(state, caller.id, { type: "callCambio" }, ctx);
  // Final turns must follow the same clockwise order as normal turns.
  for (let offset = 1; offset < 4; offset++) {
    const next = state.players.find((p) => p.seat === (caller.seat + offset) % 4)!;
    expect(state.turn?.playerId).toBe(next.id);
    state = takeTurn(state, ctx);
  }
  state = settleFinalTurns(state, ctx);
  expect(state.phase).toBe("scoring");
  expect(state.results.at(-1)!.winnerIds).toEqual(winners);
  return state;
}

function replay(state: GameState, ctx: Context): GameState {
  for (const p of state.players.filter((p) => !p.isBot)) {
    state = act(state, p.id, { type: "playAgain" }, ctx);
  }
  return openRound(state, ctx);
}

describe("fixed clockwise turn order", () => {
  it.each([1, 2, 4])("starts with the host and follows lobby arrival order with %i humans", (humans) => {
    const ctx = makeCtx();
    const { state: lobby, ids, hostId } = table(ctx, humans);
    expect(lobby.players.map((p) => p.id)).toEqual(ids);
    let state = openRound(act(lobby, hostId, { type: "start" }, ctx), ctx);
    const seating = seats(state);
    expect(seating.slice(0, humans)).toEqual(ids.map((id, seat) => ({ id, seat })));
    for (const { id } of seating) {
      expect(state.turn?.playerId).toBe(id);
      state = takeTurn(state, ctx);
      expect(seats(state)).toEqual(seating);
    }
    expect(state.turn?.playerId).toBe(hostId);
  });

  it("uses the actual host for a first round even when their seat is not zero", () => {
    const ctx = makeCtx();
    const { state: lobby, ids } = table(ctx);
    lobby.hostId = ids[2];
    for (const p of lobby.players) p.isHost = p.id === lobby.hostId;
    const seating = seats(lobby);
    let state = openRound(act(lobby, lobby.hostId, { type: "start" }, ctx), ctx);
    for (const id of [ids[2], ids[3], ids[0], ids[1]]) {
      expect(state.turn?.playerId).toBe(id);
      state = takeTurn(state, ctx);
    }
    expect(seats(state)).toEqual(seating);
  });

  it.each(["playAgain", "returnToLobby"] as const)("keeps seats fixed and starts with the latest winner through %s", (route) => {
    const ctx = makeCtx();
    const initial = started(ctx);
    let state = initial.state;
    const seating = seats(state);
    for (const winnerSeat of [2, 1]) {
      state = finishRound(state, [initial.ids[winnerSeat]], ctx);
      if (route === "playAgain") state = replay(state, ctx);
      else {
        state = act(state, initial.ids[3], { type: "returnToLobby" }, ctx);
        state = openRound(act(state, state.hostId, { type: "start" }, ctx), ctx);
      }
      expect(state.round).toBe(state.results.length + 1);
      for (let offset = 0; offset < 4; offset++) {
        expect(state.turn?.playerId).toBe(initial.ids[(winnerSeat + offset) % 4]);
        state = takeTurn(state, ctx);
        expect(seats(state)).toEqual(seating);
      }
      expect(state.turn?.playerId).toBe(initial.ids[winnerSeat]);
    }
  });

  it("follows the winning player when a departure closes up lobby seats", () => {
    const ctx = makeCtx();
    const initial = started(ctx);
    let state = finishRound(initial.state, [initial.ids[2]], ctx);
    state = act(state, initial.ids[1], { type: "leaveTable" }, ctx);
    state = openRound(act(state, state.hostId, { type: "start" }, ctx), ctx);
    expect(state.turn?.playerId).toBe(initial.ids[2]);
    expect(state.leadSeat).toBe(1);
    state = takeTurn(state, ctx);
    expect(state.turn?.playerId).toBe(initial.ids[3]);
  });

  it("returns the lead to the host if the winner leaves", () => {
    const ctx = makeCtx();
    const initial = started(ctx);
    let state = finishRound(initial.state, [initial.ids[2]], ctx);
    state = act(state, initial.ids[2], { type: "leaveTable" }, ctx);
    state = openRound(act(state, state.hostId, { type: "start" }, ctx), ctx);
    expect(state.turn?.playerId).toBe(initial.hostId);
  });

  it.each([false, true])("keeps the earliest seated tied winner as lead (first winner leaves: %s)", (leaves) => {
    const ctx = makeCtx();
    const initial = started(ctx);
    let state = finishRound(initial.state, [initial.ids[1], initial.ids[3]], ctx);
    if (leaves) {
      state = act(state, initial.ids[1], { type: "leaveTable" }, ctx);
      state = openRound(act(state, state.hostId, { type: "start" }, ctx), ctx);
    } else state = replay(state, ctx);
    expect(state.turn?.playerId).toBe(initial.ids[leaves ? 3 : 1]);
  });

  it("lets a winning bot start the replay without moving any seats", () => {
    const ctx = makeCtx();
    const initial = started(ctx, 1);
    const seating = seats(initial.state);
    const winner = initial.state.players[2];
    let state = finishRound(initial.state, [winner.id], ctx);
    state = replay(state, ctx);
    expect(state.turn?.playerId).toBe(winner.id);
    expect(seats(state)).toEqual(seating);
    state = takeTurn(state, ctx);
    expect(state.turn?.playerId).toBe(initial.state.players[3].id);
  });
});
