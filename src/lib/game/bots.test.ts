import { describe, expect, it } from "vitest";
import { planBots } from "./bots";
import { applyAction, cardCount, createGame } from "./engine";
import { makeCtx } from "./testkit";
import type { BotDifficulty, GameState } from "./types";

/**
 * Whole-table simulation: four bots play complete rounds. This exercises the
 * engine and the bot strategy together and checks the invariants that make a
 * card game trustworthy: no card is ever created or lost, every round ends,
 * and every planned bot action is legal at the moment it is planned.
 */
function simulate(seed: number): { state: GameState; steps: number } {
  const ctx = makeCtx(seed);
  const { state: s0, hostId } = createGame(`SIM${seed}`, "Host", ctx);
  let state = structuredClone(s0);
  state.players[0].isBot = true; // the host plays as a bot too
  state = applyAction(state, { actionId: "start", playerId: hostId, action: { type: "start" } }, ctx).state;

  const jitter = (intent: string) => {
    let h = 2166136261;
    for (const ch of intent) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return (h % 1000) / 1000;
  };

  let steps = 0;
  let n = 0;
  while (state.phase !== "scoring" && steps < 600) {
    const plans = planBots(state, ctx.now, jitter);
    expect(plans.length, `bots must always have a move in phase ${state.phase}`).toBeGreaterThan(0);
    plans.sort((a, b) => a.delayMs - b.delayMs);
    const plan = plans[0];
    ctx.tick(plan.delayMs + 1);
    const r = applyAction(state, { actionId: `s${seed}-${++n}`, playerId: plan.playerId, action: plan.action }, ctx);
    state = r.state;
    steps++;
    // Conservation: 54 cards exist and every card is in exactly one place.
    const inHands = state.players.flatMap((p) => p.hand.filter((c): c is string => !!c));
    const drawn = state.turn?.drawnCardId ? [state.turn.drawnCardId] : [];
    const all = [...state.deck, ...state.discard, ...inHands, ...drawn];
    expect(all.length).toBe(54);
    expect(new Set(all).size).toBe(54);
    expect(Object.keys(state.cards).sort()).toEqual(all.slice().sort());
  }
  return { state, steps };
}

describe("bots", () => {
  it("four bots always finish a round with legal moves and conserved cards", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { state, steps } = simulate(seed);
      expect(state.phase, `seed ${seed} did not finish in ${steps} steps`).toBe("scoring");
      expect(state.results).toHaveLength(1);
      const r = state.results[0];
      expect(r.winnerIds.length).toBeGreaterThan(0);
      const min = Math.min(...r.scores.map((s) => s.score));
      for (const w of r.winnerIds) expect(r.scores.find((s) => s.playerId === w)!.score).toBe(min);
      for (const p of state.players) {
        expect(r.scores.find((s) => s.playerId === p.id)!.cards.length).toBe(cardCount(p));
      }
    }
  });

  it("bots only ever stick cards they have actually seen", () => {
    const ctx = makeCtx(7);
    const { state: s0, hostId } = createGame("K", "Host", ctx);
    let state = structuredClone(s0);
    state.players[0].isBot = true;
    state = applyAction(state, { actionId: "start", playerId: hostId, action: { type: "start" } }, ctx).state;
    ctx.tick(11_000);
    let n = 0;
    for (let i = 0; i < 300 && state.phase !== "scoring"; i++) {
      const plans = planBots(state, ctx.now, () => 0.5).sort((a, b) => a.delayMs - b.delayMs);
      const plan = plans[0];
      if (plan.action.type === "stick") {
        expect(state.botKnown[plan.playerId]).toContain(plan.action.cardId);
      }
      ctx.tick(plan.delayMs + 1);
      state = applyAction(state, { actionId: `k${++n}`, playerId: plan.playerId, action: plan.action }, ctx).state;
    }
  });
});

/**
 * Difficulty has to mean something, so it is measured rather than asserted:
 * whole tables are played out seat by seat and the results compared. The
 * simulation is deterministic — seeded deck, seeded jitter — so these numbers
 * are stable, and a change that makes a level play worse will fail here.
 */
function playOut(seed: number, levels: BotDifficulty[]): GameState | null {
  const ctx = makeCtx(seed);
  const { state: s0, hostId } = createGame(`D${seed}`, "Host", ctx);
  let state = structuredClone(s0);
  state.players[0].isBot = true;
  state = applyAction(state, { actionId: "start", playerId: hostId, action: { type: "start" } }, ctx).state;
  state.players.forEach((p, i) => { p.difficulty = levels[i]; });
  const jitter = (intent: string) => {
    let h = 2166136261 ^ seed;
    for (const ch of intent) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return (h % 1000) / 1000;
  };
  for (let n = 0; state.phase !== "scoring" && n < 900; n++) {
    const plans = planBots(state, ctx.now, jitter).sort((a, b) => a.delayMs - b.delayMs);
    if (!plans.length) return null;
    ctx.tick(plans[0].delayMs + 1);
    state = applyAction(state, { actionId: `d${seed}-${n}`, playerId: plans[0].playerId, action: plans[0].action }, ctx).state;
  }
  return state.phase === "scoring" ? state : null;
}

/** Plays both seatings of a two-level table, so seat order cannot flatter either. */
function headToHead(a: BotDifficulty, b: BotDifficulty, seeds = 40) {
  const tally = { [a]: { wins: 0, score: 0 }, [b]: { wins: 0, score: 0 } } as Record<string, { wins: number; score: number }>;
  let rounds = 0;
  for (const levels of [[a, b, a, b], [b, a, b, a]] as BotDifficulty[][]) {
    for (let seed = 1; seed <= seeds; seed++) {
      const state = playOut(seed, levels);
      if (!state) continue;
      rounds++;
      state.players.forEach((p, i) => {
        const level = levels[i];
        if (state.results[0].winnerIds.includes(p.id)) tally[level].wins++;
        tally[level].score += state.results[0].scores.find((s) => s.playerId === p.id)!.score;
      });
    }
  }
  return {
    rounds,
    wins: (l: BotDifficulty) => tally[l].wins,
    avg: (l: BotDifficulty) => tally[l].score / (rounds * 2),
  };
}

describe("difficulty", () => {
  it("hard beats medium over a run of tables, on wins and on score", () => {
    const r = headToHead("hard", "medium");
    expect(r.rounds).toBeGreaterThan(60);
    expect(r.wins("hard")).toBeGreaterThan(r.wins("medium"));
    expect(r.avg("hard")).toBeLessThan(r.avg("medium"));
  });

  it("easy is beaten by both, and finishes with a far worse hand", () => {
    const vsMedium = headToHead("medium", "easy");
    expect(vsMedium.wins("medium")).toBeGreaterThan(vsMedium.wins("easy") * 2);
    expect(vsMedium.avg("easy")).toBeGreaterThan(vsMedium.avg("medium") + 5);
    const vsHard = headToHead("hard", "easy");
    expect(vsHard.wins("hard")).toBeGreaterThan(vsHard.wins("easy") * 2);
    expect(vsHard.avg("easy")).toBeGreaterThan(vsHard.avg("hard") + 5);
  });

  it("every level plays only cards it has a right to know, and sticks fast in proportion to its level", () => {
    const ctx = makeCtx(9);
    const { state: s0, hostId } = createGame("L", "Host", ctx);
    let state = structuredClone(s0);
    state.players[0].isBot = true;
    state = applyAction(state, { actionId: "start", playerId: hostId, action: { type: "start" } }, ctx).state;
    const levels: BotDifficulty[] = ["easy", "medium", "hard", "medium"];
    state.players.forEach((p, i) => { p.difficulty = levels[i]; });
    ctx.tick(11_000);
    const seenStick: Record<string, number[]> = { easy: [], medium: [], hard: [] };
    for (let i = 0; i < 400 && state.phase !== "scoring"; i++) {
      const plans = planBots(state, ctx.now, () => 0.5).sort((a, b) => a.delayMs - b.delayMs);
      for (const plan of plans) {
        if (plan.action.type !== "stick") continue;
        const level = state.players.find((p) => p.id === plan.playerId)!.difficulty!;
        seenStick[level].push(plan.delayMs);
        // A guess is the one stick a bot may make on a card it has not seen,
        // and only an easy one ever guesses.
        if (level !== "easy") expect(state.botKnown[plan.playerId]).toContain(plan.action.cardId);
      }
      ctx.tick(plans[0].delayMs + 1);
      state = applyAction(state, { actionId: `l${i}`, playerId: plans[0].playerId, action: plans[0].action }, ctx).state;
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(seenStick.hard.length).toBeGreaterThan(0);
    expect(seenStick.medium.length).toBeGreaterThan(0);
    expect(mean(seenStick.hard)).toBeLessThan(mean(seenStick.medium));
  });
});
