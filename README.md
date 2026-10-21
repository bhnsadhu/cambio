<p align="center"><img src="docs/brand/logo.svg" width="112" height="112" alt="Cambio logo, a C dealt from playing cards with the ace of spades on top"></p>

# Cambio

[![CI](https://github.com/bhnsadhu/cambio/actions/workflows/ci.yml/badge.svg)](https://github.com/bhnsadhu/cambio/actions/workflows/ci.yml)
[![Players](https://img.shields.io/endpoint?url=https%3A%2F%2Fcambio.bhanusadhu.com%2Fapi%2Fstats%3Fformat%3Dshields)](https://cambio.bhanusadhu.com/leaderboard?scope=all)

A real time multiplayer web app for the card game Cambio, also known as Cabo, where house bots that see only what a human could see fill every empty seat.

**Play it live: [cambio.bhanusadhu.com](https://cambio.bhanusadhu.com)**

## The question

Can bots that only see what a human could see play at three clearly different skill levels, and can their Cambio calls be trusted?

**The levels, yes. The calls, no.** Over 800 seeded rounds per matchup, hard won 63.3% of the win share against medium (95% interval 60.2% to 66.3%), and medium won 78.3% against easy (75.6% to 81.0%). Removing any one of memory, card counting, inference from public keeps, or the call gate made hard measurably weaker. But the Cambio calls are overconfident: every call by the shipped bots cleared a 64% belief gate, the average belief was 87.0%, and only 54.0% of the calls won (1,440 of 2,668).

The hypotheses were committed before any evaluation code. The full write up, with every interval and what was not measured, is in [the bot evaluation](docs/experiments/bot-evaluation.md), and `npm run results` regenerates every number and chart.

**Can models trained on simulated play do better? Partly, and none of it is live yet.** Per level models, trained only on what each level may know and evaluated once on untouched test seeds, gave Cambio calls whose stated chances are far closer to the truth (calibration error 0.086 against the gate's 0.310) and made medium and hard stronger against their frozen selves (54.7% and 58.8% of the win share). The levels kept their order and their identity. But learned actions did not clear the bar for easy (its interval reached 49.97%), and the call model calls on hands it should know are lost when a position is far from its training data, so real players still get the original bots. Details in [the learned policy results](docs/experiments/bot-evaluation.md#learned-policies-results) and [ml/README.md](ml/README.md).

**Can each level switch to learned actions on its own? Not yet.** After that first run, the owner allowed each level to go live separately. That rule was written after seeing the first run, so the only thing tuned was each level's action mix (the share of its focused decisions that use its learned action model), on validation seeds only, and the result was tested once on fresh seeds. With easy at 0.5, medium at 1 and hard at 0.75, no level did worse than its frozen self, the levels stayed ordered, and none reached the frozen level above it. But one existing behavior test fails with that setting live: in a test position, hard skips a blind swap that the frozen rules use to take the lead. The rule written before the run requires every existing test to pass, so nothing went live and every level still plays the original policies. Details in [the per level results](docs/experiments/bot-evaluation.md#per-level-go-live-results).

![Win share by matchup, with 95% intervals](docs/images/win-share.svg)

## How the three levels play

Real players get the frozen bots (C0). The documented behavior of each level, measured from 300 instrumented bot rounds on fresh seeds ([audit](docs/experiments/bot-evaluation.md#h14-the-frozen-bots-measured-against-the-docs)):

| Documented | Easy | Medium | Hard |
| --- | --- | --- | --- |
| Share of opportunities played with the full strategy (50%, 75%, 100%) | 49.9% (49.2% to 50.7%) | 75.1% (74.4% to 75.7%) | 100% |
| Memory: easy its two latest cards, medium its own cards plus six opponent cards, hard everything it has seen | Never more than 2 faces | Never more than 3 opponent faces, no own face forgotten | No seen face forgotten while on the table |
| Easy misses sticks | Missed 55.3% of the sticks its full strategy would make | 27.3% | 0% |
| Easy skips useful powers | Skipped 52.8% of the powers its full strategy would use | 29.9% | 0% |
| Easy reacts slowest, hard fastest | Not measured: the audit's delay checks were void because of a reporting bug | | |

Against each other and against a beginner reference player (keeps only its opening peek, never sticks or uses powers, and calls when its known cards total 2 or less), over 800 rounds per matchup on fresh seeds, with the owner's target for each ([ladder](docs/experiments/bot-evaluation.md#h15-the-owner-targets)):

| Matchup | Target | Live bots (C0) | With the tuned learned actions (A*, not live) |
| --- | --- | --- | --- |
| Easy vs beginner | 45% to 85% | 55.2%, met | 56.4%, met |
| Medium vs beginner | 65% to 95% | 73.7%, met | 78.5%, met |
| Hard vs beginner | at least 85% | 78.4% (75.9% to 81.0%), missed | 84.8% (82.6% to 87.0%), marginal |
| Hard vs medium | 55% to 75% | 63.0%, met | 58.8%, met |
| Medium vs easy | 65% to 90% | 80.2%, met | 82.6%, met |

## Demo

![A round of Cambio against the house bots: the landing page, a dealt table, draws, sticks, a player running out of cards, and the results](docs/images/demo.gif)

*One full round against the three house bots, sped up about seven times. Recorded on the local test database, not the live site.*

## Architecture

```mermaid
flowchart TB
  player["Player's browser<br/>anon key only"]
  functions["Vercel Functions<br/>pure rules engine<br/>bot turns via waitUntil"]
  subgraph postgres["Supabase Postgres"]
    games[("games<br/>secret state, RLS")]
    views[("game_views<br/>redacted view")]
  end
  realtime["Supabase Realtime"]
  seats["Every seat's browser"]

  player -->|"Step 1: action"| functions
  functions -->|"Step 2: version checked commit,<br/>retried on conflict"| postgres
  games -->|"Step 3: same commit"| views
  views -->|"Step 4: Postgres Changes"| realtime
  realtime -->|"Step 5: new view"| seats
  functions -.->|"private view:<br/>drawn card, reveals"| seats
```

Every move is a pure function over the current state. The server loads the state and its version, runs the action through the engine, and commits only if the version is unchanged; a losing commit reloads and runs again, so the rules decide every late arrival. More in [docs/architecture.md](docs/architecture.md).

## Highlights

| Feature | What it does |
| --- | --- |
| **Real time multiplayer** | Every move streams to all four seats over Supabase Realtime. Simultaneous moves are serialized, and the rules decide every late arrival. |
| **Complete game engine** | Turn logic, power cards, anytime sticking, and every way a round can end, in about 1,550 lines of pure TypeScript with no I/O. |
| **Bots that play from memory** | Three house bots fill empty seats and act only on information they have legitimately seen, at three difficulties. |
| **Persistent accounts** | Wins, rank and streak across every table, with friends, invites and a light for whoever is playing right now. |
| **Friends and global leaderboards** | Compare lifetime points with accepted friends or all players. Equal points share a rank, and your position stays visible even outside the current page. Guests can browse the global leaderboard. |
| **Serverless architecture** | Runs on serverless functions and one Postgres database, with no dedicated game server. |
| **Learned bot policies, tested before shipping** | Per level call and action models trained from rollouts of seeded play, with features limited to what each level may know, a plain TypeScript forward pass, and hypotheses written before any model code. They stay off until a test run supports them. |
| **Engine and browser regression suites** | Seeded bot versus bot tables played to the score, checking that every move is legal, no card is created or lost, and each difficulty beats the one below it. A Playwright suite covers the whole account lifecycle against an isolated database. |

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
| Continuous integration | GitHub Actions, with no real secrets |
| Typography | Plus Jakarta Sans |

## Measured and not yet measured

**Measured** (bot versus bot, regenerated by `npm run results`; details in [the bot evaluation](docs/experiments/bot-evaluation.md))

* Level ordering with 95% intervals, over 800 rounds per matchup and two independent seed sets (above).
* Which abilities matter: against full hard bots, a hard bot won 37.6% with only two remembered cards, 47.1% without card counting, 44.6% without inference from public keeps, and 44.4% without the call gate.
* Call calibration: the shipped bots' calls won 54.0% at an average belief of 87.0%, and no belief bin came within 15 points of its belief ([chart](docs/images/calibration.svg)).
* Fairness controls: four copies of one level split the wins evenly within their intervals, and seat order changed no result.
* The original seeded benchmark still reproduces exactly (hard 64.5 win shares to medium's 31.5, medium 82.5 to easy's 13.5), and every round finishes with only legal moves and all 54 cards accounted for after every action.
* Hidden information: tests permute every unseen card, reverse the deck, and throw on any attempted read of a card a bot has not seen, and the bots' plans must not change.
* Learned policies, once on 400 untouched test seeds ([results](docs/experiments/bot-evaluation.md#learned-policies-results), [chart](docs/images/learned-win-share.svg)):
  * The learned call model's calls had a calibration error of 0.086 against the gate's 0.310 (H5 supported), but its calls won 48.7% against the gate's 55.6%, and it calls on hands it should know are lost in unusual positions.
  * Learned actions beat their frozen level for medium (54.7%, 51.6% to 57.7%) and hard (58.8%, 55.6% to 61.9%), but not clearly for easy (52.8%, 49.97% to 55.6%), so H6 is refuted.
  * With learned calls, learned actions or both, hard still beat medium and medium still beat easy, no learned level reached the frozen level above it, and every hidden information test passed (H7, H9 and H8 supported).
* A per level go live, tuned on validation seeds and tested once on fresh seeds ([results](docs/experiments/bot-evaluation.md#per-level-go-live-results)):
  * With learned actions on half of easy's focused decisions, all of medium's and three quarters of hard's, no level did measurably worse than its frozen self (easy 52.8% with an interval from 49.9%, medium 60.5%, hard 56.5%), hard still beat medium (58.8%) and medium still beat easy (82.6%), and neither easy nor medium reached the frozen level above it (H10, H11 and H12 held).
  * Every bot call passed the gate, every round finished legally, and a learned action decision took 3.50 ms at the 99th percentile. But one existing behavior test fails with that setting live (hard skips a blind swap in a test position), so H13 failed and nothing went live.
  * The frozen bots matched every documented claim the audit could measure: effort shares, memory limits, missed sticks and skipped powers by level, and the call gate. Reaction speed was not measured validly.
* What real players get: the original bots, `gate_v1` and `rules_v1` at every level. Learned actions stay off because the per level switch failed H13 (and, before it, H6 was refuted for easy). Learned calls stay off because switching them on fails the existing tests that forbid calling on a known losing hand. Both remain in the code as options, set per level in `src/lib/game/bot-policies.ts`.

**Not yet measured**

* Any human versus bot play.
* Load, latency, or behavior under real traffic beyond the concurrency races the tests stage.
* Calibrated calls that are also safe. The learned call model is better calibrated but extrapolates badly far from its data; a guarded version was not tested, because the test seeds have been used.
* Whether the learned policies feel right or fun to people.
* Reaction speed by level. The audit's delay checks were void, and the seeds are spent.
* Full games to a score. The evaluation plays single rounds at equal reaction speeds.
* Phone play. The table is built and tested for laptop and desktop windows.

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
supabase/migrations/0013_live_presence.sql
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
npm run typecheck
npm run lint
npm test
```

For the complete account lifecycle, start Docker and install the test browser once:

```bash
npx playwright install chromium
npm run test:accounts
```

This command creates isolated Postgres and PostgREST containers, applies every migration, runs the SQL account tests, starts a local app using dummy credentials, and runs the browser suite. It removes the test containers afterward. Stop any existing Next development server first so the test app can use the development build directory.

The browser suite covers registration, duplicate usernames, display name changes at active tables, username changes, wrong and correct passwords, session revocation, logout, a failed logout request, delayed responses after logout, multiple tabs, legacy profile upgrades, restored stats and friends after clearing storage, seat recovery, permanent deletion, request origin checks, and the account and login pages in a 390 pixel wide window without sideways scrolling. The same run also covers gameplay, bots, presence, notifications, seat management, and the table at laptop sizes from 1024 by 768 to 1440 by 900. These tests never use the live Supabase database.

Continuous integration runs all of the above on every push and pull request; see [.github/workflows/ci.yml](.github/workflows/ci.yml).

### 5. Regenerate the bot evaluation

```bash
npm run results
```

This deletes and rewrites every file in `results/` and the three charts in `docs/images/`, then prints how long it took. It first replays the original seeded benchmark and stops if that no longer reproduces, then plays 6,800 seeded bot rounds across all CPU cores. On an 8 core Apple M3 it printed 107.7 and 129.5 seconds on two runs. The output is deterministic: runs with 3 and 7 workers wrote byte identical files. It needs Node 24 and no extra packages, since Node runs the TypeScript directly.

### 6. Retrain the bot models

```bash
npm run ml:data -- --split train --seeds 200
npm run ml:data -- --split validation --seeds 100
python3 -m venv ml/.venv && ml/.venv/bin/pip install -r ml/requirements.txt
cd ml && .venv/bin/python train_call.py && .venv/bin/python train_action.py && cd ..
npm run ml:tune -- --thresholds
npm run ml:tune -- --check
```

Collecting the data took 21 and 11 minutes on 4 cores; training takes a few minutes. The models land in `src/lib/game/models/` and the tests check the TypeScript forward pass against them. Retrained models need fresh test seeds before any claim about them, since the current ones have been used. [ml/README.md](ml/README.md) has the data schema and every validation number.

### 7. The per level go live runs

```bash
npm run ml:speed          # time per learned action decision, validation seeds
npm run ml:tune-mix       # choose each level's action mix, validation seeds
npm run audit:levels      # the frozen bots against the docs, seeds 540001 to 540050
npm run ml:ladder         # C0 and A* against each other and the beginner
npm run ml:evaluate-live  # each A* level against its frozen self and the level above
```

Each prints its wall time and plays on the same worker pool as `npm run results`. On a 4 core cloud container they took 5.2, 263.9, 12.3, 187.6 and 198.4 seconds. The last four write a `run.lock` before playing and refuse to run again, because their seeds are used once; they have run, and their results are in `results-tuning/`, `results-audit/`, `results-ladder/` and `results-live/`.

## Deeper docs

| Doc | What is in it |
| --- | --- |
| [How to play](docs/how-to-play.md) | Quick start, the steps of a round, scoring, and additional rulings |
| [The game engine](docs/engine.md) | Every rule system the engine enforces, and the power cards |
| [Bot AI](docs/bots.md) | What bots may know, the three levels, the Cambio gate, and the benchmark |
| [Bot evaluation](docs/experiments/bot-evaluation.md) | The question, hypotheses written before the code, results with intervals, and what was not measured |
| [Learned bot policies](ml/README.md) | Training data, schema, models, validation results and tuning |
| [Decisions log](docs/decisions.md) | Rules and product decisions that changed over time, with commits and recorded reasons |
| [Architecture](docs/architecture.md) | Real time state sync, hidden information boundaries, and the project layout |
| [Profiles and friends](docs/accounts.md) | Accounts, guests, presence, friends, invites, and the permanent record |
| [Front end](docs/front-end.md) | Card motion and the notification scale |
| [Visual reference](docs/visual-reference.md) | Visual sources and avatar artwork |
| [Avatar skin tones](docs/avatar-skin-tones.md) | How the tone sheets were made and rendered |
