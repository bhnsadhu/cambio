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

## Training

```bash
python3 -m venv ml/.venv
ml/.venv/bin/pip install -r ml/requirements.txt
cd ml
.venv/bin/python train_call.py
.venv/bin/python train_action.py
```

Each script fits one model per level on the training data, chooses among its candidates on the validation data only, checks that the exported JSON reproduces scikit-learn's own predictions, and writes the chosen models to [src/lib/game/models/](../src/lib/game/models), a fixed sample of inputs and predictions that the TypeScript forward pass must match, and a validation report in [ml/reports/](reports). Random seeds are fixed, so the same data gives the same models. Each model records the SHA-256 of the training data it came from.

The models in the repository were trained on the data below, both collected at commit 18edbb0 with 4 rollouts per action candidate and 8 per call (2 for drawing instead):

| Split | Seeds | Decision points | SHA-256 | Collection time on 4 cores |
| --- | --- | --- | --- | --- |
| Training | 100001 to 100200 | 6,912 | `e119cc82...f9bda4` | 21 minutes |
| Validation | 200001 to 200100 | 3,331 | `f5b39031...739579` | 11 minutes |

Validation seeds 200101 to 200400 are kept for tuning by play (below). The test seeds are not touched here.

### Call model

Predicts whether calling Cambio now wins, from the call features. Validation, scored on every rollout outcome at every call decision, whether or not the gate would have called:

| Level | Model | Log loss | Brier | ECE | AUROC |
| --- | --- | --- | --- | --- | --- |
| Easy | Gate belief | 0.331 | 0.071 | 0.039 | 0.592 |
| Easy | Gate, recalibrated | 0.266 | 0.069 | 0.028 | 0.602 |
| Easy | Logistic regression (chosen) | 0.267 | 0.070 | 0.036 | 0.615 |
| Easy | Small neural net | 0.280 | 0.072 | 0.052 | 0.616 |
| Medium | Gate belief | 0.512 | 0.134 | 0.072 | 0.666 |
| Medium | Gate, recalibrated | 0.412 | 0.127 | 0.020 | 0.669 |
| Medium | Logistic regression (chosen) | 0.398 | 0.124 | 0.030 | 0.719 |
| Medium | Small neural net | 0.420 | 0.132 | 0.046 | 0.692 |
| Hard | Gate belief | 0.560 | 0.156 | 0.055 | 0.701 |
| Hard | Gate, recalibrated | 0.483 | 0.155 | 0.044 | 0.701 |
| Hard | Logistic regression (chosen) | 0.479 | 0.155 | 0.046 | 0.705 |
| Hard | Small neural net | 0.515 | 0.170 | 0.054 | 0.671 |

Logistic regression had the lowest validation log loss at every level and is the exported model. The gate's raw beliefs are not badly calibrated across all of these decisions, most of which are hopeless positions where both agree; its overconfidence (H2) sits at the high beliefs where it actually calls. The reliability chart compares the two on validation:

![Call model and gate reliability on validation](reports/call-reliability-validation.svg)

### Action model

Predicts each candidate's advantage over the other candidates at the same decision. The best move is the candidate with the highest rollout win share, ties broken by margin. "Lost" is the average win share (or margin) given up against that best move. Validation:

| Level | Points | Chosen model | Best move picked, rule | Best move picked, model | Win share lost, rule | Win share lost, model | Margin lost, rule | Margin lost, model | Decisions using the model |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Easy | 832 | Boosted trees, margin weight 0.05 | 33.1% | 32.2% | 0.078 | 0.074 | 1.86 | 1.99 | blindSwap, decide, give, peekOther, stick |
| Medium | 848 | Boosted trees, margin weight 0.0 | 33.1% | 35.3% | 0.156 | 0.140 | 1.86 | 1.70 | blindSwap, decide, give, stick |
| Hard | 825 | Small neural net, margin weight 0.02 | 32.4% | 32.6% | 0.179 | 0.167 | 1.94 | 1.84 | blindSwap, decide, peekOther, peekOwn |

Each level tried boosted trees and a small neural net, with three weights on the margin, and kept the one with the least win share lost. A decision kind uses the model only if the model lost less win share than the rule on that kind with at least 20 validation points; every other kind keeps rules_v1. The gains are small: 0.4 points of win share per decision for easy, 1.6 for medium and 1.1 for hard. With 4 rollouts per candidate the best move is itself a noisy estimate, which caps how often any policy can match it.
