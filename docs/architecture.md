# Architecture

How Cambio keeps four browsers in sync without a dedicated game server, and how it keeps every hidden card hidden. Back to the [README](../README.md).

## Real Time State Sync

Every action is a pure function over the current game state. The server loads the state and its version, runs the action through the engine, and commits with a version check inside Postgres (`game_commit`).

If two players act in the same few milliseconds, one commit loses the race, reloads, and runs again against the winner's state. The rules then decide the outcome of the late action, so nothing is dropped and nothing is applied twice.

| Mechanism | Purpose |
| --- | --- |
| Version checked commits | Prevent simultaneous actions from overwriting each other |
| Retry on conflict | Run a competing action again against the latest committed state |
| Client generated action IDs | Prevent a request retried after a network hiccup from being applied twice |
| Redacted `game_views` | Publish the information each player is allowed to receive |
| Supabase Realtime | Stream committed views to connected players |
| Client version checks | Discard any view older than the one already held |
| Slow polling and tab focus refresh | Recover from dropped sockets |

Bot turns run on the same path; see [Bot AI](bots.md) for the runner and its lease.

## Hidden Information

The full state, including every card's identity, lives in one JSONB row and never leaves the server.

| Boundary | What it allows |
| --- | --- |
| Public projection | Slot IDs, card counts, and the face up top of the pile |
| Private player view | Only that player's drawn card and unexpired reveals |
| Browser access | Holds only the anon key and can read only `game_views` |
| Full game state | Stored in `games`, with Row Level Security enabled and no policies |
| Server access | Uses `SECURITY DEFINER` functions that require a shared secret |
| Reshuffled cards | Receive new IDs so previously discarded cards cannot be traced into the deck |

## Project Layout

| Path | Responsibility |
| --- | --- |
| `src/lib/game/` | Pure, deterministic rules engine with no I/O |
| `src/lib/game/engine.ts` | `applyAction(state, envelope, ctx)` returns a new state or a `GameError` |
| `src/lib/game/bots.ts` | `planBots(state)` returns intended bot moves with paced delays |
| `src/lib/game/view.ts` | Redacts secret state into public projections and private views |
| `src/lib/server/` | Persistence and orchestration for Next.js route handlers |
| `src/lib/server/store.ts` | Loads state, applies actions, commits with a version check, and retries conflicts |
| `src/lib/server/runner.ts` | Runs bots under a database lease, started after actions with `waitUntil` |
| `src/lib/server/social.ts` | Profiles, friends, invites, presence, and writing a scored round into the record books |
| `src/lib/social/` | Profile and friend types, and the rank ladder based on points |
| `src/lib/client/` | `useGame` hook, Realtime subscription, actions, watchdog, card flights, profile and friends |
| `src/components/` | Table UI, profile cards and the friends panel |
| `supabase/` | Database schema and RPCs |
