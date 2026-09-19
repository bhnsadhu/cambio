"use client";

import type { PlayerPublic, PublicView } from "@/lib/game/types";
import { Button, Chip, Pip, PlayerName } from "./ui";

/**
 * Pausing is unanimous, so the interesting part is always the same: who has
 * agreed and who the table is waiting on. That roster is shared by the
 * banner (a request is open, play continues) and by the overlay (the table
 * is actually dark), so both read as one feature.
 */

export interface PauseProps {
  view: PublicView;
  me: string | null;
  busy: boolean;
  onRequest: () => void;
  onVote: (agree: boolean) => void;
}

function split(view: PublicView): { agreed: PlayerPublic[]; waiting: PlayerPublic[] } {
  const ids = new Set(view.pauseVote?.agreed ?? []);
  return {
    agreed: view.players.filter((p) => ids.has(p.id)),
    waiting: view.players.filter((p) => !ids.has(p.id)),
  };
}

function Roster({ view }: { view: PublicView }) {
  const { agreed, waiting } = split(view);
  return (
    <div className="flex flex-col gap-1.5">
      <Row label="Agreed">
        {agreed.map((p) => (
          <Chip key={p.id} tone="accent"><PlayerName name={p.name} isBot={p.isBot} /></Chip>
        ))}
      </Row>
      <Row label="Waiting on">
        {waiting.map((p) => (
          <Chip key={p.id} tone="muted"><Pip /><PlayerName name={p.name} isBot={p.isBot} /></Chip>
        ))}
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="t-caption mt-1.5 w-[86px] shrink-0 text-ink-3">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** The viewer's side of an open request. */
function Answer({ view, me, busy, onVote, size = "sm" }: Omit<PauseProps, "onRequest"> & { size?: "sm" | "md" }) {
  const vote = view.pauseVote!;
  const seated = !!me && view.players.some((p) => p.id === me);
  if (!seated) return <p className="t-sub text-ink-3">Watching. The table decides this one.</p>;
  const answered = vote.agreed.includes(me!);
  const waiting = view.players.filter((p) => !vote.agreed.includes(p.id)).length;
  if (!answered) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="accent" size={size} disabled={busy} onClick={() => onVote(true)}>Agree</Button>
        <Button variant="ghost" size={size} disabled={busy} onClick={() => onVote(false)}>Decline</Button>
      </div>
    );
  }
  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <p className="t-sub text-ink-2">You agreed. Waiting on {waiting}.</p>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => onVote(false)}>
        {vote.byId === me ? "Cancel the request" : "Change to decline"}
      </Button>
    </div>
  );
}

/**
 * A request is open and play carries on around it, so this sits in the middle
 * of the table with the timed reveals rather than covering a hand.
 */
export function PauseBanner({ view, me, busy, onVote }: Omit<PauseProps, "onRequest">) {
  const vote = view.pauseVote;
  // Once the table is dark the overlay owns the ask; two copies of it is one too many.
  if (!vote || view.paused) return null;
  const by = view.players.find((p) => p.id === vote.byId);
  const name = by ? <PlayerName name={by.name} isBot={by.isBot} /> : "Someone";
  const mine = vote.byId === me;
  return (
    <div className="flex w-full justify-center px-6">
      <div className="flex max-w-[760px] animate-rise items-center gap-6 rounded-panel bg-surface-2 px-5 py-4 shadow-float">
        <div className="min-w-[196px] max-w-[240px]">
          <p className="t-caption text-ink-3">{vote.kind === "pause" ? "Pause requested" : "Resume requested"}</p>
          <p className="t-callout mt-1 text-ink-2">
            {mine ? <>You asked to {vote.kind} the table.</> : <>{name} asked to {vote.kind} the table.</>}{" "}
            <span className="text-ink">Everyone has to agree.</span>
          </p>
          <p className="t-footnote mt-1 text-ink-3">
            {vote.kind === "pause" ? "Play carries on until they do." : "The table stays paused until they do."}
          </p>
        </div>
        <Roster view={view} />
        <div className="ml-auto"><Answer view={view} me={me} busy={busy} onVote={onVote} /></div>
      </div>
    </div>
  );
}

/** The table is dark. Nothing underneath is playable, so this takes the screen. */
export function PauseOverlay({ view, me, busy, onRequest, onVote }: PauseProps) {
  if (!view.paused) return null;
  const by = view.players.find((p) => p.id === view.pausedBy);
  const vote = view.pauseVote;
  const seated = !!me && view.players.some((p) => p.id === me);
  const held = view.turnDeadline !== null && view.pausedAt !== null
    ? Math.max(0, Math.ceil((view.turnDeadline - view.pausedAt) / 1000))
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6 animate-fade">
      <div className="w-full max-w-[560px] animate-rise rounded-panel bg-surface p-8 shadow-float hairline">
        <p className="t-caption text-ink-3">Table paused</p>
        <h2 className="t-title mt-1.5">The game is on hold.</h2>
        <p className="t-callout mt-1.5 text-ink-2">
          {by ? <><PlayerName name={by.name} isBot={by.isBot} /> asked, and the table agreed. </> : null}
          No draws, swaps, sticks or powers until everyone agrees to carry on.
          {held !== null ? <> The turn clock is stopped at <span className="tnum font-medium text-ink">{held}s</span> and picks up from there.</> : null}
        </p>

        {vote ? (
          <div className="mt-7 flex flex-col gap-5 rounded-card bg-surface-2 p-5">
            <div>
              <p className="t-caption text-ink-3">Resume requested</p>
              <p className="t-callout mt-1 text-ink-2">
                {vote.byId === me ? "You asked to carry on." : <>{(() => { const p = view.players.find((x) => x.id === vote.byId); return p ? <PlayerName name={p.name} isBot={p.isBot} /> : "Someone"; })()} asked to carry on.</>}{" "}
                <span className="text-ink">Everyone has to agree.</span>
              </p>
            </div>
            <Roster view={view} />
            <div className="flex justify-end"><Answer view={view} me={me} busy={busy} onVote={onVote} size="md" /></div>
          </div>
        ) : (
          <div className="mt-7 flex items-center justify-between gap-6">
            <p className="t-sub max-w-[280px] text-ink-3">
              {seated ? "Anyone can ask to resume. Everyone has to agree, and the house bots agree straight away." : "Watching. The table decides when to carry on."}
            </p>
            {seated ? (
              <Button variant="primary" size="lg" disabled={busy} onClick={onRequest}>Ask to resume</Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** The header control. Absent whenever the banner or the overlay owns the ask. */
export function PauseButton({ view, me, busy, onRequest }: Omit<PauseProps, "onVote">) {
  const pausable = view.phase === "peek" || view.phase === "playing" || view.phase === "final";
  const seated = !!me && view.players.some((p) => p.id === me);
  if (!pausable || !seated || view.paused || view.pauseVote) return null;
  return <Button variant="ghost" size="sm" disabled={busy} onClick={onRequest}>Pause</Button>;
}
