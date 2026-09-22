import "server-only";
import type { GameState, Player } from "@/lib/game/types";
import { profileByToken } from "./social";
import { profileTokenFrom, tokenFrom } from "./http";

/** A seat token is sufficient only for guests. Account seats always require
 * the matching live account session, including after signing out or deletion.
 * A fresh browser can recover its seat by logging into that same account.
 */
export async function playerForRequest(state: GameState, req: Request): Promise<Player | null> {
  const token = tokenFrom(req);
  const seat = token ? state.players.find((p) => !p.isBot && p.token === token) : null;
  const profile = await profileByToken(profileTokenFrom(req));
  if (profile) return state.players.find((p) => !p.isBot && p.profileId === profile.id) ?? (seat?.profileId ? null : seat ?? null);
  return seat && !seat.profileId ? seat : null;
}
