@AGENTS.md

# Cambio — working notes

- Rules live only in `src/lib/game/engine.ts`; the UI and server never reimplement them. Change a rule there, cover it in `engine.test.ts`, run `npm test`.
- `GameState` is secret. Anything sent to a browser must go through `view.ts`. Never add card ranks to the public view or to log text for cards still in a hand.
- Every mutation goes through `runAction` in `src/lib/server/store.ts` (load → reduce → `game_commit` CAS). Do not write to `games` any other way.
- Bots: strategy in `bots.ts` (pure, testable); scheduling in `server/runner.ts` (leased, spawned by `waitUntil`).
- Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CAMBIO_SERVER_SECRET` (must equal `private.server_config.server_secret` in Supabase).
- Workflow: one surgical change per commit, push, confirm the Vercel deployment is READY before the next.
