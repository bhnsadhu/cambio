import { describe, expect, it } from "vitest";
import { assessCambio, planBots } from "./bots";
import { applyAction, createGame } from "./engine";
import { act, card, makeCtx, player, rig } from "./testkit";
import type { BotDifficulty, GameState, Rank, Suit } from "./types";

/** Intent-local randomness makes a replay stable without coupling it to planner iteration order. */
function jitterFor(seed: number) {
  return (intent: string) => {
    let hash = 2166136261 ^ seed;
    for (const character of intent) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
    return hash / 2 ** 32;
  };
}

/**
 * Keep intent clocks across moves, as the runner does. Equal action delays
 * isolate the quality of decisions from hard bots' faster reactions.
 */
function completeRound(seed: number, levels: BotDifficulty[]) {
  const ctx = makeCtx(seed);
  const initial = createGame(`STRENGTH${seed}`, "Host", ctx);
  let state = initial.state;
  state.players[0].isBot = true;
  state.players[0].difficulty = levels[0];
  state.botDifficulty = levels.slice();
  state = applyAction(state, { actionId: `start-${seed}`, playerId: initial.hostId, action: { type: "start" } }, ctx).state;
  const jitter = jitterFor(seed);
  const waiting = new Map<string, number>();
  let steps = 0;
  for (; state.phase !== "scoring" && steps < 1500; steps++) {
    const plans = planBots(state, ctx.now, jitter);
    expect(plans.length, `seed ${seed}: no move in ${state.phase}`).toBeGreaterThan(0);
    for (const intent of waiting.keys()) if (!plans.some((plan) => plan.intent === intent)) waiting.delete(intent);
    const scheduled = plans.map((plan) => {
      if (!waiting.has(plan.intent)) waiting.set(plan.intent, ctx.now);
      const isDeadline = plan.action.type === "advance" || plan.action.type === "timeout";
      return { ...plan, due: isDeadline ? ctx.now + plan.delayMs : waiting.get(plan.intent)! + 1000 };
    }).sort((a, b) => a.due - b.due);
    const plan = scheduled[0];
    if (plan.action.type === "callCambio") {
      const belief = assessCambio(state, plan.playerId);
      const context = `seed ${seed}, ${state.players.find((seat) => seat.id === plan.playerId)!.difficulty} call: ${JSON.stringify(belief)}`;
      expect(belief.call, context).toBe(true);
      expect(belief.ownEstimate, context).toBeLessThanOrEqual(belief.strongestOpponent);
      expect(belief.winChance, context).toBeGreaterThanOrEqual(0.64);
      expect(belief.nearWinChance, context).toBeGreaterThanOrEqual(0.8);
    }
    ctx.tick(Math.max(700, plan.due - ctx.now + 1));
    const result = applyAction(state, { actionId: `strength-${seed}-${steps}`, playerId: plan.playerId, action: plan.action }, ctx);
    state = result.state;
    waiting.delete(plan.intent);
    const cards = [
      ...state.deck,
      ...state.discard,
      ...state.players.flatMap((player) => player.hand.filter((id): id is string => id !== null)),
      ...(state.turn?.drawnCardId ? [state.turn.drawnCardId] : []),
    ];
    expect(cards.length, `seed ${seed}, step ${steps}: card conservation`).toBe(54);
    expect(new Set(cards).size, `seed ${seed}, step ${steps}: duplicate card`).toBe(54);
    expect(Object.keys(state.cards).sort()).toEqual(cards.slice().sort());
  }
  expect(state.phase, `seed ${seed} and levels ${levels.join("/")} did not finish after ${steps} legal actions`).toBe("scoring");
  expect(state.results).toHaveLength(1);
  return state;
}

function matchup(first: BotDifficulty, second: BotDifficulty, seeds = 24) {
  const totals: Record<string, { winShare: number; score: number; seats: number; calls: number; callWins: number }> = {
    [first]: { winShare: 0, score: 0, seats: 0, calls: 0, callWins: 0 },
    [second]: { winShare: 0, score: 0, seats: 0, calls: 0, callWins: 0 },
  };
  for (const levels of [[first, second, first, second], [second, first, second, first]]) {
    for (let seed = 1; seed <= seeds; seed++) {
      const state = completeRound(seed, levels);
      const result = state.results[0];
      for (const player of state.players) {
        const tally = totals[player.difficulty!];
        if (result.winnerIds.includes(player.id)) tally.winShare += 1 / result.winnerIds.length;
        if (result.callerId === player.id) {
          tally.calls++;
          if (result.winnerIds.includes(player.id)) tally.callWins++;
        }
        tally.score += result.scores.find((score) => score.playerId === player.id)!.score;
        tally.seats++;
      }
    }
  }
  return Object.fromEntries(Object.entries(totals).map(([level, tally]) => [level, { ...tally, average: tally.score / tally.seats, callWinRate: tally.calls ? tally.callWins / tally.calls : null }]));
}

describe("bot strategy at equal reaction speed", () => {
  it("every level completes full rounds with legal actions and a conserved deck", () => {
    for (const level of ["easy", "medium", "hard"] as const) {
      for (let seed = 101; seed <= 108; seed++) completeRound(seed, [level, level, level, level]);
    }
  }, 30_000);

  it("hard wins more and scores lower than medium across both seatings", () => {
    const result = matchup("hard", "medium");
    expect(result.hard.winShare, JSON.stringify(result)).toBeGreaterThan(result.medium.winShare);
    expect(result.hard.average, JSON.stringify(result)).toBeLessThan(result.medium.average);
  }, 30_000);

  it("basic medium decisions beat easy without a timing advantage", () => {
    const result = matchup("medium", "easy");
    expect(result.medium.winShare, JSON.stringify(result)).toBeGreaterThan(result.easy.winShare);
    expect(result.medium.average, JSON.stringify(result)).toBeLessThan(result.easy.average);
  }, 30_000);
});


function botTable(level: BotDifficulty) {
  const ctx = makeCtx(41);
  const { state: initial, hostId: me } = createGame("BELIEFS", "Host", ctx);
  initial.players[0].isBot = true;
  initial.players[0].difficulty = level;
  let state = act(initial, me, { type: "start" }, ctx);
  ctx.tick(11_000);
  state = act(state, me, { type: "advance" }, ctx);
  // Keep the actor's decisions independent of other bots' private knowledge.
  for (const opponent of state.players) if (opponent.id !== me) opponent.isBot = false;
  state.turnsTaken = 8;
  return { state, me, ctx };
}

function believedHands(level: BotDifficulty, own: Rank[], opponents: Rank[][]) {
  const fixture = botTable(level);
  let state = fixture.state;
  for (const [index, ranks] of [own, ...opponents].entries()) {
    state = rig(state, state.players[index].id, ranks.map((rank, slot) => card(`belief-${index}-${slot}`, rank, rank === "JOKER" ? null : "S")));
  }
  // An explicit knowledge snapshot exercises the call gate independently of
  // each level's memory capacity; none of these totals is a hidden-state read.
  state.botKnown[fixture.me] = state.players.flatMap((seat) => seat.hand.filter((id): id is string => id !== null));
  return { ...fixture, state };
}

describe("Cambio is a comparison with the whole table", () => {
  for (const level of ["easy", "medium", "hard"] as const) {
    it(`${level} never calls on a known losing hand, even late or on a lucky random roll`, () => {
      const { state, me, ctx } = believedHands(level, ["A", "A", "2", "2"], [["JOKER"], ["8", "8", "8", "8"], ["9", "9", "9", "9"]]);
      for (const turns of [8, 40]) {
        state.turnsTaken = turns;
        expect(assessCambio(state, me).call).toBe(false);
        for (const roll of [0, 0.2, 0.5, 0.999]) {
          const plans = planBots(state, ctx.now, () => roll).filter((plan) => plan.playerId === me);
          expect(plans.some((plan) => plan.action.type === "callCambio")).toBe(false);
          expect(plans.some((plan) => plan.action.type === "draw")).toBe(true);
        }
      }
    });

    it(`${level} can call a higher total when it strongly beats all opponents' final-turn prospects`, () => {
      const { state, me, ctx } = believedHands(level, ["5", "5", "4", "4"], [Array<Rank>(4).fill("J"), Array<Rank>(4).fill("Q"), Array<Rank>(4).fill("10")]);
      const belief = assessCambio(state, me);
      expect(belief.ownEstimate).toBe(18);
      expect(belief.call, JSON.stringify(belief)).toBe(true);
      expect(belief.winChance).toBeGreaterThanOrEqual(0.64);
      expect(belief.nearWinChance).toBeGreaterThanOrEqual(0.8);
      for (const roll of [0, 0.5, 0.999]) {
        expect(planBots(state, ctx.now, () => roll).some((plan) => plan.playerId === me && plan.action.type === "callCambio")).toBe(true);
      }
    });
  }

  it("unknown cards carry risk even when the server secretly knows the hand is excellent", () => {
    const { state, me } = believedHands("hard", ["K", "K", "JOKER", "JOKER"], [["A", "A", "A", "A"], ["J", "J", "J", "J"], ["Q", "Q", "Q", "Q"]]);
    state.cards[player(state, me).hand[0]!].suit = "H";
    state.cards[player(state, me).hand[1]!].suit = "D";
    state.botKnown[me] = state.botKnown[me].filter((id) => !player(state, me).hand.includes(id));
    const belief = assessCambio(state, me);
    expect(belief.unknownOwn).toBe(4);
    expect(belief.call).toBe(false);
  });
});

/** Draw an existing card so all fairness fixtures preserve the real deck. */
function drawRank(state: GameState, me: string, rank: Rank, ctx: ReturnType<typeof makeCtx>, suit?: Suit) {
  const cardId = state.deck.find((id) => state.cards[id].rank === rank && (!suit || state.cards[id].suit === suit));
  if (!cardId) throw new Error(`The fixture needs a ${rank}${suit ?? ""} in its deck`);
  const next = structuredClone(state);
  next.deck = next.deck.filter((id) => id !== cardId);
  next.deck.push(cardId);
  return act(next, me, { type: "draw" }, ctx);
}

function decisionStates(level: BotDifficulty) {
  const { state, me, ctx } = botTable(level);
  const cases: { label: string; state: GameState }[] = [{ label: "draw", state }];
  cases.push({ label: "decide", state: drawRank(state, me, "5", ctx) });
  for (const rank of ["7", "9", "J", "K"] as const) {
    const pending = act(drawRank(state, me, rank, ctx, rank === "K" ? "S" : undefined), me, { type: "place" }, ctx);
    cases.push({ label: `power ${rank}`, state: pending });
    if (rank === "K") {
      cases.push({ label: "king decision", state: act(pending, me, { type: "kingLook", cardIdA: player(pending, me).hand[0]!, cardIdB: pending.players[1].hand[0]! }, ctx) });
    }
  }
  // Use a legitimately peeked opponent card, then expose its rank on the pile.
  let sticking = act(drawRank(state, me, "9", ctx), me, { type: "place" }, ctx);
  const target = sticking.players[1].hand[0]!;
  sticking = act(sticking, me, { type: "peekOther", cardId: target }, ctx);
  // Publicly choosing to keep or push a private draw provides a tendency,
  // never permission to inspect the actual value of that drawn card.
  let observed = drawRank(sticking, sticking.players[1].id, "4", ctx);
  observed = act(observed, observed.players[1].id, { type: "swap", cardId: observed.players[1].hand[1]! }, ctx);
  observed = drawRank(observed, observed.players[2].id, "10", ctx);
  observed = act(observed, observed.players[2].id, { type: "swap", cardId: observed.players[3].hand[1]! }, ctx);
  observed = act(drawRank(observed, observed.players[3].id, "2", ctx), observed.players[3].id, { type: "place" }, ctx);
  cases.push({ label: "public kept and pushed cards", state: observed });
  const match = sticking.deck.find((id) => sticking.cards[id].rank === sticking.cards[target].rank);
  if (!match) throw new Error("The fixture needs a public matching rank");
  sticking.deck = sticking.deck.filter((id) => id !== match);
  sticking.discard.push(match);
  cases.push({ label: "stick", state: sticking });
  cases.push({ label: "give after stick", state: act(sticking, me, { type: "stick", cardId: target }, ctx) });
  return { cases, me, ctx };
}

function permuteUnseen(state: GameState, me: string, seed: number) {
  const visible = new Set([...state.discard, ...(state.botKnown[me] ?? [])]);
  if (state.turn?.playerId === me && state.turn.drawnCardId) visible.add(state.turn.drawnCardId);
  const hiddenIds = Object.keys(state.cards).filter((id) => !visible.has(id));
  const rankAndSuit = hiddenIds.map((id) => ({ rank: state.cards[id].rank, suit: state.cards[id].suit }));
  const random = makeCtx(seed).rng;
  for (let index = rankAndSuit.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [rankAndSuit[index], rankAndSuit[other]] = [rankAndSuit[other], rankAndSuit[index]];
  }
  const altered = structuredClone(state);
  hiddenIds.forEach((id, index) => { altered.cards[id] = { id, ...rankAndSuit[index] }; });
  return altered;
}

describe("hidden ranks cannot influence bot decisions", () => {
  for (const level of ["easy", "medium", "hard"] as const) {
    it(`${level} makes identical plans after unseen ranks are permuted through every decision stage`, () => {
      const { cases, me, ctx } = decisionStates(level);
      const jitter = jitterFor(19);
      for (const fixture of cases) {
        const expected = planBots(fixture.state, ctx.now, jitter).filter((plan) => plan.playerId === me);
        for (let seed = 201; seed < 213; seed++) {
          const hiddenWorld = permuteUnseen(fixture.state, me, seed);
          expect(planBots(hiddenWorld, ctx.now, jitter).filter((plan) => plan.playerId === me), `${level}: ${fixture.label}, hidden world ${seed}`).toEqual(expected);
          expect(assessCambio(hiddenWorld, me), `${level}: call beliefs must not inspect hidden ranks`).toEqual(assessCambio(fixture.state, me));
        }
      }
    });
  }
});

function tacticalTable() {
  const fixture = believedHands("hard", ["A", "A"], [["9"], ["K", "K"], ["10", "10", "10", "10"]]);
  fixture.state.cards[fixture.state.players[2].hand[1]!].suit = "C";
  return fixture;
}

describe("hard considers how a move changes every hand", () => {
  it("pushes a high drawn power card onto the actual leader when that beats using its power", () => {
    const { state, me, ctx } = tacticalTable();
    const deciding = drawRank(state, me, "J", ctx);
    const action = planBots(deciding, ctx.now, jitterFor(18)).find((plan) => plan.playerId === me && plan.action.type !== "stick")!.action;
    expect(action.type).toBe("swap");
    if (action.type === "swap") {
      // The one-card opponent has 9; the two-card opponent has 0 and is the threat.
      expect(state.players[2].hand).toContain(action.cardId);
    }
  });

  it("can use a blind swap entirely between opponents to take the lead", () => {
    const { state, me, ctx } = tacticalTable();
    const power = act(drawRank(state, me, "J", ctx), me, { type: "place" }, ctx);
    const action = planBots(power, ctx.now, jitterFor(21)).find((plan) => plan.playerId === me)!.action;
    expect(action.type).toBe("blindSwap");
    if (action.type === "blindSwap") {
      const owners = [action.cardIdA, action.cardIdB].map((id) => power.players.find((seat) => seat.hand.includes(id))!.id).sort();
      expect(owners).toEqual([power.players[2].id, power.players[3].id].sort());
      expect(owners).not.toContain(me);
    }
  });
});
