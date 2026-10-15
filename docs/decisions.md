# Decisions log

Product and rules decisions that changed over time, rebuilt from the git history and the tests. Back to the [README](../README.md).

Each entry gives what changed, the commits, and what the commit message or the tests say prompted it. Where neither records a reason, the entry says **reason not recorded**, to be filled in. Dates are commit dates. Nothing here adds reasoning that the history does not contain.

## Rules

### The order of a round's start: deal, then ready check, then peek

* **Sep 20, 2026, `b55ae50`.** A round shuffles, deals, and only then opens the peek window. Prompted by, in the commit's words: "so nobody memorises a hand that is still being dealt."
* **Sep 21, 2026, `fb38009`.** Closing the lobby no longer deals. It opens a ready check; bots answer at once, and the deck is shuffled only when the last seat is in. A seat that never answers is carried after 45 seconds "rather than holding the table up". Why a ready check was added at all: **reason not recorded**.
* **Sep 22, 2026, `6115ee4`.** The order became deal, then ready check, then peek: four cards land face down at every seat, the check runs at the dealt table, and the five second peek opens for everyone once the last seat is ready. Prompted by: "The ready check was happening before the deal, on a screen of its own, with nothing on the table: the wrong half of the sequence."
* **Tests:** the `ready check` block in `src/lib/game/engine.test.ts`, including `the ready check is projected to every seat`, `a seat leaving the ready check hands its dealt cards to a ready medium bot`, and `keeps a paused ready check frozen and opens the peek when the remaining host resumes`.

### Pausing needs every seat

* **Sep 19, 2026, `886cb30`.** Any player can ask to pause; the whole table answers, bots agree the moment they are asked, and one decline cancels the request. Resuming works the same way. While paused, every action except the two pause actions is refused, and on resume every clock (turn, owed cards, opening peek, live reveals) shifts forward by the time held.
* **Prompted by:** the message explains the clock shift as the way nobody gets skipped for being away while the table is paused. Why pausing needs unanimity rather than one player's say: **reason not recorded**.
* **Tests:** `needs every seat, pauses on the last agreement, and freezes play`, `resuming needs the same unanimity, and the turn clock picks up where it left off`, `holds the opening peek and its reveals for the length of the pause`, `refuses a second request, a vote with nothing on the table, and a pause outside a round`.

### Sticking is open at every moment, including your own turn

* **Sep 21, 2026, `ee18589`.** The rules used to refuse a stick from the player who was drawing or deciding. Sticking became open to every seat at every stage; only a frozen table, an empty hand or an unpaid debt stops it. Where the turn already owns the click, the table arms the stick first. Prompted by: the old rule "took the one reaction the game runs on away from whoever was mid turn."
* **Sep 22, 2026, `2326f42`.** Bots keep sticking while a power is waiting, and protect valuable negative cards. **Reason not recorded.**
* **Tests:** `sticking stays open to the player whose turn it is, at every stage of it`, `a stick that empties the hand of the player holding a drawn card still ends their turn cleanly`.

### Sticking stays open through the final turn

* **Sep 22, 2026, `9daa912`.** The round used to score the instant the last final turn ended. It now holds the round open on a short window while any card on the table matches the pile, and a stick reopens that window, so a run of matches is never cut off. A timeout closes it regardless. Prompted by: "a player who stuck one match and reached for a second lost the round out from under them before the second request could land."
* **Sep 22, 2026, `ccc0aed`.** Final cards stay stickable through a timed end of round window for every final placement, and an incorrect stick no longer prolongs it (the earlier commit reopened the window on any stick). **Reason not recorded**; the behavior is fixed by `src/lib/game/final-stick.test.ts`, including `starts the full window after a final power finishes`, `does not let incorrect sticks prolong the final window`, `freezes the remaining reaction time while the table is paused` and `schedules final scoring on the server even with four human seats`.
* **Sep 22, 2026, `db8b95d`.** Final sticking stays responsive when realtime falls back to polling. **Reason not recorded.**
* **Tests:** also `sticking is never capped at one: every matching card can be stuck in sequence during the final turns, even the player's own last turn` and `an available stick that nobody claims closes the round once its window runs out, not before`.

### How running out of cards assigns the final turns

* **Sep 18, 2026, `c17ba5d`.** From the first version, reaching zero cards calls Cambio automatically. The final turns are counted from the player whose turn it is: if someone hits zero during another player's turn, that active player finishes the turn as their last, everyone else still holding cards gets one more, and the player at zero is done. A zero during the final turns only removes that player from the queue. **Reason not recorded.** Tests from that commit: `hitting zero via a stick mid-turn: the active player finishes as their last, others get one more, zero player is done`, `hitting zero by giving away your last card also triggers cambio`, `a zero during the final turns just removes that player from the queue`.
* **Sep 24, 2026, `8875332`.** Zero permanently ends a player's part in the round: no extra turns and no penalties, even if a card is later paid back into that hand. **Reason not recorded.** Tests in `src/lib/game/zero-final.test.ts`: `ends the active player's turn immediately and never penalizes that empty hand`, `skips an off-turn zero even after another player pays a card back into that hand`, `does not add a timeout penalty after the last final player sticks their last card`, `automatically settles an excluded debtor's old obligation when an incoming card arrives`.
* **Sep 24, 2026, `c181eae`.** Zero card exclusions stay unique when a bot takes over a seat. **Reason not recorded.**

### Scoring fixes

* **Sep 18, 2026, `1118c21`.** Winner determination covered by tests across mixed hands, red kings, jokers, five card hands and an empty hand; the scoreboard became ranked. **Reason not recorded.**
* **Sep 22, 2026, `9daa912`.** A round no longer scores while a card on the table still matches the pile (see the final turn entry above).
* **Sep 24, 2026, `f193cdb`.** Final scores are shown exactly, including penalties accepted at the final deadline and cards still being handed over. **Reason not recorded.** Tests in `src/lib/game/final-score.test.ts`: `includes a penalty accepted at the final deadline before scoring and rejects later attempts`, `scores after an owed card, a wrong stick, and a final power have all settled`.
* **Sep 24, 2026, `8875332`.** An empty hand is never penalized after it reaches zero (see above).
* **Sep 22, 2026, `84b557e`, and Sep 24, 2026, `13dbe22`.** Browser checks verify every final score, including zero card final turns in four live browsers. **Reason not recorded.**
* **Unchanged:** the ranking points formula has stayed the same since the profiles schema (`66145ee`, Sep 21, 2026): 12 for a win, 3 for any other completed round, 5 more for a Cambio called and won. Its comment says a win "is worth four turns at the table".

### Swaps reach the whole table

* **Sep 20, 2026, `b55ae50`.** A drawn card can go into any slot at the table, not only your own hand, and a jack or queen trades any two cards belonging to two different players. **Reason not recorded.**

### Timers

* **Sep 18, 2026, `1118c21`.** A five second opening peek, and a thirty second idle limit after which a human forfeits the turn and draws a penalty; an unpaid owed card is handed over at random. **Reason not recorded.**

### Between rounds, leaving, and hosting

* **Sep 20, 2026, `b55ae50`.** Another round is the whole table's call rather than the host's: every seat asks, the last yes deals, and bots agree the moment the round is scored. **Reason not recorded.** Test: `bots are in for another round the moment it is scored, so a table only waits on people`.
* **Sep 23, 2026, `c4860ad`.** A player who leaves mid round is replaced by a bot so the round keeps going. **Reason not recorded.**
* **Sep 23, 2026, `2622b69`.** Hosting passes to the earliest joined human still at the table. **Reason not recorded.**
* **Sep 23, 2026, `b826608`.** Hosts can remove players. **Reason not recorded.**
* **Sep 23, 2026, `86a8d09`.** Any player can bring everyone back to the lobby after a round. **Reason not recorded.**
* **Oct 4, 2026, `56efb5c`.** Round leaders stay consistent across replays and lobby restarts. **Reason not recorded.** Tests in `src/lib/game/turn-order.test.ts`: `uses the actual host for a first round even when their seat is not zero`, `follows the winning player when a departure closes up lobby seats`, `returns the lead to the host if the winner leaves`, `lets a winning bot start the replay without moving any seats`.

## Bots

### What a bot difficulty means

* **Sep 18, 2026, `c17ba5d`.** One bot strategy. The next entry calls it "the strategy the bots have always played", which became medium.
* **Sep 21, 2026, `12a0647`.** Three levels. Easy "lets sticks go by, dithers over the drawn card and calls Cambio on a hunch"; hard counts the discards, weighs its hand against every other hand before calling, and sticks twice as fast. The message reports the measurement then: "hard takes 153 rounds to medium's 115 head to head, and both bury easy better than two to one." Why levels were added: **reason not recorded**.
* **Sep 22, 2026, `5f89046`, `b404fbc`, `303713c`, `ce353ef`.** Each tier gets distinct memory and tracks public play clues; Cambio decisions compare the bot's hand with every opponent's, easy's hunch call is removed, and every call passes the same belief check, rechecked against concurrent table changes. **Reason not recorded.** Tests: `Cambio is a comparison with the whole table` in `src/lib/game/bot-strength.test.ts`.
* **Sep 22, 2026, `4a38673`.** Bot turns slowed to a human pace, with hard still reacting fastest. Prompted by: every decision "waited too short a beat before firing", and two bots could act within the same second.
* **Oct 4, 2026, `eb8d564`.** Difficulty became a share of strategic play: 50% for easy, 75% for medium, 100% for hard. **Reason not recorded.** Tests in `src/lib/game/bot-difficulty.test.ts`.
* **Oct 4, 2026, `1272bc5`.** Every bot strategy receives a separate observation holding only its own seat's knowledge (`bot-observation.ts`). **Reason not recorded.** Tests in `src/lib/game/bot-observation.test.ts`, such as `gets only its two opening faces, no deck order, credentials, or shared bot memory`. The earlier fairness tests, `hidden ranks cannot influence bot decisions`, came with `b404fbc`.
* **Oct 15, 2026, `2630466`.** The bot evaluation measured the levels and the call gate (see [the bot evaluation](experiments/bot-evaluation.md)). Prompted by: its results. Calls by the shipped bots won 54.0% against a 64% gate, so the bot doc no longer calls the Cambio rule "cautious".

## Interface

### Where notifications appear

* **Sep 18, 2026, `269d7bf`.** Stick results shown as toasts. **Reason not recorded.**
* **Sep 18, 2026, `801fd57`.** Timed reveals sit between the hands and the actions. **Reason not recorded.**
* **Sep 20, 2026, `d62b9fa`.** The table narrates itself: one announcement at a time in the middle of the table, naming the move, who made it and whose card it touched. A look or a swap gets a line; Cambio, a swap during the final turns, a player out of cards, or the table going dark take the same space at four times the size. Prompted by: "Playtesters could follow their own moves and nobody else's."
* **Sep 22, 2026, `ee9eb21`.** The second shuffle and deal notification removed. **Reason not recorded.**
* **Sep 24, 2026, `63c1641` and `4a7e4cb`.** Table, account and social notifications unified in one shared dark stack with responsive placement. **Reason not recorded.**
* **Sep 24, 2026, `f436506` and `db51c38`.** Centered table notifications restored, then the original notification styling and natural page scrolling restored. **Reason not recorded.** `docs/visual-reference.md` now says to use the original Cambio treatments and that the compact toast cards and category icons were removed.
* **Oct 14, 2026, `afff235`.** The glowing dot beside loud table log entries dropped. **Reason not recorded.**

### Home page table forms

* **Sep 22, 2026, `945f643`.** The create and join table forms were restored to a stacked layout. **Reason not recorded.**
* **Oct 14, 2026, `2e7803f`.** The hero redesign put the guest create and join forms side by side. **Reason not recorded.** A browser spec still asserted the stacked order and was updated to accept either in `a8e891d`.
