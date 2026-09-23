"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type { SocialHook } from "@/lib/client/social";
import { saveSession } from "@/lib/client/session";
import type { Friend } from "@/lib/social/types";
import { RankBadge } from "./RankBadge";
import { Button, PresenceDot, inputClass, presenceOf } from "./ui";

/**
 * Friends, the requests either way, and what each of them is doing right now.
 *
 * A friend's presence is an opportunity to ask, not permission to take a seat.
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
  const [username, setUsername] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const wanted = username.trim().replace(/^@/, "").toLowerCase();
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
      setUsername("");
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
    <section id="friends" className="flex flex-col gap-5 rounded-panel bg-surface p-6 hairline" aria-label="Friends">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="t-headline">Friends</h2>
        <span className="t-footnote text-ink-3">{friends.length} saved</span>
      </header>

      <Link href="/leaderboard?scope=friends" className="t-sub text-ink-2 hover:text-ink">Friends leaderboard</Link>

      <form onSubmit={add} className="flex gap-2">
        <input
          className={`${inputClass} h-10`}
          name="username"
          aria-label="Add a friend by username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Add by username"
          maxLength={19}
          spellCheck={false}
          autoCapitalize="none"
        />
        <Button type="submit" variant="secondary" disabled={busy || !username.trim()}>Add</Button>
      </form>
      {note ? <p className="t-footnote text-ink-2">{note}</p> : null}

      {incoming.length ? (
        <div>
          <p className="t-caption mb-2 text-ink-3">Asked to be friends</p>
          <ul className="flex flex-col gap-2">
            {incoming.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-[16px] bg-surface-2 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="t-sub flex min-w-0 items-center gap-1.5 font-medium">{p.displayName}</p>
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
          No friends yet. Share your username, or add someone you have played against.
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
                  <p className="t-sub flex min-w-0 items-center gap-1.5 font-medium">{o.displayName}</p>
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

/** A local timer enables resending without waiting for the next social poll. */
function useResendCooldown(at?: string) {
  const [now, setNow] = useState(() => Date.now());
  const remaining = at ? Math.max(0, Math.ceil((Date.parse(at) + 60_000 - now) / 1000)) : 0;
  useEffect(() => {
    if (!at) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [at]);
  return remaining;
}

function FriendRow({ friend, social, inviteCode, atThisTable = false }: { friend: Friend; social: SocialHook; inviteCode: string | null; atThisTable?: boolean }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = friend.playing;
  const here = friend.online && (atThisTable || !!live?.together);
  const sent = social.social.sent.find((s) => s.toId === friend.id && s.code === inviteCode);
  const cooldown = useResendCooldown(sent?.at);
  // You can only ask someone who is free to be asked: not already at this
  // table, not sitting at another one.
  const invitable = !!inviteCode && !live && !here;

  const invite = async () => {
    if (!inviteCode) return;
    setBusy(true);
    setNote(null);
    const outcome = await social.invite(friend.id, inviteCode);
    setNote(outcome.ok ? null : outcome.message);
    setBusy(false);
  };

  return (
    <li className="rounded-[16px] bg-surface-2 px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="t-sub flex min-w-0 items-center gap-1.5 font-medium">
            <Link href={`/p/${friend.handle}`} className="min-w-0 truncate hover:text-accent">{friend.displayName}</Link><RankBadge points={friend.points} size={16} />
          </p>
          <p className="t-footnote flex items-center gap-1.5 text-ink-3">
            <PresenceDot state={here ? "playing" : presenceOf(friend)} />
            {live?.doNotDisturb
              ? <>Do not disturb</>
              : here
              ? <>At this table with you</>
              : live
                ? live.openSeats > 0
                  ? <>At a table · seat open</>
                  : <>{live.phase === "lobby" ? "Table full" : "Playing a round"}</>
                : friend.online
                  ? <>Online</>
                  : <>Offline</>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {live && !here ? <AskToJoin friend={friend} social={social} /> : null}
          {invitable ? (
            <div className="flex flex-col items-end gap-1">
              <Button size="sm" variant="secondary" disabled={busy || cooldown > 0} onClick={invite}>
                {busy ? "Inviting" : cooldown > 0 ? "Invited" : sent ? "Invite again" : "Invite"}
              </Button>
              {cooldown > 0 ? <span className="t-footnote text-ink-3">Again in {cooldown}s</span> : null}
            </div>
          ) : null}
        </div>
      </div>
      {note ? <p className="t-footnote mt-1.5 text-ink-2">{note}</p> : null}
    </li>
  );
}

/** The same request action on a friend's row and their public profile. */
export function AskToJoin({ friend, social }: { friend: Friend; social: SocialHook }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = friend.playing;
  const request = social.social.sentJoinRequests.find((r) => r.toId === friend.id && r.tableId === live?.tableId);
  const cooldown = useResendCooldown(request?.at);
  if (!live || live.together || live.doNotDisturb || live.openSeats === 0) return null;
  const invited = social.social.invites.some((i) => i.tableId === live.tableId);
  const ask = async () => {
    setBusy(true);
    setError(null);
    const outcome = await social.askToJoin(friend.id, live.tableId);
    if (!outcome.ok) setError(outcome.message);
    setBusy(false);
  };
  return <div className="flex max-w-[200px] flex-col items-end gap-1.5">
    <Button size="sm" variant="secondary" disabled={busy || cooldown > 0 || invited} onClick={() => void ask()}>
      {invited ? "Invited" : busy ? "Asking" : cooldown > 0 ? "Request sent" : request ? "Ask again" : "Ask to join"}
    </Button>
    {!invited && cooldown > 0 ? <span className="t-footnote text-ink-3">Again in {cooldown}s</span> : null}
    {request?.status === "declined" ? <p className="t-footnote text-ink-3">Request declined</p> : null}
    {error ? <p role="alert" className="t-footnote text-red">{error}</p> : null}
  </div>;
}

/** Invitations and requests need a decision; passive activity stays in Friends. */
export function Notifications({ social, atCode = null, acceptsJoinRequests = true }: { social: SocialHook; atCode?: string | null; acceptsJoinRequests?: boolean }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [trouble, setTrouble] = useState<Record<string, string>>({});
  const [answering, setAnswering] = useState<string | null>(null);
  // Nothing to say about the table you are already looking at.
  const invites = social.social.invites.filter((i) => !dismissed.includes(i.id) && i.code !== atCode);
  const requests = acceptsJoinRequests ? social.social.joinRequests : [];
  if (!invites.length && !requests.length) return null;

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

  const answerRequest = async (requestId: string, accept: boolean) => {
    setAnswering(requestId);
    const outcome = await social.answerJoinRequest(requestId, accept);
    setAnswering(null);
    if (!outcome.ok) setTrouble((t) => ({ ...t, [requestId]: outcome.message }));
  };

  const declineInvite = async (inviteId: string) => {
    setAnswering(inviteId);
    const answer = await social.answerInvite(inviteId, false);
    setAnswering(null);
    if (answer.ok) setDismissed((d) => [...d, inviteId]);
    else setTrouble((t) => ({ ...t, [inviteId]: answer.message }));
  };

  return (
    <div className="fixed bottom-6 right-6 z-40 flex max-h-[70vh] w-[290px] max-w-[calc(100vw-3rem)] flex-col gap-2 overflow-y-auto" aria-label="Table invitations and requests">
      {requests.map((request) => (
        <div key={request.id} role="region" aria-label={`Join request from ${request.from.displayName}`} className="animate-rise rounded-[18px] bg-surface-2 p-3.5 shadow-float hairline-strong">
          <p className="t-sub"><span className="font-semibold">{request.from.displayName}</span> asked to join your table.</p>
          {trouble[request.id] ? <p role="alert" className="t-footnote mt-1.5 text-red">{trouble[request.id]}</p> : null}
          <div className="mt-2.5 flex gap-1.5">
            <Button size="sm" variant="accent" disabled={answering !== null} onClick={() => void answerRequest(request.id, true)}>Accept</Button>
            <Button size="sm" variant="ghost" disabled={answering !== null} onClick={() => void answerRequest(request.id, false)}>Decline</Button>
          </div>
        </div>
      ))}
      {invites.map((invite) => (
        <div key={invite.id} role="region" aria-label={`Table invitation from ${invite.from.displayName}`} className="animate-rise rounded-[18px] bg-surface-2 p-3.5 shadow-float hairline-strong">
          <p className="t-sub">
            <span className="font-semibold">{invite.from.displayName}</span>{invite.requested ? " accepted your request to join table " : " invited you to table "}
            <span className="tnum font-semibold tracking-[0.06em]">{invite.code}</span>.
          </p>
          {trouble[invite.id] ? <p role="alert" className="t-footnote mt-1.5 text-red">{trouble[invite.id]}</p> : null}
          <div className="mt-2.5 flex gap-1.5">
            <Button size="sm" variant="accent" disabled={answering !== null} onClick={() => void accept(invite.id)}>
              {answering === invite.id ? "Taking a seat" : "Join"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={answering !== null}
              onClick={() => void declineInvite(invite.id)}
            >
              No thanks
            </Button>
          </div>
        </div>
      ))}

    </div>
  );
}
