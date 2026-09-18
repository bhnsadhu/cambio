# Cambio

The memory card game (also known as Cabo), playable in a browser with friends in real time. One five-letter join code, no accounts. Empty seats are filled by three house bots — **Cam**ryn, **Cam**ron and **Cam**i — who play from what they have actually seen.

**Live:** https://cambio-lime.vercel.app

## How it plays

- Four seats, always. 52 cards plus two jokers; four cards each, laid out 2×2 and face down for the whole round.
- A ten-second opening window reveals your bottom two cards, then everything is face down for everyone. The app never becomes a cheat sheet: the only time a value is ever drawn on screen is a timed reveal banner.
- On your turn, draw from the deck, then either **place** the card on the pile (firing its power) or **swap** it into your hand (which kills the power).
- Powers: 7/8 peek at one of yours · 9/10 peek at someone else's · J/Q blind swap · black K look at any two cards from two different players, then swap or not. Red kings have no power.
- **Sticking** is live for everyone except the player mid-turn: click any card you believe matches the top of the pile. Right, and it leaves the game (you hand the owner one of yours if it wasn't your own). Wrong, and you draw a penalty card. Sticks resolve independently in the order they arrive.
- Reaching zero cards triggers Cambio automatically; you can also call it at the start of your turn. Everyone else gets exactly one more turn.
- Scoring: number cards face value, J/Q 10, A 1, red K −1, black K and jokers 0. Lowest wins; ties stand. The winner leads the next round.

## Architecture

```
src/lib/game/      pure rules engine — no I/O, deterministic, fully unit-tested
  engine.ts        applyAction(state, envelope, ctx) → new state | GameError
  bots.ts          planBots(state) → the moves the house bots want, with human-like delays
  view.ts          redaction: secret state → public projection + per-player private view
src/lib/server/    persistence and orchestration (Next.js route handlers, Node runtime)
  store.ts         load → reduce → compare-and-swap commit, with retry on conflict
  runner.ts        bot runner: leased, spawned after every action via waitUntil
src/lib/client/    useGame hook: Supabase Realtime subscription, actions, watchdog
src/components/    the table UI
supabase/          schema and RPCs (see migration in the Supabase project)
```

**Server-authoritative, hidden information.** The full state — every card's identity — lives in one JSONB row and never leaves the server. Clients receive a *public projection* (slot ids, counts, the face-up top of the pile) and a *private view* (their drawn card and unexpired reveals). Stick targets reference stable card ids, so a card that moved is still the card you pointed at; ids are reissued on reshuffle so a card's face-up life on the pile cannot be tracked back into the deck.

**No dropped or duplicated actions.** Every action is a pure reduction over the current state, committed with a version check (`game_commit` in Postgres). If two sticks land within the same few milliseconds, one loses the race, is re-run against the winner's state, and the rules decide the outcome ("too late, that card is gone" costs no penalty). Every action carries a client id, so a retried request is a no-op.

**Realtime without polling on the hot path.** Each commit also writes a `game_views` row; Supabase Realtime streams it to every seat. Private data is fetched only when it can have changed (your own action's response, or a fresh deal).

**Bots without a game server.** After each human action the route handler schedules a bot runner with `waitUntil`. A 20-second database lease ensures one runner per game; the runner plans from fresh state each iteration, waits a natural delay, and re-checks the intent before committing. A client watchdog nudges the server if bots ever look stalled.

**Least-privilege database access.** The browser only holds the anon key and can read `game_views`. The server proves itself with a shared secret checked inside `SECURITY DEFINER` functions; nothing else can read `games`. (Supabase's linter flags those functions as anon-executable — that is the design: they are callable, but do nothing without the secret. `games` deliberately has RLS enabled with no policies.)

## Design

- **Type** is the system stack, the same one Apple and Notion ship: SF Pro on a Mac, Segoe on Windows. Sizes follow Apple's text styles (28, 22, 17, 15, 13, 11) with tracking that tightens above 20px.
- **Colour** is Notion's ink, `rgb(55 53 47)`, with its opacity ladder for secondary text (0.62), tertiary (0.42) and hairlines (0.09 and 0.16), on a warm ground. One accent, terracotta, appears only for Cambio and the winner.
- **Shadows** come from one light, above, at three depths: rest, card, lift, float. Corner radii scale with the tile so the proportions hold at every viewport.
- **Motion** is derived, not scripted. Every view change is diffed by card id and the cards that moved are flown from where they were to where they are, with the Web Animations API: deals stagger 60ms apart from the deck, draws land in the action bar, swaps cross, sticks arrive on the pile face up, handed cards travel between hands. Everything runs 280ms on an ease out curve. Reveals turn the tile on its axis and turn it back when the timer ends.
- **Copy** is short and declarative, with no exclamation marks and no dashes anywhere in the interface.
- **Onboarding** is a four step walkthrough on first visit, hints inside the first peek and the first power, and a How to play sheet that opens beside the table.

## Rules decisions worth knowing

- Cambio is called *instead of* drawing, at the start of your turn — the standard rule, which prevents "draw a great card, swap it in, then call".
- A wrong stick reveals nothing: the card stays where it is and the log does not name it.
- During your own power resolution (after your card is down) you may stick, like anyone else.
- If a card owed after a correct stick is still pending when the last turn ends, scoring waits for it.

## Running it

```
npm install
cp .env.example .env.local   # fill in the Supabase URL, anon key, and the server secret
npm run dev
npm test                      # vitest: engine, sticking, cambio, scoring, and 40 seeded bot-vs-bot rounds
```

The database schema is in the project's migration (`cambio_schema`): two tables, five RPCs, one Realtime publication. The server secret must match `private.server_config.server_secret`.
