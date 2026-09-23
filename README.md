# Cambio

A real time multiplayer web app for the card game Cambio, also known as Cabo. It seats four players, and three house bots fill any seat that is empty. Share a five character code and play in the browser. Play as a guest, or create an account to keep your record. No installs.

**Play it live: [cambio.bhanusadhu.com](https://cambio.bhanusadhu.com)**

Open the link, enter a display name, and press **Open a table**, then **Start round**. Any seat still empty goes to Cameron, Camila or Cami, at easy, medium or hard. Cards are dealt face down, and the opening peek waits until everyone is ready.

---

## Highlights

| Feature | What it does |
| --- | --- |
| **Real time multiplayer** | Every move streams to all four seats over Supabase Realtime. Simultaneous moves are serialized, and the rules decide every late arrival. |
| **Complete game engine** | Turn logic, power cards, anytime sticking, and every way a round can end, in about 850 lines of pure TypeScript with no I/O. |
| **Bots that play from memory** | Three house bots fill empty seats and act only on information they have legitimately seen, at three difficulties. |
| **Persistent accounts** | Wins, rank and streak across every table, with friends, invites and a light for whoever is playing right now. |
| **Friends and global leaderboards** | Compare lifetime points with accepted friends or all players. Equal points share a rank, and your position stays visible even outside the current page. Guests can browse the global leaderboard. |
| **Serverless architecture** | Runs on serverless functions and one Postgres database, with no dedicated game server. |
| **Engine and browser regression suites** | Seeded bot versus bot tables played to the score, checking that every move is legal, no card is created or lost, and each difficulty beats the one below it. A Playwright suite covers the whole account lifecycle against an isolated database. |

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
| Testing | Vitest, Playwright, and isolated Postgres lifecycle checks |
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
| **Anytime sticking** | Any player may stick a card matching the top of the pile at any moment, including on their own turn, while holding a drawn card or resolving a power. |
| **Stick resolution** | A correct stick removes the card. Sticking someone else's card means you owe them one of yours. A wrong stick draws a penalty and reveals nothing. |
| **Competing sticks** | If two players stick the same card, the first wins and the second gets “too late” with no penalty. Sticks follow card identity rather than slot position. |
| **Round endings** | Calling Cambio or reaching zero cards triggers exactly one more turn for everyone else, even if the trigger happens during another player's turn. |
| **Final scoring** | Players who reach zero during final turns leave the queue. Scoring waits for any card still owed after a stick. The lowest total wins, and ties stand. |
| **Idle players** | A human who sits on a turn for 30 seconds forfeits it and draws a penalty. An owed card that is never handed over is given at random. |
| **Unanimous pause** | Any seat can request a pause, every seat must agree, and one decline cancels it. On resume, every clock shifts forward by the time held. |
| **Ready checks** | Every round deals first and asks after: four cards land face down in front of each seat, and the peek only opens once every seat has said it is ready. Bots answer at once, and a seat that never answers is carried after 45 seconds. |
| **Between rounds** | Another round is the table's call, not the host's. Every seat asks for one and the last yes deals, with bots agreeing the moment the round is scored. Any player can instead choose Back to table to bring everyone to the same lobby, keeping human seats, the host, settings, and results. Bot seats reopen for friends or the next deal. |
| **Leaving** | During a round, a medium bot takes over the exact seat, card positions, and pending move. Play continues, and a departing host passes hosting to the earliest-joined human still at the table, regardless of seat position. Leaving the lobby or results opens the seat and returns the remaining humans to the lobby. |
| **Removing players** | The host can use Players to remove another human, including while paused. A medium bot takes over during a round; between rounds the seat opens. The removed player's access to the seat is revoked. This is not a permanent ban from joining by code. |
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

The bots choose from information they could legitimately observe: opening peeks, their own draws, private power reveals, face-up discards, and public card movements. Unknown faces and the future deck order never enter a decision. Hidden-card permutation tests check that contract.

| Level | How it plays |
| --- | --- |
| **Easy** | Remembers only its two most recently seen cards, makes myopic replacements, often skips useful powers, misses obvious sticks, and occasionally guesses incorrectly. It does not repeat a failed guess against the same discard. |
| **Medium** | Tracks its own revealed cards plus two opponent cards, makes basic value-improving replacements and known-card swaps, and sticks remembered matches accurately. |
| **Hard** | Retains all legitimate memory, counts seen cards, infers likely quality from public keeps and pushes, compares moves against every opponent, sets up matching sticks, and weighs a power against keeping or attacking with its drawn card. It can trade between opponents to weaken the leader. |

All three levels use the same cautious Cambio rule. A deterministic belief rollout compares the bot's estimated hand against every opponent, including their best improving replacement on one final draw. Calling requires an estimated lead, at least 64% winning belief and 80% belief of winning or finishing within one point. There is no random call, absolute score cutoff, or late-round fallback. Hard's information is better; its permission to call recklessly is not greater. The reducer checks the assessment again on every commit attempt, so a human stick or concurrent update can cancel an obsolete call.

These probabilities are decision estimates, not calibrated promises: unseen cards and opponents' final-turn powers can still overturn a lead. In 192 complete rounds with equal reaction speeds and reversed seatings (seeds 1–24 and an independent 101–124 set), hard earned 69.5 winning shares against medium's 26.5, with mean scores 4.52 versus 7.39. Medium earned 92 shares against easy's 4, with mean scores 5.88 versus 17.86. Tied wins divide the share. Every actual Cambio call passed the belief gate; 92% of hard and medium calls were already winning or within two points of the actual leader when made. Tests fail on an unfinished round, illegal move, lost/duplicated card, or reversed difficulty ordering.

Cameron consistently uses the Quiff avatar; Camila uses Curls; Cami uses Ponytail. Camille fills the fourth bot seat if every human leaves during a round. Existing saved bot seats receive the same mapping when projected, and human avatar choices remain independent.

Each move waits a randomized, human paced delay. The intent is checked again before it commits, so a bot never sticks a card a human already took.

After every human action, the server starts a bot runner with `waitUntil`. A 20 second database lease keeps it to one runner per game. If a runner dies, the lease expires and the next action or a client nudge starts another.

### Profiles and Friends

Accounts use a unique username and password, separate from the display name shown to other players. The same username is used for login, friend lookup, and public profile links. Changing it updates all three together and preserves existing friends and stats. Guests can still play without creating an account.

Passwords use salted scrypt hashes. Random session tokens live in HttpOnly cookies with SameSite protection and a 30 day lifetime; only their hashes are stored in the database. Login and sensitive changes have persistent request limits. Clearing browser storage does not delete an account: logging in restores its profile ID, stats, friends, and existing seats.

Presence tracks each open browser document across the site. Closing or leaving sends an identity-bound offline beacon; other open tabs keep the account online, and in-site navigation does not briefly disconnect it. Opaque Supabase Realtime signals immediately invalidate friends' authenticated snapshots without publishing private table codes. A blocked stream falls back to polling every two seconds; slow reads are coalesced. A crash or lost connection cannot deliver a departure, so its lease expires after 75 seconds. Account creation alone never marks someone online. Apply migrations through `0013_live_presence.sql` before deploying this client. A live Supabase check confirmed online and offline invalidations in 800ms and 437ms respectively; browser regressions cover multiple tabs, page restoration, account changes, and slow connections.

The account page provides avatar, display name, username, and password changes, plus separate sign out and permanent deletion controls. The avatar editor offers six styles and a separate skin-tone selector: the original default plus five shades. Both choices preview together and save across devices, profiles, friends, standings, and active tables; Cancel restores the saved appearance. Existing avatars keep their original appearance until edited. Password changes revoke other sessions. Deletion requires the current password and an explicit confirmation, removes all account and social records, and anonymizes retained game seats. Game actions check the live account session as well as any saved seat token.

Existing browser profiles can add credentials without changing their profile ID. After upgrading, the old browser key no longer grants access. A profile whose original browser key was already lost cannot be claimed by name alone.

The play screen offers a new table or joining by code, using a saved display name or a guest name. Friends sit beside the table setup panels and can be invited from the lobby. A single “Back to your table” shortcut remembers the most recently used table in this browser for 30 minutes after foreground use. Home checks that the table still has players and that the player can resume their seat or join its lobby; empty, missing, expired, and unavailable tables stay hidden. Visiting another table replaces the shortcut, and switching accounts clears it. Choosing Leave during a round hands the seat and its cards to a medium bot and releases the player's access. Simply navigating away preserves the seat for a return. Leaving the lobby or results opens the seat. The full record lives on the public profile page. Account settings contain only account details and session controls.

Login and signup share `/login`. A validated `next` destination returns players to the table, profile, or account screen they came from. A guest name and a complete table code carry into signup from table setup. Account settings preserve a link back to the originating screen. Successful sign out and deletion return to the play screen with a dismissible confirmation. How to play is available in every main website header and all table states. The first opening shows the interactive walkthrough; later openings show scrollable written rules with Show walkthrough again at the bottom. A first confirmed table seat introduces the walkthrough automatically if it has not already been seen in that browser.

Creating an account after joining as a guest attaches the account to that existing seat using its saved credential. The player's seat, hand, and host status stay intact, including mid round and while paused. Avatar edits update that same seat. Rejoining with a saved guest credential also resumes the seat instead of adding another player.

Friends at another table can receive and accept invitations, including during a round or with Do not disturb enabled. Accepting opens the invited table without cancelling the previous round. The destination must still have an open seat in its lobby; invitations to someone already seated there remain unavailable.

| Piece | What it does |
| --- | --- |
| **The record** | Every scored round is written into each seated profile: rounds played and won, total and best hand, tables, Cambio calls and the ones that stuck, sticks landed and missed, current and best streak. |
| **Rank** | Points are a stored column, so the ladder is ordered in the database: a round won is worth four times a round played, and a Cambio you called and won is worth more again. Seven tiers run from Rookie to Cambio Master, with your standing among every saved player beside them. |
| **Friends** | One row per relationship, pending until it is accepted. Asking someone who has already asked you accepts it instead of opening a second request. |
| **Opponents** | Every round records who was across the table, so the friends list knows the head to head and can suggest the people you have already played. |
| **Invites** | A code handed to one friend, from the table you are sitting at. The server checks you are actually seated there before it sends one. |
| **Presence** | Your client says which table it is at; the server reads the phase and the open seats from the table itself, so "one seat open" is never a guess. A light goes out two minutes after a tab closes. |

Every one of these goes through a `SECURITY DEFINER` RPC gated by the server secret. The anon key can no more read a profile than it can read a hand of cards.

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

First time players get a short walkthrough. **How to play** then opens a desktop rules reference, with the option to replay the walkthrough at the bottom.

---

## How to Play

1. **Create a table and share the code.** Four seats are available, and bots fill any empty seats when the round starts.
2. **Say you are ready.** Your four cards are already dealt, face down. The bots say yes at once, and nothing is shown to anyone until the last seat is in.
3. **Remember your opening cards.** Once the table is ready, a five second window shows everyone their own bottom two, all at the same time.
4. **Draw on your turn.** Place the drawn card on the pile to activate its power, or swap it into any hand at the table, your own or someone else's.
5. **Watch for sticks.** If you believe a card matches the top of the pile, stick it. Sticking is open to every seat at every moment, your own turn included; where the turn already owns the click, the table arms the stick first.
6. **Call Cambio.** Call at the start of your turn instead of drawing. Everyone else gets one more turn before scoring.
7. **Finish with the lowest total.** Hands are revealed and scored. The lowest total wins, and the winner leads the next round.
8. **Play on, or leave.** Every seat chooses. Another round starts once everyone is ready; if anyone leaves, the rest go back to the lobby with a seat open.

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
| `src/lib/server/social.ts` | Profiles, friends, invites, presence, and writing a scored round into the record books |
| `src/lib/social/` | Profile and friend types, and the rank ladder based on points |
| `src/lib/client/` | `useGame` hook, Realtime subscription, actions, watchdog, card flights, profile and friends |
| `src/components/` | Table UI, profile cards and the friends panel |
| `supabase/` | Database schema and RPCs |

---

## Run It Locally

You need a Supabase project.

### 1. Set up the database

Apply the migrations, in order:

```text
supabase/migrations/0001_cambio_schema.sql
supabase/migrations/0002_social.sql
supabase/migrations/0003_presence_invites.sql
supabase/migrations/0004_accounts.sql
supabase/migrations/0005_usernames.sql
supabase/migrations/0006_table_join_requests.sql
supabase/migrations/0007_social_resends.sql
supabase/migrations/0008_room_do_not_disturb.sql
supabase/migrations/0009_leaderboard.sql
supabase/migrations/0010_browser_presence.sql
supabase/migrations/0011_profile_avatars.sql
supabase/migrations/0012_avatar_skin_tones.sql
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


For the complete account lifecycle, start Docker and install the test browser once:

```bash
npx playwright install chromium
npm run test:accounts
```

This command creates isolated Postgres and PostgREST containers, applies every migration, runs the SQL account tests, starts a local app using dummy credentials, and runs the browser suite. It removes the test containers afterward. Stop any existing Next development server first so the test app can use the development build directory.

The browser suite covers registration, duplicate usernames, display name changes at active tables, username changes, wrong and correct passwords, session revocation, logout, a failed logout request, delayed responses after logout, multiple tabs, legacy profile upgrades, restored stats and friends after clearing storage, seat recovery, permanent deletion, request origin checks, and mobile account layouts. These tests never use the live Supabase database.
