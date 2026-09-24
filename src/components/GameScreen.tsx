"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAccountReady, useStoredProfile } from "@/lib/client/profile";
import { loginHref } from "@/lib/account/navigation";
import { avatarIndex } from "@/lib/avatars";
import { guestIdentity, storeGuestIdentity, useGuestIdentity } from "@/lib/client/guest";
import { useGame } from "@/lib/client/useGame";
import { api, RequestError } from "@/lib/client/api";
import { useSocial } from "@/lib/client/social";
import { forgetRecentTable, saveSession, storeName } from "@/lib/client/session";
import { useStoredName } from "@/lib/client/useStoredName";
import { useModalFocus } from "@/lib/client/useModalFocus";
import { PositionsProvider } from "@/lib/client/positions";
import { Lobby } from "./Lobby";
import { FriendsPanel, Notifications } from "./Friends";
import { AccountLink } from "./Profile";
import { Table } from "./Table";
import { HowToPlayButton } from "./HowToPlayButton";
import { FlightLayer, useFlights } from "./FlightLayer";
import { PauseButton, PauseOverlay } from "./Pause";
import { RoomSettings } from "./RoomSettings";
import { TablePlayers } from "./TablePlayers";
import { TableSocialProvider } from "./PlayerSocial";
import { GuestPlayerButton, GuestPlayerDialog, GuestSetup } from "./GuestPlayer";
import { HeaderBar, HeaderButton, HeaderLink } from "./Header";
import { Button, buttonClass, DotOff, Pip } from "./ui";
import { Notification } from "./Notification";

/**
 * Card flights are tracked here rather than inside the table so that the
 * deal of the first round has a previous view to be a movement *from*: the
 * table itself only mounts once the lobby is left, which is the same render
 * the first deal arrives in.
 */
export function GameScreen({ code }: { code: string }) {
  return (
    <PositionsProvider>
      <GameShell code={code} />
    </PositionsProvider>
  );
}

function GameShell({ code }: { code: string }) {
  const game = useGame(code);
  const social = useSocial();
  const router = useRouter();
  const view = game.view;
  // Friends can see the table you are sitting at, and whether it has a seat
  // left. Watching a table is not sitting at one, so it lights nothing up.
  const [watching, setWatching] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [guestEditorFor, setGuestEditorFor] = useState<string | null>(null);
  const guestButtonRef = useRef<HTMLButtonElement>(null);
  const leave = useCallback(async () => {
    const phase = game.view?.public.phase;
    if (game.session) {
      const result = await game.send({ type: "leaveTable" });
      if (!result) return;
      game.setSession(null);
      if (phase !== "lobby" && phase !== "scoring") forgetRecentTable(code);
    }
    router.push("/");
  }, [code, game, router]);

  const seated = !!game.session;
  const myPlayer = view?.public.players.find((player) => player.id === game.me);
  const myGuest = !social.profile && myPlayer && !myPlayer.profileId && !myPlayer.isBot && game.session?.playerId === myPlayer.id ? myPlayer : null;
  const guestId = myGuest?.id;
  const guestName = myGuest?.name;
  const guestAvatar = myGuest?.avatarId;
  useEffect(() => {
    if (!guestId || guestName === undefined) return;
    // A reopened tab still owns its saved seat, even after its temporary
    // appearance expired. Carry the actual seat through every signup route.
    const avatarId = avatarIndex(guestName, guestAvatar);
    const saved = guestIdentity();
    if (saved?.name !== guestName || saved.avatarId !== avatarId) storeGuestIdentity({ name: guestName, avatarId });
  }, [guestId, guestName, guestAvatar]);
  const guestPlayerControl = myGuest ? <GuestPlayerButton player={myGuest} busy={game.busy} buttonRef={guestButtonRef} onOpen={() => setGuestEditorFor(myGuest.id)} /> : null;
  // Who is actually in a chair here, by profile: the table's own word on it,
  // which beats a heartbeat that may have lapsed.
  const seatedProfiles = (view?.public.players ?? [])
    .map((p) => p.profileId)
    .filter((id): id is string => !!id);
  const flights = useFlights(view, game.me);
  const pause = {
    me: game.me,
    busy: game.busy,
    onRequest: () => void game.send({ type: "pauseRequest" }),
    onVote: (agree: boolean) => void game.send({ type: "pauseVote", agree }),
  };

  let body: React.ReactNode;
  if (game.status === "notfound") {
    body = <Empty title="No table with that code." body="Check the code with whoever sent it, or open a table of your own." />;
  } else if (game.status === "error" && !view) {
    body = <section className="mx-auto max-w-[420px] pt-16">
      <h1 className="t-title">Could not reach the table.</h1>
      <p className="t-body mt-2 text-ink-2">Check your connection and try again.{game.session ? " Your seat is still saved in this browser." : ""}</p>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Button onClick={() => void game.refresh()}>Try again</Button>
        <Link href="/" className="t-sub text-ink-2 hover:text-ink">Back to play</Link>
      </div>
    </section>;
  } else if (!view) {
    body = <TableSkeleton />;
  } else if (game.removed) {
    body = <Empty title="You were removed from the table." body="The host removed you. You can open a new table from the play screen." />;
  } else if (!seated && view.public.phase === "lobby") {
    body = <JoinForm code={code} onJoined={(s) => { game.setSession(s); void game.refresh(); }} />;
  } else if (!seated && !watching) {
    body = <MidRound code={code} canLogin={!social.profile} onWatch={() => setWatching(true)} />;
  } else if (view.public.phase === "lobby") {
    body = (
      <WithFriends social={social} code={code} seated={seatedProfiles}>
      <Lobby
        view={view.public}
        me={game.me}
        busy={game.busy}
        hasAccount={!!social.profile}
        onStart={() => void game.send({ type: "start" })}
        onDifficulty={(seat, difficulty) => void game.send({ type: "setBotDifficulty", seat, difficulty })}
      />
      </WithFriends>
    );
  } else {
    // The ready check happens at the dealt table, not on a screen of its own:
    // your four cards are already in front of you, face down, while the table
    // waits on the last seat to say it is in.
    body = <Table key={`table:${game.me ?? "spectator"}`} game={game} flights={flights} onLeave={() => void leave()} />;
  }

  return (
    <TableSocialProvider code={code} view={view?.public ?? null} social={social}>
      <main className="mx-auto min-h-screen w-full max-w-[1600px] px-5 sm:px-8 lg:flex lg:h-dvh lg:flex-col">
        <HeaderBar label="Table controls" className="mb-4" context={view ? (
              <div className="t-sub flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-l border-line-strong pl-4 text-ink-2">
                <span className="sr-only text-ink-3 sm:not-sr-only">Table</span>
                <span className="tnum font-semibold tracking-[0.08em] text-ink">{view.public.code}</span>
                {view.public.round > 0 ? <span className="text-ink-3">· Round {view.public.round}</span> : null}
              </div>
            ) : null} status={<span role="status" aria-label="Table connection" title={game.connection === "live" ? "Live" : game.connection === "connecting" ? "Connecting" : "Reconnecting"} className="inline-flex h-10 w-4 shrink-0 items-center gap-2 px-1 text-[11px] text-ink-3 sm:w-[108px]">
              {game.connection === "live" ? <Pip /> : <DotOff />}
              <span className="sr-only sm:not-sr-only">{game.connection === "live" ? "Live" : game.connection === "connecting" ? "Connecting" : "Reconnecting"}</span>
            </span>}>
            {social.profile ? <AccountLink from={`/g/${code}`} /> : null}
            {!view?.public.paused ? guestPlayerControl : null}
            {view && !view.public.paused && game.me === view.public.hostId ? <TablePlayers view={view.public} busy={game.busy}
              onKick={async (playerId) => !!await game.send({ type: "kickPlayer", playerId })} /> : null}
            {seated && view ? <RoomSettings view={view.public} me={game.me} busy={game.busy}
              onChange={(enabled) => { void game.send({ type: "setDoNotDisturb", enabled }).then(() => social.refresh()); }} /> : null}
            {view ? <PauseButton view={view.public} {...pause} /> : null}
            <HowToPlayButton introduce={seated && !!view && !!game.me} />
            {game.session ? (
              leaving ? (
                <HeaderButton disabled>Leaving table</HeaderButton>
              ) : (
                <HeaderButton onClick={() => setLeaving(true)}>Leave</HeaderButton>
              )
            ) : (
              <HeaderLink href="/">Home</HeaderLink>
            )}
        </HeaderBar>

        {body}

        <FlightLayer specs={flights.specs} onLanded={flights.onLanded} />
        {view && !game.removed && (seated || watching) ? <PauseOverlay view={view.public} {...pause}
          playerControl={guestPlayerControl} onLeave={() => setLeaving(true)} onKick={async (playerId) => !!await game.send({ type: "kickPlayer", playerId })} /> : null}
        {leaving && game.session ? <LeaveTableDialog
          phase={view?.public.phase ?? "lobby"}
          busy={game.busy}
          onCancel={() => setLeaving(false)}
          onLeave={() => void leave()}
        /> : null}
        {myGuest && view && guestEditorFor === myGuest.id ? <GuestPlayerDialog
          key={myGuest.id}
          initial={{ name: myGuest.name, avatarId: avatarIndex(myGuest.name, myGuest.avatarId) }}
          view={view.public}
          playerId={myGuest.id}
          next={`/g/${code}`}
          returnFocusRef={guestButtonRef}
          onClose={() => setGuestEditorFor(null)}
          onApply={async (value) => {
            const result = await game.send({ type: "setGuestIdentity", name: value.name, avatarId: value.avatarId! }, { throwOnError: true });
            if (!result) throw new Error("Could not update your guest player. Try again.");
            storeGuestIdentity(value);
            if (game.session) game.setSession({ ...game.session, name: value.name });
          }}
        /> : null}
        <Notifications social={social} atCode={code} acceptsJoinRequests={!seated || !view?.public.doNotDisturb} />
      </main>
    </TableSocialProvider>
  );
}

function LeaveTableDialog({ phase, busy, onCancel, onLeave }: { phase: string; busy: boolean; onCancel: () => void; onLeave: () => void }) {
  const ref = useModalFocus();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);
  return (
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal aria-labelledby="leave-table-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 outline-none animate-fade">
      <div className="w-full max-w-[520px] rounded-panel bg-surface p-6 shadow-float hairline sm:p-8">
        <h2 id="leave-table-title" className="t-title2">Leave this table?</h2>
        <p className="t-body mt-3 text-ink-2">
          {phase === "lobby" ? "Your seat will be opened for another player."
            : phase === "scoring" ? "The other players will return to the lobby with your seat open."
              : "A medium bot will take over your seat and exact cards. The round will continue with the bot in your place."}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" disabled={busy} onClick={onCancel}>Stay</Button>
          <Button variant="primary" disabled={busy} onClick={onLeave}>Leave</Button>
        </div>
      </div>
    </div>
  );
}

/**
 * While the table is still being set, the friends list sits beside it: a
 * friend is one click from an invite to this exact code.
 */
function WithFriends({ social, code, seated, children }: { social: ReturnType<typeof useSocial>; code: string; seated: string[]; children: React.ReactNode }) {
  if (!social.profile) return children;
  return (
    <div className="mx-auto grid w-full max-w-[1280px] gap-6 pb-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8">
      {children}
      <div className="min-w-0 lg:pt-8">
        <FriendsPanel social={social} inviteCode={code} seated={seated} />
      </div>
    </div>
  );
}

function JoinForm({ code, onJoined }: { code: string; onJoined: (s: { playerId: string; token: string; name: string }) => void }) {
  const [name, setName] = useStoredName("Guest");
  const guest = useGuestIdentity();
  const guestAvatarId = avatarIndex(name || "Guest", guest?.avatarId);
  const profile = useStoredProfile();
  const accountReady = useAccountReady();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const seat = await api.join(code, name, guestAvatarId);
      if (profile) storeName(name.trim()); else storeGuestIdentity({ name: name.trim(), avatarId: guestAvatarId });
      const s = { playerId: seat.playerId, token: seat.token, name: name.trim() };
      saveSession(code, s);
      onJoined(s);
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Could not join right now. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-[420px] pt-12 pb-8 animate-rise sm:pt-24">
      <p className="t-caption text-ink-3">Join table</p>
      <h1 className="t-title tnum mt-1.5 tracking-[0.06em]">{code}</h1>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" aria-label="Join table">
        {!accountReady ? <p role="status" className="t-sub text-ink-2">Checking your account</p>
          : profile ? <p className="t-body text-ink-2">Playing as <strong className="text-ink">{name}</strong></p>
            : <GuestSetup name={name} onNameChange={setName} disabled={busy} next={`/g/${code}`} />}
        {error ? <Notification title="Join table" tone="bad" onDismiss={() => setError(null)}>{error}</Notification> : null}
        <Button type="submit" variant="primary" size="lg" disabled={!accountReady || busy || !name.trim()}>{busy ? "Taking a seat" : "Take a seat"}</Button>
      </form>
      {accountReady && !profile ? <p className="t-sub mt-5 text-ink-2">Your guest player is temporary. <Link href={loginHref(`/g/${code}`)} onClick={() => storeGuestIdentity({ name: name.trim(), avatarId: guestAvatarId })} className="font-medium text-ink hover:text-ink-2">Log in to use your saved profile</Link></p> : null}
    </div>
  );
}

function MidRound({ code, canLogin, onWatch }: { code: string; canLogin: boolean; onWatch: () => void }) {
  return (
    <div className="mx-auto max-w-[460px] pt-12 pb-8 animate-rise sm:pt-24">
      <p className="t-caption text-ink-3">Table {code}</p>
      <h1 className="t-title mt-1.5">This table is mid round.</h1>
      <p className="t-body mt-2 text-ink-2">Seats are set once a round starts. You can watch this one, or open a table of your own.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="primary" size="lg" onClick={onWatch}>Watch</Button>
        <Link href="/" className={buttonClass({ variant: "secondary", size: "lg" })}>Open a table</Link>
      </div>
      {canLogin ? <p className="t-sub mt-5 text-ink-2">Already playing? <Link href={loginHref(`/g/${code}`)} className="font-medium text-ink hover:text-ink-2">Log in to return to your seat</Link></p> : null}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-[420px] pt-12 pb-8 animate-rise sm:pt-24">
      <h1 className="t-title">{title}</h1>
      <p className="t-body mt-2 text-ink-2">{body}</p>
      <Link href="/" className={buttonClass({ variant: "primary", className: "mt-6" })}>Back to start</Link>
    </div>
  );
}

/** The table's shape while the first state arrives, so nothing jumps. */
function TableSkeleton() {
  return (
    <div className="grid gap-4 pb-4 lg:h-[calc(100dvh-96px)] lg:grid-cols-[minmax(0,1fr)_240px]" aria-busy aria-label="Finding the table">
      <div className="flex min-h-0 flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:gap-4">
          {[0, 1, 2, 3].map((k) => (
            <div key={k} className="flex min-w-0 flex-col gap-4 rounded-panel bg-surface px-3 pt-4 pb-5 hairline xl:px-4">
              <div className="min-h-16 space-y-2">
                <div className="skeleton h-4 w-24 max-w-full rounded-md" />
                <div className="skeleton h-3 w-14 rounded-md" />
              </div>
              <div className="grid grid-cols-2 gap-2 justify-items-center xl:gap-3">
                {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[var(--tile-h)] w-[var(--tile-w)] rounded-[var(--tile-r)]" />)}
              </div>
              <div className="skeleton h-3 w-12 rounded-md" />
            </div>
          ))}
        </div>
        <div className="mt-auto flex min-h-[92px] items-center rounded-panel bg-surface px-6 hairline">
          <div className="space-y-2">
            <div className="skeleton h-4 w-40 rounded-md" />
            <div className="skeleton h-3 w-48 max-w-full rounded-md sm:w-64" />
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-col gap-4">
        <div className="flex flex-col gap-4 rounded-panel bg-surface px-4 pt-4 pb-5 hairline">
          <div className="skeleton h-4 w-14 rounded-md" />
          <div className="flex justify-center gap-5">
            <div className="skeleton h-[var(--tile-h)] w-[var(--tile-w)] rounded-[var(--tile-r)]" />
            <div className="skeleton h-[var(--tile-h)] w-[var(--tile-w)] rounded-[var(--tile-r)]" />
          </div>
        </div>
        <div className="flex-1 rounded-panel bg-surface px-5 pt-4 pb-5 hairline">
          <div className="skeleton h-4 w-20 rounded-md" />
          <p className="t-sub mt-4 inline-flex items-center gap-2 text-ink-3"><Pip />Finding the table</p>
        </div>
      </div>
    </div>
  );
}
