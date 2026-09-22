import "server-only";
import { waitUntil } from "@vercel/functions";
import { createHash } from "node:crypto";
import { planBots, type BotPlan } from "@/lib/game/bots";
import { GameError } from "@/lib/game/engine";
import { rpc } from "./db";
import { newId } from "./ids";
import { loadById, runAction } from "./store";

/**
 * Drives the house bots for one game.
 *
 * There is no long-lived game server: every human action (and a client
 * watchdog "nudge") spawns a runner after the response is sent, using
 * `waitUntil`. A short database lease guarantees only one runner acts on a
 * game at a time; if a runner dies mid-thought the lease expires and the next
 * action or nudge simply starts another.
 *
 * Bots plan from the freshest state each iteration, wait a human-like delay,
 * then re-check that the same intent still makes sense before committing —
 * so a bot never "sticks" a card that a human already took.
 */

const LEASE_SECONDS = 20;
// A readable pace means a full round of bot turns takes real minutes, not
// seconds, to play out — these bound one continuous invocation generously
// enough to usually see a round through in one go. If a table still runs
// past them (a very long round, or nobody around to nudge it), the client
// watchdog's nudge simply starts another runner from the current state.
const MAX_ITERATIONS = 240;
const MAX_WALL_MS = 480_000;
/**
 * A floor between any two bot actions, whichever bot or intent they come
 * from. Each plan already waits its own human-like `delayMs` before it is
 * "ready" (see bots.ts), but two independently-timed decisions — say two
 * different bots each reacting to the same stick — can still come due within
 * the same breath of each other. This keeps the table from ever reading as
 * one action landing on the last one's heels.
 */
const MIN_ACTION_GAP_MS = 700;

export function spawnBots(gameId: string) {
  const p = runBots(gameId).catch((e) => console.error("[bots]", gameId, e));
  try {
    waitUntil(p);
  } catch {
    /* outside Vercel, the promise simply runs to completion in-process */
  }
}

export async function runBots(gameId: string): Promise<void> {
  const acquired = await rpc<boolean>("game_bot_lease", { p_id: gameId, p_seconds: LEASE_SECONDS });
  if (!acquired) return;
  const salt = newId();
  const jitter = (intent: string) => {
    const h = createHash("sha1").update(salt + intent).digest();
    return h.readUInt32BE(0) / 2 ** 32;
  };
  const waitedSince = new Map<string, number>();
  const started = Date.now();
  let lastActedAt = 0;

  try {
    for (let i = 0; i < MAX_ITERATIONS && Date.now() - started < MAX_WALL_MS; i++) {
      const row = await loadById(gameId);
      if (!row) return;
      const now = Date.now();
      const plans = planBots(row.state, now, jitter);
      if (plans.length === 0) return;

      // Fire anything whose delay has elapsed; otherwise wait for the earliest.
      let ready: BotPlan | null = null;
      let soonest = Infinity;
      for (const plan of plans) {
        const since = waitedSince.get(plan.intent) ?? (waitedSince.set(plan.intent, now), now);
        const readyAt = since + plan.delayMs;
        if (readyAt <= now && !ready) ready = plan;
        soonest = Math.min(soonest, readyAt);
      }
      for (const key of waitedSince.keys()) if (!plans.some((p) => p.intent === key)) waitedSince.delete(key);

      if (ready) {
        const gap = lastActedAt + MIN_ACTION_GAP_MS - now;
        if (gap > 0) await sleep(gap);
        try {
          await runAction(gameId, { actionId: `bot-${newId()}`, playerId: ready.playerId, action: ready.action });
        } catch (e) {
          if (!(e instanceof GameError)) throw e;
          // State moved under us (a human acted first). Re-plan on the next loop.
        }
        lastActedAt = Date.now();
        waitedSince.delete(ready.intent);
        continue;
      }
      await rpc("game_bot_lease", { p_id: gameId, p_seconds: LEASE_SECONDS, p_renew: true });
      await sleep(Math.min(Math.max(soonest - now, 30), 12_000));
    }
  } finally {
    await rpc("game_bot_release", { p_id: gameId }).catch(() => {});
    // Close the tiny window where a human acted while we were shutting down.
    const row = await loadById(gameId).catch(() => null);
    if (row && planBots(row.state, Date.now(), jitter).length > 0 && Date.now() - started < MAX_WALL_MS) {
      spawnBots(gameId);
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
