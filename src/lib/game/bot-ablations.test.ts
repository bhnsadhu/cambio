import { describe, expect, it } from "vitest";
import { assessCambio } from "./bots";
import { expectedCard, unseenValues } from "./bot-beliefs";
import { playRound, type SeatSpec } from "./bot-harness";
import { observeBot } from "./bot-observation";
import type { BotDifficulty, BotStrategy, GameState } from "./types";

const LEVELS: BotDifficulty[] = ["hard", "medium", "hard", "easy"];
const EXPLICIT_DEFAULTS: BotStrategy = { counting: true, inference: true, callGate: true };

function withStrategy(seat: number, strategy: BotStrategy): SeatSpec[] {
  return LEVELS.map((difficulty, index) => index === seat ? { difficulty, strategy } : { difficulty });
}

/** The first mid round state, over a few seeds, that a test fixture needs. */
function findState(match: (state: GameState) => boolean): GameState {
  for (let seed = 1; seed <= 40; seed++) {
    let found: GameState | null = null;
    playRound(seed, LEVELS, (state) => { if (!found && match(state)) found = structuredClone(state); });
    if (found) return found;
  }
  throw new Error("No seed produced the fixture");
}

describe("bot strategy options default to the shipped bots", () => {
  it("plays identical rounds with no options and with every option set to its default", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const plain = playRound(seed, LEVELS);
      const explicit = playRound(seed, LEVELS.map((difficulty) => ({ difficulty, strategy: EXPLICIT_DEFAULTS })));
      expect(explicit.steps, `seed ${seed}`).toBe(plain.steps);
      expect(explicit.calls, `seed ${seed}`).toEqual(plain.calls);
      expect(explicit.state.results, `seed ${seed}`).toEqual(plain.state.results);
      expect(explicit.state.log, `seed ${seed}`).toEqual(plain.state.log);
    }
  }, 30_000);
});

describe("each option removes exactly one ability", () => {
  it("memory caps how many observed faces a bot keeps", () => {
    for (let seed = 1; seed <= 4; seed++) {
      let longest = 0;
      playRound(seed, withStrategy(0, { memory: 2 }), (state) => {
        longest = Math.max(longest, (state.botKnown[state.players[0].id] ?? []).length);
      });
      expect(longest, `seed ${seed}`).toBeLessThanOrEqual(2);
      expect(longest, `seed ${seed}`).toBeGreaterThan(0);
    }
  }, 30_000);

  it("without counting, unseen cards come from a full deck", () => {
    const state = findState((s) => s.phase === "playing" && s.discard.length >= 4);
    const bot = state.players[0];
    const observed = observeBot(state, bot.id);
    expect(unseenValues(observed, bot).length).toBeLessThan(54);
    expect(unseenValues(observed, { ...bot, strategy: { counting: false } })).toHaveLength(54);
  });

  it("without inference, a public keep or push carries no weight", () => {
    const state = findState((s) => s.phase === "playing" &&
      Object.keys(s.botHints ?? {}).some((id) => !(s.botKnown[s.players[0].id] ?? []).includes(id) && s.players.some((p) => p.hand.includes(id))));
    const bot = state.players[0];
    const hinted = Object.keys(state.botHints ?? {}).find((id) => !(state.botKnown[bot.id] ?? []).includes(id) && state.players.some((p) => p.hand.includes(id)))!;
    const observed = observeBot(state, bot.id);
    const pool = unseenValues(observed, bot);
    const plainMean = pool.reduce((sum, value) => sum + value, 0) / pool.length;
    expect(expectedCard(observed, bot, hinted, pool)).not.toBeCloseTo(plainMean, 6);
    expect(expectedCard(observed, { ...bot, strategy: { inference: false } }, hinted, pool)).toBeCloseTo(plainMean, 10);
  });

  it("without the gate, an estimated lead alone is enough to call", () => {
    const state = findState((s) => {
      if (s.phase !== "playing" || s.turn?.stage !== "draw" || s.turn.playerId !== s.players[0].id) return false;
      const belief = assessCambio(s, s.players[0].id);
      return !belief.call && s.turnsTaken >= s.players.length && belief.ownEstimate <= belief.strongestOpponent;
    });
    const bot = state.players[0];
    const gated = assessCambio(state, bot.id);
    expect(gated.winChance < 0.64 || gated.nearWinChance < 0.8).toBe(true);
    bot.strategy = { callGate: false };
    const open = assessCambio(state, bot.id);
    expect(open.call).toBe(true);
    expect({ ...open, call: gated.call }).toEqual(gated);
  });
});
