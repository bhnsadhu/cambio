# Bot evaluation

Back to the [README](../../README.md). The bots themselves are described in [docs/bots.md](../bots.md).

## The question

Can bots that only see what a human could see play at three clearly different skill levels, and can their Cambio calls be trusted?

This document was committed before any evaluation code. The hypotheses and the conditions that would refute them come first; the results will be added below them without changing the hypotheses.

## Setup

**Engine and bots.** Every round is played by the production rules engine (`src/lib/game/engine.ts`) and the production bot strategy (`src/lib/game/bots.ts`). Nothing is forked. Bots see only what their seat could see, which existing tests already enforce.

**Harness.** The seeded bot versus bot harness from `src/lib/game/bot-strength.test.ts`: one complete round per seed with four bot seats, equal reaction speeds for every level, deterministic randomness per seed, and checks after every action that the move was legal and that all 54 cards are still accounted for with no duplicates. A round that does not finish counts as a failure, not as a result.

**Matchups.** Two sides share a table, two seats each, alternating around it (A B A B). Each seed is played twice with the seating reversed (B A B A), so each side holds each position once per seed.

**Seeds.** Two independent seed sets of 200 seeds each, so every matchup is played over 800 rounds (2 sets, 200 seeds, 2 seatings). The sets are 1 to 200 and 10001 to 10200.

**Ablations.** A strategy options object lets one ability be removed from a bot. Its defaults must equal current behavior exactly, which is checked before anything else by reproducing the existing benchmark: hard 64.5 win shares to medium's 31.5, and medium 82.5 to easy's 13.5, on the existing seeds. If that does not reproduce, the evaluation stops. Each ablation removes one ability from a hard bot and plays it against full hard:

* **Memory:** keeps only its two most recently observed cards, the same length as easy.
* **Card counting:** always assumes an unseen card is drawn from the full deck, ignoring the discards and remembered cards it has seen.
* **Inference from public keeps:** gives no weight to an opponent keeping or pushing a drawn card.
* **Cambio gate:** drops the belief thresholds and calls whenever it estimates it leads, after the same minimum number of turns.

**Controls.** Four copies of the same level, with seats 1 and 3 counted as one side and seats 2 and 4 as the other, over both seed sets (400 rounds per level). A seat order check compares each matchup's result when side A sits first with its result when side A sits second.

**Measures.**

* Win share: each round's win is split equally among tied winners, so the two sides' shares add up to one per round. An even split is 0.5.
* Mean final hand score per seat.
* Every actual Cambio call, logged with the caller's estimated win belief at the moment of calling and whether the caller finished among the round's winners. Beliefs are grouped into bins, and each bin reports its count and observed win rate. A bin with fewer than 30 calls is reported as too small to judge.

**Intervals.** For each seed, a side's win share is averaged over its two seatings. The 95% interval is the mean across seeds plus or minus the t critical value times the standard deviation across seeds divided by the square root of the number of seeds. The same method gives intervals for mean scores and for the seat order difference. Observed win rates in calibration bins use the Wilson score interval.

**Outputs.** Raw and summary results as CSV and JSON under `results/`, charts under `docs/images/`, all regenerated from scratch by `npm run results`.

## Hypotheses

**H1. Hard beats medium, and medium beats easy, in win share.**
Refuted if the 95% interval for either matchup includes an even split.

**H2. The shared Cambio gate works as documented.**
Refuted if the win rate of bot calls falls below the belief threshold the gate requires (64%).

**H3. Each bot ability adds measurable strength: memory, card counting, inference from public keeps, and the call gate.**
Refuted for an ability if removing it does not change win share outside its 95% interval.

**H4. The harness is fair.**
Refuted if a bot playing copies of itself deviates from an even split outside its interval, or if results change with seat order.

## Results

Not yet run.
