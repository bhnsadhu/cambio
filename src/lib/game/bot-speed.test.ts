import { describe, expect, it } from "vitest";
import { playRound, type SeatSpec } from "./bot-harness";
import { configStrategy } from "./bot-policies";
import type { BotObserver } from "./bots";
import { BOT_DIFFICULTIES } from "./types";

/** The bound pre-registered in H13: 99th percentile time per learned action decision. */
const BOUND_MS = 25;

describe("learned action speed", () => {
  it.each(BOT_DIFFICULTIES.map((level) => [level]))("%s decides with its action model in under 25 ms at the 99th percentile", (level) => {
    const times: number[] = [];
    const observer: BotObserver = { modelDecision: ({ ms }) => { times.push(ms); } };
    const seat = (): SeatSpec => ({ difficulty: level, strategy: configStrategy("A*", level, { easy: 1, medium: 1, hard: 1 }) });
    for (let seed = 7; seed < 13 && times.length <= 50; seed++) playRound(seed, [seat(), seat(), seat(), seat()], undefined, { observer });
    times.sort((a, b) => a - b);
    expect(times.length).toBeGreaterThan(50);
    expect(times[Math.ceil(0.99 * times.length) - 1]).toBeLessThan(BOUND_MS);
  }, 30_000);
});
