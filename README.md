# Cambio

A real time multiplayer web app for the card game Cambio, also known as Cabo. It seats four players, and three house bots fill any seat that is empty. Share a five letter code and play in the browser. No accounts, no installs.

### Play it live: https://cambio.bhanusadhu.com/

Open the link, create a table, and press Start round. Any seat still empty goes to Camryn, Camron or Cami.

## Highlights

* **Real time for all four seats.** Every move streams to every player over Supabase Realtime. Simultaneous moves are serialized safely: none is dropped, none is applied twice, and the rules decide every late arrival.
* **A complete game engine.** Turn logic, the power cards, anytime sticking, and every way a round can end, in about 850 lines of pure TypeScript with no I/O.
* **Bots that play from memory.** They only know what they have legitimately seen, the same way a person at the table would.
* **No game server.** The whole thing runs on serverless functions and one Postgres database.
* **47 tests**, including 40 seeded bot versus bot rounds played to the score, checking every move is legal and no card is created or lost.

## Stack

* **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
* **Database and realtime:** Supabase Postgres, Supabase Realtime, Row Level Security, `SECURITY DEFINER` RPCs
* **Hosting and compute:** Vercel Functions, with `waitUntil` running bot turns after the response is sent
* **Animation:** Web Animations API, no animation library
* **Testing:** Vitest

## How it works

### Real time state sync across simultaneous actions

Every action is a pure function over the current game state. The server loads the state and its version, runs the action through the engine, and commits with a version check inside Postgres (`game_commit`). If two players act in the same few milliseconds, one commit loses the race, reloads, and runs again against the winner's state. The rules then decide the outcome of the late action, so nothing is dropped and nothing is applied twice.

Every action also carries a client generated id that the engine remembers, so a request retried after a network hiccup does nothing the second time.

Each commit writes a redacted copy of the game to a `game_views` row. Supabase Realtime streams that row to every seat, and clients discard any view older than the one they hold. A slow poll and a refresh on tab focus cover dropped sockets.

### The game engine

`src/lib/game/engine.ts` is deterministic. Time, randomness and id generation are injected, so every rule can be tested in isolation.

* **Turns.** Draw, then place the card on the pile or swap it into your hand. Each turn stage is enforced, and an out of turn move gets a typed error instead of corrupting state.
* **Power cards.** Four powers spread over 7, 8, 9, 10, J, Q and the black kings. 7 and 8 peek at one of your own cards, 9 and 10 peek at someone else's, J and Q swap two cards blind, and a black king lets you look at two cards from two different players and then decide whether to swap them. Red kings have no power. A power with no legal target fizzles.
* **Sticking, at any time.** Any player who is not drawing or deciding on a card can slam a card they believe matches the top of the pile. A correct stick removes the card, and sticking someone else's card means you owe them one of yours. A wrong stick draws a penalty and reveals nothing. If two players stick the same card, the first wins and the second gets "too late" with no penalty. Sticks target card identity rather than a slot position, so a card that moved is still the card you pointed at.
* **Round endings.** A round enters its final turns two ways. A player calls Cambio at the start of their turn, or a player runs out of cards, whether by sticking their own, having their last card stuck by someone else, or giving one away. Either way everyone else gets exactly one more turn, even if the trigger lands in the middle of someone's turn. A player who reaches zero during the final turns drops out of the queue. Scoring waits for any card still owed after a stick, and the lowest total wins. Ties stand.
* **Idle players.** A human who sits on a turn for 30 seconds forfeits it and draws a penalty. An owed card that is never handed over is given at random.
* **Unanimous pause.** Any seat can ask, every seat has to agree, and one decline cancels the request. On resume every clock shifts forward by the time held, so nobody loses a turn for being away.

### Bot AI that tracks revealed information

The bots never read the full game state. Each bot keeps its own memory of card ids it has legitimately seen: its opening peek, cards it drew, and anything it revealed with a peek or a king. Tracking by id means knowledge follows a card as it moves between hands, and it is dropped when the card reaches the discard pile.

From that memory a bot:

* estimates its hand total, counting each unknown card at the deck average of 5.5, and calls Cambio only when the estimate is low enough, more readily later in the round
* sticks only cards it knows match the top of the pile, and prefers its own so it owes nothing
* peeks at the opponent closest to going out, and blind swaps its worst known card for one it knows is lower, or failing that for one of that opponent's unknowns
* keeps a black king, worth 0, instead of spending its power when it has a bad card to replace

Each move waits a randomized, human paced delay, and the intent is checked again before it commits, so a bot never sticks a card a human already took.

There is no long lived game process behind this. After every human action the server starts a bot runner with `waitUntil`. A 20 second database lease keeps it to one runner per game, and if a runner dies the lease expires and the next action or a client nudge starts another.

### Hidden information

The full state, every card's identity included, lives in one JSONB row and never leaves the server. Browsers receive a public projection (slot ids, card counts, the face up top of the pile) and a private view containing only their own drawn card and unexpired reveals. The browser holds only the anon key and can read only `game_views`. The `games` table has Row Level Security on with no policies, and the server reaches it through `SECURITY DEFINER` functions that do nothing without a shared secret. Card ids are reissued whenever the discard pile is reshuffled, so a card's time face up on the pile cannot be traced into the deck.

### Front end

Motion is derived from state, not scripted. Each new view is diffed by card id, and the cards that moved fly from where they were to where they are: deals stagger from the deck, draws land in the action bar, swaps cross, sticks arrive on the pile face up. The look is deliberately spare, with a black ground, white cards, one mint accent for the numbers that matter, and Plus Jakarta Sans for headlines. First time players get a short walkthrough and a How to play sheet that opens beside the table.

## How the game is played

<details>
<summary>The rules, in short</summary>

* Four seats, 52 cards plus two jokers. Everyone gets four cards in a 2 by 2 grid, face down for the whole round.
* A five second opening window shows you your bottom two cards. After that your cards stay face down, and a value only shows in a timed reveal.
* On your turn, draw, then either **place** the card on the pile (which fires its power) or **swap** it into your hand (which does not).
* **Sticking** is open to everyone except the player drawing or deciding. Slam any card you believe matches the top of the pile.
* Instead of drawing, you may call **Cambio**. Everyone else gets one more turn, then hands are revealed and scored.
* Scoring: number cards at face value, J and Q are 10, ace is 1, red kings are negative 1, black kings and jokers are 0. Lowest total wins, and the winner leads the next round.

Rulings worth knowing: Cambio is called instead of drawing, which prevents drawing a great card, swapping it in and then calling. A wrong stick reveals nothing. You may stick during your own power resolution once your card is down. A pause needs every seat in both directions.

</details>

## Project layout

```
src/lib/game/      pure rules engine, no I/O, deterministic, unit tested
  engine.ts        applyAction(state, envelope, ctx) returns a new state or a GameError
  bots.ts          planBots(state) returns the moves the bots want, with paced delays
  view.ts          redaction: secret state to public projection and private view
src/lib/server/    persistence and orchestration (Next.js route handlers)
  store.ts         load, reduce, compare and swap commit, retry on conflict
  runner.ts        bot runner: leased, started after every action with waitUntil
src/lib/client/    useGame hook: Realtime subscription, actions, watchdog, flights
src/components/    the table UI
supabase/          database schema and RPCs
```

## Run it locally

You need a Supabase project. Apply `supabase/migrations/0001_cambio_schema.sql`, then store a server secret:

```
insert into private.server_config(key, value) values ('server_secret', '<hex>');
```

Then:

```
npm install
cp .env.example .env.local   # Supabase URL, anon key, and the same server secret
npm run dev
npm test
```

`CAMBIO_SERVER_SECRET` must equal the value stored in `private.server_config`.
