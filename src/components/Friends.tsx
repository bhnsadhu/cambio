"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { SocialHook } from "@/lib/client/social";
import { saveSession } from "@/lib/client/session";
import type { Friend } from "@/lib/social/types";
import { Button, Pip, PresenceDot, inputClass, presenceOf } from "./ui";

/**
 * Friends, the requests either way, and what each of them is doing right now.
 *
 * A friend who is at a table shows it, and if that table still has a seat the
 * button says so — the whole point of knowing who is playing is being able to
 * sit down with them.
 */
export function FriendsPanel({
  social,
  inviteCode = null,
  seated = [],
}: {
  social: SocialHook;
  inviteCode?: string | null;
  /** profile ids actually sitting at `inviteCode`, straight from the table */
  seated?: string[];
}) {
  // `inviteCode` doubles as "the table I am at": a friend already sitting at
  // it is not somewhere to go, and is not worth inviting either. The seating
  // comes from the table itself rather than from their heartbeat, which can
  // lapse while they are still very much in the chair.
  const [handle, setHandle] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const wanted = handle.trim().replace(/^@/, "");
    if (!wanted) return;
    setBusy(true);
    setNote(null);
    try {
      const outcome = await social.addFriend(wanted);
      setNote(
        outcome === "sent" ? `Request sent to @${wanted}.`
        : outcome === "accepted" ? `You and @${wanted} are friends now.`
        : outcome === "friends" ? `You are already friends with @${wanted}.`
        : `@${wanted} has already been asked.`,
      );
      setHandle("");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not send that request.");
    } finally {
      setBusy(false);
    }
  };

  const { friends, incoming, outgoing, opponents } = social.social;
  const strangers = opponents.filter(
    (o) => !friends.some((f) => f.id === o.id) && !outgoing.some((f) => f.id === o.id) && !incoming.some((f) => f.id === o.id),
  );

  return (
    <section className="flex flex-col gap-5 rounded-panel bg-surface p-6 hairline" aria-label="friends">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="t-headline">Friends</h2>
        <span className="t-footnote text-ink-3">{friends.length} saved</span>
      </header>

      <form onSubmit={add} className="flex gap-2">
        <input
          className={`${inputClass} h-10`}
          name="handle"
          aria-label="Add a friend by handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="Add by @handle"
          maxLength={20}
          spellCheck={false}
          autoCapitalize="none"
        />
        <Button type="submit" variant="secondary" disabled={busy || !handle.trim()}>Add</Button>
      </form>
      {note ? <p className="t-footnote text-ink-2">{note}</p> : null}

      {incoming.length ? (
        <div>
          <p className="t-caption mb-2 text-ink-3">Asked to be friends</p>
          <ul className="flex flex-col gap-2">
            {incoming.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-[16px] bg-surface-2 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="t-sub truncate font-medium">{p.displayName}</p>
                  <p className="t-footnote text-ink-3">@{p.handle}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="accent" onClick={() => void social.respond(p.id, true)}>Accept</Button>
                  <Button size="sm" variant="ghost" onClick={() => void social.respond(p.id, false)}>Decline</Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {friends.length ? (
        <ul className="flex flex-col gap-2">
          {friends.map((f) => (
            <FriendRow key={f.id} friend={f} social={social} inviteCode={inviteCode} atThisTable={seated.includes(f.id)} />
          ))}
        </ul>
      ) : (
        <p className="t-sub text-ink-3">
          No friends yet. Share your @handle, or add someone you have played against.
        </p>
      )}

      {outgoing.length ? (
        <p className="t-footnote text-ink-3">
          Waiting on {outgoing.map((p) => `@${p.handle}`).join(", ")}.
        </p>
      ) : null}

      {strangers.length ? (
        <div>
          <p className="t-caption mb-2 text-ink-3">Played against</p>
          <ul className="flex flex-col gap-2">
            {strangers.slice(0, 5).map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 rounded-[16px] bg-surface-2 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="t-sub truncate font-medium">{o.displayName}</p>
                  <p className="t-footnote text-ink-3">{o.rounds} {o.rounds === 1 ? "round" : "rounds"} together</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => void social.addFriend(o.handle)}>Add</Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function FriendRow({ friend, social, inviteCode, atThisTable = false }: { friend: Friend; social: SocialHook; inviteCode: string | null; atThisTable?: boolean }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = friend.playing;
  const here = atThisTable || (!!live && !!inviteCode && live.code === inviteCode);
  const canJoin = !!live && !here && live.openSeats > 0;
  const asked = social.social.sent.some((s) => s.toId === friend.id && s.code === inviteCode);
  // You can only ask someone who is free to be asked: not already at this
  // table, not sitting at another one.
  const invitable = !!inviteCode && !live && !here;

  const invite = async () => {
    if (!inviteCode) return;
    setBusy(true);
    setNote(null);
    const outcome = await social.invite(friend.id, inviteCode);
    setNote(outcome.ok ? `Asked ${friend.displayName}.` : outcome.message);
    setBusy(false);
  };

  return (
    <li className="rounded-[16px] bg-surface-2 px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="t-sub truncate font-medium">
            <Link href={`/p/${friend.handle}`} className="hover:text-accent">{friend.displayName}</Link>
          </p>
          <p className="t-footnote flex items-center gap-1.5 text-ink-3">
            <PresenceDot state={here ? "playing" : presenceOf(friend)} />
            {here
              ? <>At this table with you</>
              : live
                ? canJoin
                  ? <>At table {live.code} · seat open</>
                  : <>At table {live.code} · {live.phase === "lobby" ? "filling up" : "mid round"}</>
                : friend.online
                  ? <>Online</>
                  : friend.playedTogether > 0
                    ? <>{friend.yourWins}&ndash;{friend.theirWins} across {friend.playedTogether} {friend.playedTogether === 1 ? "round" : "rounds"}</>
                    : <>@{friend.handle}</>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {canJoin ? (
            <Link href={`/g/${live!.code}`}><Button size="sm" variant="accent">Join</Button></Link>
          ) : live && !here ? (
            <Link href={`/g/${live.code}`}><Button size="sm" variant="ghost">Watch</Button></Link>
          ) : null}
          {invitable ? (
            <Button size="sm" variant={asked ? "ghost" : "secondary"} disabled={busy || asked} onClick={invite}>
              {asked ? "Asked" : busy ? "Asking" : "Invite"}
            </Button>
          ) : null}
        </div>
      </div>
      {note ? <p className="t-footnote mt-1.5 text-ink-2">{note}</p> : null}
    </li>
  );
}

/**
 * The corner of the screen that knows things: a friend has asked you to a
 * table, or a friend is playing one with a seat still open. Quiet when there
 * is nothing to say.
 */
export function Notifications({ social, atCode = null }: { social: SocialHook; atCode?: string | null }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [trouble, setTrouble] = useState<Record<string, string>>({});
  const [answering, setAnswering] = useState<string | null>(null);
  // Nothing to say about the table you are already looking at.
  const invites = social.social.invites.filter((i) => !dismissed.includes(i.id) && i.code !== atCode);
  const live = social.social.friends.filter(
    (f) => f.playing && f.playing.code !== atCode && !dismissed.includes(`live:${f.playing.code}:${f.id}`),
  );
  if (!invites.length && !live.length) return null;

  /**
   * Accepting takes the seat on the server and comes back with it, so the
   * friend who said yes arrives already sitting down rather than at a join
   * form where the seat may be gone. A refusal says which of the ways it
   * could go wrong actually did.
   */
  const accept = async (inviteId: string) => {
    setAnswering(inviteId);
    const answer = await social.answerInvite(inviteId, true);
    setAnswering(null);
    if (!answer.ok) {
      setTrouble((t) => ({ ...t, [inviteId]: answer.message }));
      return;
    }
    if (answer.seat) saveSession(answer.code, answer.seat);
    router.push(`/g/${answer.code}`);
  };

  return (
    <div className="fixed bottom-6 right-6 z-40 flex w-[290px] flex-col gap-2">
      {invites.map((invite) => (
        <div key={invite.id} className="animate-rise rounded-[18px] bg-surface-2 p-3.5 shadow-float hairline-strong">
          <p className="t-sub">
            <span className="font-semibold">{invite.from.displayName}</span> asked you to table{" "}
            <span className="tnum font-semibold tracking-[0.06em]">{invite.code}</span>.
          </p>
          {trouble[invite.id] ? <p className="t-footnote mt-1.5 text-accent-ink">{trouble[invite.id]}</p> : null}
          <div className="mt-2.5 flex gap-1.5">
            <Button size="sm" variant="accent" disabled={answering === invite.id} onClick={() => void accept(invite.id)}>
              {answering === invite.id ? "Taking a seat" : "Join"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={answering === invite.id}
              onClick={() => { setDismissed((d) => [...d, invite.id]); void social.answerInvite(invite.id, false); }}
            >
              No thanks
            </Button>
          </div>
        </div>
      ))}

      {live.map((f) => (
        <div key={f.id} className="animate-rise rounded-[18px] bg-surface-2 p-3.5 shadow-float hairline">
          <p className="t-sub inline-flex items-center gap-2">
            <Pip />
            <span><span className="font-semibold">{f.displayName}</span> is at table <span className="tnum font-semibold tracking-[0.06em]">{f.playing!.code}</span>.</span>
          </p>
          <div className="mt-2.5 flex items-center gap-1.5">
            <Link href={`/g/${f.playing!.code}`}>
              <Button size="sm" variant={f.playing!.openSeats > 0 ? "accent" : "secondary"}>
                {f.playing!.openSeats > 0 ? `Take a seat (${f.playing!.openSeats} open)` : "Watch"}
              </Button>
            </Link>
            <Button size="sm" variant="ghost" onClick={() => setDismissed((d) => [...d, `live:${f.playing!.code}:${f.id}`])}>Hide</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
