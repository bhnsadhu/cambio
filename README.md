# Cambio

A real time multiplayer web app for the card game Cambio, also known as Cabo. It seats four players, and three house bots fill any seat that is empty. Share a five letter code and play in the browser. No accounts, no installs.

**Play it live: [cambio.bhanusadhu.com](https://cambio.bhanusadhu.com)**

Open the link, create a table, and press **Start round**. Any seat still empty goes to Camryn, Camron or Cami.

---

## Highlights

| Feature | What it does |
| --- | --- |
| **Real time multiplayer** | Every move streams to all four seats over Supabase Realtime. Simultaneous moves are serialized, and the rules decide every late arrival. |
| **Complete game engine** | Turn logic, power cards, anytime sticking, and every way a round can end, in about 850 lines of pure TypeScript with no I/O. |
| **Bots that play from memory** | Three house bots fill empty seats and act only on information they have legitimately seen. |
| **Serverless architecture** | Runs on serverless functions and one Postgres database, with no dedicated game server. |
| **47 tests** | Includes 40 seeded bot versus bot rounds played to the score, checking that every move is legal and no card is created or lost. |

---

## Tech Stack

| Component | Technology |
| --- | --- |
| Framework | Next.js 16 with the App Router |
| UI | React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| Database | Supabase Postgres |
| Real time sync | Supabase Realtime |
| Database security | Row Level Security and `SECURITY DEFINER` RPCs |
| Hosting and compute | Vercel Functions, with `waitUntil` running bot turns after the response is sent |
| Animation | Web Animations API, with no animation library |
| Testing | Vitest |
| Typography | Plus Jakarta Sans |

---

## How It Works

### Real Time State Sync

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

### The Game Engine

`src/lib/game/engine.ts` is deterministic. Time, randomness and ID generation are injected, so every rule can be tested in isolation.

| System | Behavior |
| --- | --- |
| **Turns** | Draw, then place the card on the pile or swap it into any slot at the table. Each turn stage is enforced, and an out of turn move returns a typed error. |
| **Swap targets** | A swap is not confined to your own hand. Push the drawn card onto another player and they are left holding it, while the card it replaced goes face up on the pile. |
| **Power cards** | Four powers cover peeking at your cards, peeking at opponents' cards, blind swaps, and looking before an optional swap. A power with no legal target fizzles. |
| **Anytime sticking** | Any player who is not drawing or deciding on a card can attempt to stick a card matching the top of the pile. |
| **Stick resolution** | A correct stick removes the card. Sticking someone else's card means you owe them one of yours. A wrong stick draws a penalty and reveals nothing. |
| **Competing sticks** | If two players stick the same card, the first wins and the second gets “too late” with no penalty. Sticks follow card identity rather than slot position. |
| **Round endings** | Calling Cambio or reaching zero cards triggers exactly one more turn for everyone else, even if the trigger happens during another player's turn. |
| **Final scoring** | Players who reach zero during final turns leave the queue. Scoring waits for any card still owed after a stick. The lowest total wins, and ties stand. |
| **Idle players** | A human who sits on a turn for 30 seconds forfeits it and draws a penalty. An owed card that is never handed over is given at random. |
| **Unanimous pause** | Any seat can request a pause, every seat must agree, and one decline cancels it. On resume, every clock shifts forward by the time held. |
| **Between rounds** | Another round is the table's call, not the host's. Every seat asks for one and the last yes deals, with bots agreeing the moment the round is scored. |
| **Leaving** | Anyone who leaves instead sends the rest back to the lobby with the seats closed up, so they can invite someone or let a bot sit down. |
| **Narration** | Every rule that fires writes a structured event: the kind of move, who made it, whose cards it touched, and which cards to light up. Card IDs travel with it and ranks never do. |

### Power Cards

| Card | Power |
| --- | --- |
| 7 or 8 | Peek at one of your own cards |
| 9 or 10 | Peek at another player's card |
| J or Q | Swap any two cards belonging to two different players, without looking. You need not be one of them |
| Black king | Look at two cards from two different players, then decide whether to swap them |
| Red king | No power |

Powers activate when a drawn card is placed on the discard pile. Swapping a drawn card into a hand, your own or anyone else's, does not activate its power.

### Bot AI

The bots never read the full game state. Each bot keeps its own memory of card IDs it has legitimately seen: its opening peek, cards it drew, and anything it revealed with a peek or a king.

Tracking by ID means knowledge follows a card as it moves between hands. That knowledge is dropped when the card reaches the discard pile.

| Decision | Bot behavior |
| --- | --- |
| **Estimate its hand** | Count known values directly and unknown cards at the deck average of 5.5 |
| **Call Cambio** | Call when the estimated total is low enough, more readily later in the round |
| **Stick a card** | Stick only cards known to match the pile, preferring its own so it owes nothing |
| **Choose a peek** | Peek at the opponent closest to going out |
| **Choose a blind swap** | Trade its worst known card for a known lower card, or an unknown card belonging to the opponent closest to going out |
| **Keep a black king** | Keep its value of 0 instead of spending the power when it has a bad card to replace |

Each move waits a randomized, human paced delay. The intent is checked again before it commits, so a bot never sticks a card a human already took.

After every human action, the server starts a bot runner with `waitUntil`. A 20 second database lease keeps it to one runner per game. If a runner dies, the lease expires and the next action or a client nudge starts another.

### Hidden Information

The full state, including every card's identity, lives in one JSONB row and never leaves the server.

| Boundary | What it allows |
| --- | --- |
| Public projection | Slot IDs, card counts, and the face up top of the pile |
| Private player view | Only that player's drawn card and unexpired reveals |
| Browser access | Holds only the anon key and can read only `game_views` |
| Full game state | Stored in `games`, with Row Level Security enabled and no policies |
| Server access | Uses `SECURITY DEFINER` functions that require a shared secret |
| Reshuffled cards | Receive new IDs so previously discarded cards cannot be traced into the deck |

### Front End

Motion is derived from state. Each new view is diffed by card ID, and cards animate from their previous positions to their new ones.

| Event | Animation |
| --- | --- |
| Deal | Cards stagger from the deck, and nothing is revealed until the last one is down |
| Draw | The drawn card lands in the action bar |
| Swap | Cards cross between positions |
| Stick | The matching card arrives on the pile face up |

Every move is also announced on screen and lit in the hands it touched, so a player who is not acting can still follow every card.

| Moment | Notification |
| --- | --- |
| A draw, a plain placement | The table log only |
| A look, a swap, a stick, a card owed | A line in the middle of the table, naming the move, who made it, and whose card it happened to |
| Cambio, a swap during the final turns, a player out of cards, the table going dark | The same space at four times the size |

A burst of moves shortens each hold rather than dropping any of them, and hovering a line in the log finds its cards on the table.

The look is deliberately spare: a black background, white cards, one mint accent for the numbers that matter, and Plus Jakarta Sans for headlines.

First time players get a short walkthrough and a **How to play** sheet that opens beside the table.

---

## How to Play

1. **Create a table and share the code.** Four seats are available, and bots fill any empty seats when the round starts.
2. **Remember your opening cards.** Everyone gets four face down cards in a 2 by 2 grid. The deck is shuffled and dealt, and only then does a five second window show you your bottom two.
3. **Draw on your turn.** Place the drawn card on the pile to activate its power, or swap it into any hand at the table, your own or someone else's.
4. **Watch for sticks.** If you believe a card matches the top of the pile, stick it. Sticking is open to everyone except the player currently drawing or deciding.
5. **Call Cambio.** Call at the start of your turn instead of drawing. Everyone else gets one more turn before scoring.
6. **Finish with the lowest total.** Hands are revealed and scored. The lowest total wins, and the winner leads the next round.
7. **Play on, or leave.** Every seat chooses. Another round starts once everyone is in; if anyone leaves, the rest go back to the lobby with a seat open.

### Scoring

The deck contains 52 cards plus two jokers.

| Card | Points |
| --- | --- |
| Ace | 1 |
| 2 through 10 | Face value |
| Jack or queen | 10 |
| Red king | -1 |
| Black king | 0 |
| Joker | 0 |

<details>
<summary><strong>Additional rulings</strong></summary>

- Cards stay face down after the opening peek. A value only appears during a timed reveal.
- Calling Cambio replaces drawing. You cannot draw, swap in a good card, and then call.
- Reaching zero cards also triggers the final turns.
- A correct stick of another player's card means you owe them one of yours.
- A wrong stick draws a penalty and reveals nothing.
- If another player sticks the same card first, your attempt receives “too late” with no penalty.
- You may stick during your own power resolution once your drawn card is down.
- Scoring waits until any card owed after a stick has been handed over.
- Ties stand.
- Pausing and resuming require agreement from every seat.

</details>

---

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
| `src/lib/client/` | `useGame` hook, Realtime subscription, actions, watchdog, and card flights |
| `src/components/` | Table UI |
| `supabase/` | Database schema and RPCs |

---

## Run It Locally

You need a Supabase project.

### 1. Set up the database

Apply the migration:

```text
supabase/migrations/0001_cambio_schema.sql
```

Then store a server secret:

```sql
insert into private.server_config(key, value)
values ('server_secret', '<hex>');
```

Replace `<hex>` with your server secret.

### 2. Install dependencies and configure the environment

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` with your Supabase URL, anon key, and server secret.

| Setting | Purpose |
| --- | --- |
| Supabase URL | Connects the app to your Supabase project |
| Supabase anon key | Allows browser access to permitted game views |
| `CAMBIO_SERVER_SECRET` | Must match the `server_secret` value stored in `private.server_config` |

### 3. Start the app

```bash
npm run dev
```

### 4. Run the tests

```bash
npm test
```
