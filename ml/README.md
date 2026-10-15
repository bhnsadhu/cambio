# Learned bot policies

Training code and data for the learned call and action policies evaluated as H5 to H9 in [the bot evaluation](../docs/experiments/bot-evaluation.md). Back to the [README](../README.md).

Everything here runs on a laptop with no paid service. The TypeScript side produces the data and runs the exported models; the Python side only fits and exports them.

## Data

`npm run ml:data -- --split train --seeds 200` plays seeded rounds of frozen bots (call policy `gate_v1`, action policy `rules_v1`) and values sampled decision points by rollouts. It writes `ml/data/<split>.jsonl`, one JSON line per decision point, and `ml/data/<split>.manifest.json` with the seeds, the commit, the rollout counts, the feature names, the row counts and a SHA-256 of the data. `ml/data/` is gitignored; [ml/data-sample/](data-sample) holds the first lines of the training data so the schema can be read without running anything.

Only two splits can be collected: training seeds from 100001 and validation seeds from 200001 to 200400. The test seeds (300001 to 300200 and 310001 to 310200) are refused; they are used once, for the evaluation run.

Each round seats every level once, plus one level twice, in a seeded order. Every seat's decisions are found as the frozen round is played, and a seeded share of each kind is valued (all powers and gives, half of the sticks, 35% of the call decisions and 30% of the drawn card decisions).

**Labels.** For each candidate action the true state is copied, the action is taken, the undealt deck (which no seat has seen) is shuffled, and the frozen bots play the rest of the round. Every candidate at a point gets the same shuffles and the same bot randomness, so their values differ only by the action. Each rollout records the deciding seat's win share (1, or 1 split among tied winners, or 0) and its margin (the best other final hand minus its own; positive is good). Action candidates get 4 rollouts each. A call decision gets 8 rollouts of calling now and 2 of drawing instead. The gate may refuse a call; the data records what would have happened anyway.

**Features.** Built by `src/lib/game/bot-features.ts` from the deciding seat's observation only, so a level's data never holds more than that level knows. The same code builds the features when a bot plays.

### Schema

A call decision, at the start of a seat's turn once a full lap has been played:

| Field | Meaning |
| --- | --- |
| `type` | `"call"` |
| `seed`, `lineup`, `point`, `seat`, `level`, `turnsTaken` | Where the decision happened: the round's seed, the levels by seat, the decision's index in the round, the seat (0 to 3), its level, and turns completed |
| `features` | One number per name in the manifest's `callFeatures` |
| `gate` | The frozen gate's win belief, near win belief, and whether it would call |
| `call`, `draw` | Rollout outcomes of calling now and of drawing instead: `share` and `margin`, one entry per rollout |

Any other decision:

| Field | Meaning |
| --- | --- |
| `type` | `"action"` |
| `seed` to `turnsTaken` | As above |
| `kind` | `decide`, `peekOwn`, `peekOther`, `blindSwap`, `kingLook`, `kingDecide`, `stick` or `give` |
| `legal` | How many legal choices there were before pruning |
| `candidates` | Up to 6 choices: the passive one (place, skip, leave, or no stick, written as a null action), the frozen rule's choice, then the best by the frozen evaluator's score. Each has `action`, `rule` (whether the frozen rule picks it), `features` (one number per name in `actionFeatures`) and `outcome` (`share` and `margin` per rollout) |
