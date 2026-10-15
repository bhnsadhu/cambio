# The Game Engine

`src/lib/game/engine.ts` is deterministic. Time, randomness and ID generation are injected, so every rule can be tested in isolation. Back to the [README](../README.md).

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
| **Leaving** | During a round, a medium bot takes over the exact seat, card positions, and pending move. Play continues, and a departing host passes hosting to the earliest joined human still at the table, regardless of seat position. Leaving the lobby or results opens the seat and returns the remaining humans to the lobby. |
| **Removing players** | The host can use Players to remove another human, including while paused. A medium bot takes over during a round; between rounds the seat opens. The removed player's access to the seat is revoked. This is not a permanent ban from joining by code. |
| **Narration** | Every rule that fires writes a structured event: the kind of move, who made it, whose cards it touched, and which cards to light up. Card IDs travel with it and ranks never do. |

## Power Cards

| Card | Power |
| --- | --- |
| 7 or 8 | Peek at one of your own cards |
| 9 or 10 | Peek at another player's card |
| J or Q | Swap any two cards belonging to two different players, without looking. You need not be one of them |
| Black king | Look at two cards from two different players, then decide whether to swap them |
| Red king | No power |

Powers activate when a drawn card is placed on the discard pile. Swapping a drawn card into a hand, your own or anyone else's, does not activate its power.
