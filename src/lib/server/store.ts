import "server-only";
import { applyAction, createGame as engineCreate, GameError, joinGame as engineJoin, type ApplyResult } from "@/lib/game/engine";
import type { ActionEnvelope, IdentityEnvelope, GameState, PlayerView } from "@/lib/game/types";
import { projectFor, projectPublic } from "@/lib/game/view";
import { rpc } from "./db";
import { engineCtx, newCode } from "./ids";
import { recordRound } from "./social";

/**
 * Persistence with optimistic concurrency.
 *
 * Every mutation is: load the row (state + version) → run the pure reducer →
 * commit with `game_commit`, which only succeeds if the version is unchanged.
 * If two players act within the same few milliseconds (two sticks, say), one
 * commit loses the race, and we simply reload and re-run the reducer against
 * the winner's state. The reducer then decides whether the late action is
 * still legal ("too late, that card is gone") — so nothing is dropped or
 * applied twice, and the outcome is exactly what the rules say.
 */

export interface GameRow {
  id: string;
  code: string;
  version: number;
  state: GameState;
  botLockUntil: string | null;
}

interface RawRow { id: string; code: string; version: number; state: GameState; bot_lock_until: string | null }

const MAX_ATTEMPTS = 8;

function toRow(r: RawRow): GameRow {
  return { id: r.id, code: r.code, version: r.version, state: r.state, botLockUntil: r.bot_lock_until };
}

export async function loadByCode(code: string): Promise<GameRow | null> {
  const rows = await rpc<RawRow[]>("game_load", { p_code: code });
  return rows?.[0] ? toRow(rows[0]) : null;
}

export async function loadById(id: string): Promise<GameRow | null> {
  const rows = await rpc<RawRow[]>("game_load", { p_id: id });
  return rows?.[0] ? toRow(rows[0]) : null;
}

export async function commit(row: GameRow, state: GameState): Promise<number | null> {
  const nextVersion = row.version + 1;
  const view = projectPublic(state, nextVersion, Date.now());
  const v = await rpc<number | null>("game_commit", {
    p_id: row.id,
    p_expected_version: row.version,
    p_state: state,
    p_view: view,
  });
  return v;
}

export async function createGame(hostName: string, profileId?: string | null, avatarId?: number | null): Promise<{ row: GameRow; playerId: string; token: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const { state, hostId, token } = engineCreate(code, hostName, engineCtx(), profileId, avatarId);
    try {
      const rows = await rpc<{ id: string; version: number }[]>("game_create", {
        p_code: code,
        p_state: state,
        p_view: projectPublic(state, 1, Date.now()),
      });
      const { id, version } = rows[0];
      return { row: { id, code, version, state, botLockUntil: null }, playerId: hostId, token };
    } catch (e) {
      if (e instanceof Error && /duplicate key|unique/i.test(e.message)) continue;
      throw e;
    }
  }
  throw new Error("Could not allocate a join code.");
}

export async function joinGame(code: string, name: string, profileId?: string | null, avatarId?: number | null, seatToken?: string | null): Promise<{ row: GameRow; playerId: string; token: string }> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = await loadByCode(code);
    if (!row) throw new GameError("NOT_FOUND", "No table with that code.");
    const existing = (profileId ? row.state.players.find((p) => p.profileId === profileId && !p.isBot) : null)
      ?? (seatToken ? row.state.players.find((p) => !p.isBot && !p.profileId && p.token === seatToken) : null);
    if (existing?.token) {
      if (!profileId) return { row, playerId: existing.id, token: existing.token };
      const result = applyAction(row.state, {
        actionId: crypto.randomUUID(), playerId: null,
        action: existing.profileId
          ? { type: "syncIdentity", profileId, displayName: name, avatarId }
          : { type: "claimIdentity", token: existing.token, profileId, displayName: name, avatarId },
      }, engineCtx());
      if (!result.changed) return { row, playerId: existing.id, token: existing.token };
      const version = await commit(row, result.state);
      if (version !== null) return { row: { ...row, version, state: result.state }, playerId: existing.id, token: existing.token };
      continue;
    }
    const { state, playerId, token } = engineJoin(row.state, name, engineCtx(), profileId, avatarId);
    const v = await commit(row, state);
    if (v !== null) return { row: { ...row, version: v, state }, playerId, token };
  }
  throw new Error("The table is busy; try again.");
}

export interface ActionOutcome {
  row: GameRow;
  result: ApplyResult;
}

/** Apply one action with compare-and-swap retries. Throws GameError for illegal moves. */
export async function runAction(gameId: string, env: ActionEnvelope | IdentityEnvelope): Promise<ActionOutcome> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = await loadById(gameId);
    if (!row) throw new GameError("NOT_FOUND", "This table no longer exists.");
    const result = applyAction(row.state, env, engineCtx());
    if (!result.changed) return { row, result };
    const v = await commit(row, result.state);
    if (v !== null) {
      // The commit that scored a round is the one that writes it into the
      // record books: exactly one attempt can win that race, so nothing is
      // counted twice. A failure here never costs anyone their move.
      if (result.state.results.length > row.state.results.length) {
        const scored = result.state.results[result.state.results.length - 1];
        await recordRound(result.state, scored).catch((e) => console.error("[stats]", gameId, e));
      }
      return { row: { ...row, version: v, state: result.state }, result };
    }
    await new Promise((r) => setTimeout(r, 15 + attempt * 20));
  }
  throw new Error("The table is busy; try again.");
}

export function viewFor(row: GameRow, playerId: string | null): PlayerView {
  return projectFor(row.state, row.version, playerId, Date.now());
}

export function playerForToken(state: GameState, token: string | null): string | null {
  if (!token) return null;
  const p = state.players.find((x) => !x.isBot && x.token === token);
  return p ? p.id : null;
}

/** Keep names, avatars, and deleted identities in game projections consistent via CAS. */
export async function syncProfileGames(profileId: string, displayName: string | null, avatarId?: number | null) {
  const games = await rpc<{ id: string }[]>("profile_games", { p_id: profileId });
  for (const game of games) {
    await runAction(game.id, {
      actionId: crypto.randomUUID(), playerId: null,
      action: { type: "syncIdentity", profileId, displayName, avatarId },
    });
  }
}

/** Signup upgrades only guest seats proved by their existing secret tokens. */
export async function claimGuestSeats(guestSeats: unknown, profileId: string, displayName: string, avatarId?: number | null) {
  if (!Array.isArray(guestSeats)) return;
  for (const seat of guestSeats.slice(0, 20)) {
    if (!seat || typeof seat.code !== "string" || !/^[A-Z0-9]{5}$/.test(seat.code)
      || typeof seat.token !== "string" || !seat.token || seat.token.length > 200) continue;
    const row = await loadByCode(seat.code);
    if (!row || !row.state.players.some((p) => !p.isBot && !p.profileId && p.token === seat.token)) continue;
    await runAction(row.id, {
      actionId: crypto.randomUUID(), playerId: null,
      action: { type: "claimIdentity", token: seat.token, profileId, displayName, avatarId },
    });
  }
}
