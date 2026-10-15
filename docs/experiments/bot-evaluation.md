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

Everything below comes from `npm run results` (introduced in 44fda52, with the H2 grouping corrected in e0e09d8). One run plays 6,800 rounds and logs 3,784 actual Cambio calls. Raw data is in `results/rounds.csv` and `results/calls.csv`; summaries are in `results/matchups.csv`, `results/calibration.csv` and `results/summary.json`. The output is byte identical across runs and worker counts.

**Defaults check first.** With the options object in place and every option at its default, the original benchmark reproduces exactly, so the evaluation went ahead:

| Matchup, seeds 1 to 24 and 101 to 124 | Win shares | Mean final hand |
| --- | --- | --- |
| Hard vs medium | 64.5 to 31.5 | 5.06 vs 7.40 |
| Medium vs easy | 82.5 to 13.5 | 6.05 vs 12.43 |

| Hypothesis | Verdict | Key numbers |
| --- | --- | --- |
| H1, levels ordered | **Supported** | Hard won 63.3% against medium (60.2% to 66.3%); medium won 78.3% against easy (75.6% to 81.0%) |
| H2, calls trustworthy | **Refuted** | Shipped bots' calls won 54.0% (52.1% to 55.9%), below the 64% the gate requires, at an average belief of 87.0% |
| H3, each ability adds strength | **Supported for all four** | Removing memory, counting, inference or the gate each left hard below an even split |
| H4, harness fair | **Supported** | Every copies control and every seat order difference stayed within its interval |

![Win share by matchup, with 95% intervals](../images/win-share.svg)

### H1: the three levels are clearly ordered. Supported.

| Matchup | Share won by the first side | Seed set A | Seed set B | Mean final hand |
| --- | --- | --- | --- | --- |
| Hard vs medium | 63.3% (60.2% to 66.3%) | 62.1% (57.9% to 66.4%) | 64.4% (60.0% to 68.9%) | 5.64 vs 7.82 |
| Medium vs easy | 78.3% (75.6% to 81.0%) | 80.8% (77.2% to 84.3%) | 75.8% (71.8% to 79.8%) | 6.65 vs 12.58 |
| Hard vs easy | 85.3% (83.0% to 87.7%) | 85.6% (82.3% to 88.9%) | 85.1% (81.7% to 88.5%) | 5.23 vs 13.25 |

Each matchup is 800 rounds over 400 seeds. Neither interval for H1 comes near an even split, and each seed set agrees on its own.

### H2: the Cambio gate. Refuted.

Every call the shipped bots made passed the gate, as the tests require, so every caller believed it had at least a 64% chance of winning. Those calls won far less often than that: 1,440 of 2,668, or 54.0% (Wilson interval 52.1% to 55.9%), while the average belief at the moment of calling was 87.0%. A tie for the lowest hand counts as a win here, as it does in the belief; 254 of the 1,440 wins were ties.

| Belief at the call | Calls | Won | Observed win rate | 95% interval |
| --- | --- | --- | --- | --- |
| 64% to 70% | 128 | 67 | 52.3% | 43.7% to 60.8% |
| 70% to 80% | 681 | 333 | 48.9% | 45.2% to 52.6% |
| 80% to 90% | 712 | 371 | 52.1% | 48.4% to 55.8% |
| 90% to 100% | 1,147 | 669 | 58.3% | 55.4% to 61.1% |

Every bin has at least 128 calls, and every bin's observed rate sits at least 15 points below its average belief: 67.6% believed against 52.3% observed in the lowest bin, and 97.3% against 58.3% in the highest.

| Level | Calls | Won | Observed win rate | 95% interval | Average belief |
| --- | --- | --- | --- | --- | --- |
| Easy | 260 | 162 | 62.3% | 56.3% to 68.0% | 85.7% |
| Medium | 822 | 462 | 56.2% | 52.8% to 59.6% | 86.4% |
| Hard | 1,586 | 816 | 51.5% | 49.0% to 53.9% | 87.5% |

Easy's interval alone still reaches 64%; medium's and hard's do not. Hard, the level with the best information, makes the least accurate calls. It also makes the most, partly because full hard sits in seven of the ten matchups.

Where the belief misses, measured from the same calls: the caller's final hand ended on average 3.29 points worse than its own estimate (median 2.16), even though it knew all but 0.25 of its own cards on average when it called. The best opponent ended on average 2.74 points better than the rollout's estimate for the strongest opponent (median 2.73), and better than that estimate in 77.7% of calls. Both errors push toward losing. The rollout gives each opponent one final draw and its best improving replacement; it does not model sticks, pushed cards, blind swaps or other powers during the final turns. Whether those account for the gap was not measured.

With the gate removed, hard called whenever it estimated a lead: 589 calls at an average belief of 45.8%, of which 151 won (25.6%, 22.3% to 29.3%). In every gate removed bin with at least 30 calls, the observed rate is again below the belief. The bins below 20% and above 70% hold fewer than 30 calls each and are too small to judge.

![Do Cambio calls win as often as the bots believe?](../images/calibration.svg)

### H3: each ability adds strength. Supported for all four.

Each row is a hard bot with one ability removed, against full hard bots, over 800 rounds.

| Ability removed | Reduced bot's win share | Seed set A | Seed set B | Mean final hand, reduced vs full |
| --- | --- | --- | --- | --- |
| Memory: keeps only its two latest cards | 37.6% (34.5% to 40.8%) | 35.8% (31.4% to 40.2%) | 39.5% (35.0% to 44.0%) | 7.27 vs 5.30 |
| Card counting | 47.1% (44.4% to 49.7%) | 47.2% (43.4% to 51.1%) | 46.9% (43.2% to 50.6%) | 5.83 vs 5.75 |
| Inference from public keeps | 44.6% (41.6% to 47.6%) | 41.7% (37.6% to 45.7%) | 47.6% (43.2% to 52.0%) | 6.30 vs 5.58 |
| Cambio gate | 44.4% (41.5% to 47.4%) | 44.0% (40.1% to 47.9%) | 44.9% (40.4% to 49.4%) | 9.85 vs 9.26 |

Memory matters most. Card counting is the smallest effect and passes only narrowly: its pooled interval tops out at 49.7%, and each seed set on its own includes an even split. Removing the gate costs strength even though the gate's beliefs are badly overconfident (H2): in that matchup a Cambio call ended 678 of the 800 rounds, 589 of them by the gateless bots, and those calls won about one time in four. So the gate works as a filter even though its numbers are not probabilities.

![Hard with one ability removed, against full hard](../images/ablations.svg)

### H4: the harness is fair. Supported.

Four copies of the same level, seats 1 and 3 against seats 2 and 4, 400 rounds each:

| Level | Share won by seats 1 and 3 |
| --- | --- |
| Easy | 53.8% (49.1% to 58.5%) |
| Medium | 48.8% (44.0% to 53.5%) |
| Hard | 50.5% (45.9% to 55.1%) |

Seat order, for each reversed matchup: the first side's share when it sat in seats 1 and 3, when it sat in seats 2 and 4, and the 95% interval of the difference per seed. Every interval spans zero.

| Matchup | Seats 1 and 3 | Seats 2 and 4 | Difference, 95% interval |
| --- | --- | --- | --- |
| Hard vs medium | 63.0% | 63.6% | 7.2 points lower to 6.0 points higher |
| Medium vs easy | 79.6% | 77.0% | 3.0 points lower to 8.2 points higher |
| Hard vs easy | 86.6% | 84.1% | 2.1 points lower to 7.1 points higher |
| Memory removed vs hard | 38.8% | 36.5% | 4.1 points lower to 8.9 points higher |
| Counting removed vs hard | 46.4% | 47.7% | 8.6 points lower to 6.0 points higher |
| Inference removed vs hard | 43.2% | 46.0% | 9.9 points lower to 4.2 points higher |
| Gate removed vs hard | 43.7% | 45.2% | 8.8 points lower to 5.7 points higher |

Easy copies come closest to the edge (the interval's low end is 49.1%), so a small seat effect at that level cannot be ruled out at this sample size.

## What did not work or was not measured

* **No human versus bot data.** Every number here is bots playing bots. Whether the gaps between levels hold against people, or how the levels feel to play, is unknown.
* **No load or latency testing.** The evaluation calls the engine directly. Nothing here measures the realtime layer, the Vercel functions or Postgres under many simultaneous tables.
* **Belief estimates are decision estimates, not calibrated promises.** H2 now puts a number on it: calls believed to win 64% to 100% of the time won about half the time. The gate is a useful filter (H3), but its percentages should not be read as probabilities. Calibrating them, for example by modeling final turn sticks and attacks, was not attempted.
* **The best informed level makes the worst calls.** Hard's calls won 51.5%, against 62.3% for easy. Why was not measured.
* **Rounds, not games.** Each seed plays one round. Full games, where the winner leads the next round, were not simulated.
* **Equal reaction speeds.** Every level gets the same reaction time here, so hard's faster sticks in the live game are not part of these numbers, and races between sticks are not tested.
* **One memory length.** Only a two card memory was removed and tested. Medium's actual rule (its own cards plus six others) and other lengths were not tested separately, and every ablation was tested only as hard against hard.
* **Card counting's effect is small.** It clears the H3 bar only when both seed sets are pooled.
