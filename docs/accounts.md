# Profiles and Friends

Accounts, guests, presence, friends, and the permanent record. Back to the [README](../README.md).

Accounts use a unique username and password, separate from the display name shown to other players. The same username is used for login, friend lookup, and public profile links. Changing it updates all three together and preserves existing friends and stats. Guests can still play without creating an account.

Guest play includes the full avatar and skin tone picker, a temporary display name, bot difficulty choices, host controls, and the same round flow as account play. A new visitor can open a table immediately as Guest. The player editor is available before joining, during play, and from the pause dialog; edits update the existing seat without changing its cards or timers. Guest hosts can also control join requests. Appearance preferences use tab scoped session storage, while existing seat credentials still allow a table to be resumed. No guest account or permanent ranked record is created.

The guest player editor shows actual completed round stats for that seat at the current table: rounds, wins, best hand, sticks, and Cambio calls and wins. These are table results, not saved profile progress. Creating an account carries over the chosen name and avatar and claims the same seat; subsequent rounds contribute to the account's permanent record, standings, and social features.

Passwords use salted scrypt hashes. Random session tokens live in HttpOnly cookies with SameSite protection and a 30 day lifetime; only their hashes are stored in the database. Login and sensitive changes have persistent request limits. Clearing browser storage does not delete an account: logging in restores its profile ID, stats, friends, and existing seats.

Presence tracks each open browser document across the site. Closing or leaving sends an identity bound offline beacon; other open tabs keep the account online, and in site navigation does not briefly disconnect it. Opaque Supabase Realtime signals immediately invalidate friends' authenticated snapshots without publishing private table codes. A blocked stream falls back to polling every two seconds; slow reads are coalesced. A crash or lost connection cannot deliver a departure, so its lease expires after 75 seconds. Account creation alone never marks someone online. Apply migrations through `0013_live_presence.sql` before deploying this client. A live Supabase check confirmed online and offline invalidations in 800ms and 437ms respectively; browser regressions cover multiple tabs, page restoration, account changes, and slow connections.

The account page provides avatar, display name, username, and password changes, plus separate sign out and permanent deletion controls. The avatar editor offers six styles and a separate skin tone selector: the original default plus five shades. Both choices preview together and save across devices, profiles, friends, standings, and active tables; Cancel restores the saved appearance. Existing avatars keep their original appearance until edited. Password changes revoke other sessions. Deletion requires the current password and an explicit confirmation, removes all account and social records, and anonymizes retained game seats. Game actions check the live account session as well as any saved seat token.

Existing browser profiles can add credentials without changing their profile ID. After upgrading, the old browser key no longer grants access. A profile whose original browser key was already lost cannot be claimed by name alone.

The play screen offers a new table or joining by code, using a saved display name or a guest name. Friends sit beside the table setup panels and can be invited from the lobby. A single “Back to your table” shortcut remembers the most recently used table in this browser for 30 minutes after foreground use. Home checks that the table still has players and that the player can resume their seat or join its lobby; empty, missing, expired, and unavailable tables stay hidden. Visiting another table replaces the shortcut, and switching accounts clears it. Choosing Leave during a round hands the seat and its cards to a medium bot and releases the player's access. Simply navigating away preserves the seat for a return. Leaving the lobby or results opens the seat. The full record lives on the public profile page. Account settings contain only account details and session controls.

Login and signup share `/login`. A validated `next` destination returns players to the table, profile, or account screen they came from. A guest name and a complete table code carry into signup from table setup. Account settings preserve a link back to the originating screen. Successful sign out and deletion return to the play screen with a dismissible confirmation. How to play is available in every main website header and all table states. The first opening shows the interactive walkthrough; later openings show scrollable written rules with Show walkthrough again at the bottom. A first confirmed table seat introduces the walkthrough automatically if it has not already been seen in that browser.

Creating an account after joining as a guest attaches the account to that existing seat using its saved credential. The player's seat, hand, and host status stay intact, including mid round and while paused. Avatar edits update that same seat. Rejoining with a saved guest credential also resumes the seat instead of adding another player.

Friends at another table can receive and accept invitations, including during a round or with Do not disturb enabled. Accepting opens the invited table without cancelling the previous round. The destination must still have an open seat in its lobby; invitations to someone already seated there remain unavailable.

The friends list puts people at your table first, other online friends next, and offline friends last. Each group sorts from highest badge rank to lowest, using points to order friends within the same tier. Table seating takes precedence over delayed presence. Player cards in the lobby and during play show each account's tier and whether you are friends, with Add friend, Request sent, or Accept friend controls as appropriate. Guest seats and house bots have no account tier or friend request controls.

| Piece | What it does |
| --- | --- |
| **The record** | Every scored round is written into each seated profile: rounds played and won, total and best hand, tables, Cambio calls and the ones that stuck, sticks landed and missed, current and best streak. |
| **Rank** | Points are a stored column, so the ladder is ordered in the database: a round won is worth four times a round played, and a Cambio you called and won is worth more again. Seven tiers run from Rookie to Cambio Master, with your standing among every saved player beside them. |
| **Friends** | One row per relationship, pending until it is accepted. Asking someone who has already asked you accepts it instead of opening a second request. |
| **Opponents** | Every round records who was across the table, so the friends list knows the head to head and can suggest the people you have already played. |
| **Invites** | A code handed to one friend, from the table you are sitting at. The server checks you are actually seated there before it sends one. |
| **Presence** | Your client says which table it is at; the server reads the phase and the open seats from the table itself, so "one seat open" is never a guess. A light goes out two minutes after a tab closes. |

Every one of these goes through a `SECURITY DEFINER` RPC gated by the server secret. The anon key can no more read a profile than it can read a hand of cards.

