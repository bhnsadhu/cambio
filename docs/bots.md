# Bot AI

How the house bots decide, what they are allowed to know, and how their strength is measured. Back to the [README](../README.md). The full evaluation, with its hypotheses, intervals and data, is in [the bot evaluation](experiments/bot-evaluation.md).

The bots choose from information they could legitimately observe: opening peeks, their own draws, private power reveals, face up discards, and public card movements. Each bot's strategy receives a separate observation containing only that seat's remembered or currently revealed faces and public information. Unseen faces, deck order, other players' private reveals, and other bots' memories are excluded before evaluating moves or rechecking a Cambio call. Hard's 100% strategy still estimates unknown cards; it cannot see them.

All difficulties use the same rules engine as humans. Fairness tests change hidden faces, reverse the deck, and replace opponents' private knowledge without changing the bot's observation, moves, or call assessment. Additional tests throw on any attempted secret read and check that unpeeked cards, face down gifts, blind swaps, and penalties do not grant new knowledge.

| Level | How it plays |
| --- | --- |
| **Easy, 50%** | Uses the full strategy on half of its tactical opportunities. Remembers only its two most recently seen cards, misses sticks, skips useful powers, and sometimes keeps a mediocre draw without checking what it replaces. Slowest reactions. |
| **Medium, 75%** | Uses the full strategy on three quarters of its tactical opportunities. Remembers its own revealed cards plus six opponent cards, counts public discards, and makes targeted attacks and swaps, with occasional lapses. |
| **Hard, 100%** | Always uses the full strategy and retains every legitimately observed face. Counts every seen card, infers likely quality from public keeps and pushes, compares moves against every opponent, sets up matching sticks, and avoids discards that could let opponents shed cards. Fastest reactions. |

Measured against these descriptions in 300 instrumented rounds of the frozen bots on fresh seeds ([the audit](experiments/bot-evaluation.md#h14-the-frozen-bots-measured-against-the-docs)):

| Documented | Easy | Medium | Hard |
| --- | --- | --- | --- |
| Share of opportunities played with the full strategy (50%, 75%, 100%) | 49.9% of 17,747 (49.2% to 50.7%) | 75.1% of 17,255 (74.4% to 75.7%) | 16,377 of 16,377 |
| Memory | Never more than 2 faces | Never more than 3 opponent faces (the cap is six), no own face forgotten while in hand | No remembered face forgotten while still on the table |
| Sticks the full strategy would make that the bot did not try | 55.3% of 847 | 27.3% of 1,340 | 0 of 1,156 |
| Powers the full strategy would use that the bot skipped | 52.8% of 892 | 29.9% of 686 | 0 of 557 |
| Draws kept without checking what they replace | 641 | 270 | 0 |
| Reaction speed | Not measured validly | | |

Reaction speed is what the code sets rather than a measurement: every delay is scaled by 1.35 for easy, 1 for medium and 0.7 for hard, and sticks wait 3.2 to 5.2 seconds for easy, 2.0 to 3.4 for medium and 1.2 to 2.1 for hard. The audit's delay checks were void because of a reporting bug in the instrumentation, since fixed. Every call in the audit passed the gate, no planned stick targeted a card the bot did not remember, and no effort roll changed between planning passes.

Against each other and against a beginner reference player that exists only in the evaluation (it keeps only its opening peek, swaps a lower draw into its highest known slot, never sticks or uses powers, and calls when its known cards total 2 or less), over 800 rounds per matchup on fresh seeds, with the owner's targets ([the ladder](experiments/bot-evaluation.md#h15-the-owner-targets)):

| Matchup | Target | Live bots (C0) | Tuned learned actions (A*, not live) |
| --- | --- | --- | --- |
| Easy vs beginner | 45% to 85% | 55.2% (52.2% to 58.2%), met | 56.4% (53.5% to 59.4%), met |
| Medium vs beginner | 65% to 95% | 73.7% (71.1% to 76.3%), met | 78.5% (76.0% to 81.0%), met |
| Hard vs beginner | at least 85% | 78.4% (75.9% to 81.0%), missed | 84.8% (82.6% to 87.0%), marginal |
| Hard vs medium | 55% to 75% | 63.0% (59.9% to 66.1%), met | 58.8% (55.5% to 62.1%), met |
| Medium vs easy | 65% to 90% | 80.2% (77.6% to 82.9%), met | 82.6% (80.3% to 85.0%), met |

The percentages control use of the strongest strategy for replacements, powers, sticks, and giving cards; they are not win rates. All levels share the same counting and tactical evaluator. Missed opportunities remain missed on repeated planning passes with the same intent randomness. Bots only stick remembered matches, so easy's mistakes do not create endless blind guess penalties.

All three levels use the same Cambio rule. A deterministic belief rollout compares the bot's estimated hand against every opponent, including their best improving replacement on one final draw. Calling requires an estimated lead, at least 64% winning belief and 80% belief of winning or finishing within one point. There is no random call, absolute score cutoff, or late round fallback. Hard's information is better; its permission to call recklessly is not greater. The reducer checks the assessment again on every commit attempt, so a human stick or concurrent update can cancel an obsolete call.

These probabilities are decision estimates, not calibrated promises: unseen cards and opponents' final turn powers can still overturn a lead. In 192 complete rounds with equal reaction speeds and reversed seatings (seeds 1 to 24 and an independent set, 101 to 124), hard earned 64.5 winning shares against medium's 31.5, with mean scores 5.06 versus 7.40. Medium earned 82.5 shares against easy's 13.5, with mean scores 6.05 versus 12.43. Tied wins divide the share. Every actual Cambio call passed the belief gate. Tests fail on an unfinished round, illegal move, lost or duplicated card, or reversed difficulty ordering. Run `BOT_BENCHMARK=1 npm test -- src/lib/game/bot-strength.test.ts --silent=false` to print the measurements.

The larger evaluation confirms the ordering and measures how far the beliefs are from calibrated. Over 800 rounds per matchup, hard won 63.3% of the win share against medium (95% interval 60.2% to 66.3%) and medium won 78.3% against easy (75.6% to 81.0%). Every call by the shipped bots passed the gate, yet only 1,440 of 2,668 won (54.0%), at an average belief of 87.0%. The gate still adds strength: a hard bot without it won 44.4% against full hard bots. Regenerate everything with `npm run results`.

Every decision a bot makes also runs through two named policies, chosen per seat through its strategy object: call policy `gate_v1` (the belief gate above) and action policy `rules_v1` (the shared tactical evaluator). Learned alternatives, call policy `model_v1` and action policy `model_v1`, are trained per level from rollouts of seeded play, with features built only from what that level's seat may know, and run by a plain TypeScript forward pass. A level using a learned action policy keeps its effort rolls, lapses and memory; the model only re-ranks the moves it considers when focused, and its action mix sets on what share of those focused decisions it does so. Neither is live. On untouched test seeds the learned actions made medium and hard stronger but not clearly easy. A later per level switch, written after seeing that run, tuned the mix on validation seeds (easy 0.5, medium 1, hard 0.75) and tested it once on fresh seeds: no level got worse, the levels kept their order and identity, but with that setting live one existing test fails (hard skips a blind swap the frozen rules use to take the lead), so it did not go live ([results](experiments/bot-evaluation.md#per-level-go-live-results)). The learned call model, though far better calibrated, calls on hands it should know are lost when a position is far from its training data. Live tables use `gate_v1` for every level, and `rules_v1` for every level through the per level constants `LIVE_ACTION_POLICY` and `LIVE_ACTION_MIX` in `src/lib/game/bot-policies.ts`. The training is described in [ml/README.md](../ml/README.md) and the results in [the bot evaluation](experiments/bot-evaluation.md#learned-policies-results).

Cameron consistently uses the Quiff avatar; Camila uses Curls; Cami uses Ponytail. Camille fills the fourth bot seat if every human leaves during a round. Existing saved bot seats receive the same mapping when projected, and human avatar choices remain independent.

Each move waits a randomized, human paced delay. The intent is checked again before it commits, so a bot never sticks a card a human already took.

After every human action, the server starts a bot runner with `waitUntil`. A 20 second database lease keeps it to one runner per game. If a runner dies, the lease expires and the next action or a client nudge starts another.
