# Front End

How the table animates and narrates every move. Back to the [README](../README.md).

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

The look is deliberately spare: a black background by default, white cards, one mint accent for the numbers that matter, and Plus Jakarta Sans for headlines. A warm paper light theme is also available. It can be chosen from the header's sun and moon switch, and with no saved choice it follows the system's color scheme. The choice is stored in the browser, and the theme is applied before first paint.

First time players get a short walkthrough. **How to play** then opens a desktop rules reference, with the option to replay the walkthrough at the bottom.

