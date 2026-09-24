"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { avatarIndex } from "@/lib/avatars";
import { loginHref } from "@/lib/account/navigation";
import { displayNameValue } from "@/lib/account/validation";
import { storeGuestIdentity, useGuestIdentity, type GuestIdentity } from "@/lib/client/guest";
import { useModalFocus } from "@/lib/client/useModalFocus";
import type { PlayerPublic, PublicView } from "@/lib/game/types";
import { Avatar } from "./Avatar";
import { AvatarPicker } from "./AvatarPicker";
import { GuestTableStats } from "./GuestTableStats";
import { HeaderButton } from "./Header";
import { Notification } from "./Notification";
import { Button, Chip, Field, inputClass } from "./ui";

/** The same guest identity controls on the home page and a shared table link. */
export function GuestSetup({ name, onNameChange, disabled = false, next = "/" }: {
  name: string;
  onNameChange: (name: string) => void;
  disabled?: boolean;
  next?: string;
}) {
  const guest = useGuestIdentity();
  const [editing, setEditing] = useState(false);
  const avatarId = avatarIndex(name || "Guest", guest?.avatarId);
  return <div className="min-w-0 space-y-2.5">
    <div className="grid grid-cols-[44px_minmax(0,1fr)] items-end gap-3">
      <button type="button" disabled={disabled} onClick={() => setEditing(true)} aria-label="Customize guest player" title="Customize your guest player" className="flex size-11 items-center justify-center rounded-xl bg-surface-2 ring-1 ring-line-strong transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent disabled:opacity-40">
        <Avatar identity={name || "Guest"} avatarId={avatarId} size={40} />
      </button>
      <Field label="Display name"><input className={inputClass} value={name} onChange={(event) => {
        const nextName = event.target.value;
        storeGuestIdentity({ name: nextName, avatarId: guest?.avatarId ?? null });
        onNameChange(nextName);
      }} placeholder="Your name at the table" maxLength={18} autoComplete="nickname" required disabled={disabled} /></Field>
    </div>
    <button type="button" disabled={disabled} onClick={() => setEditing(true)} className="t-footnote font-medium text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent disabled:opacity-40">Customize your avatar</button>
    {editing ? <GuestPlayerDialog initial={{ name, avatarId }} next={next} onClose={() => setEditing(false)} onApply={async (value) => { storeGuestIdentity(value); onNameChange(value.name); }} /> : null}
  </div>;
}

export function GuestPlayerButton({ player, busy, onOpen, buttonRef }: {
  player: PlayerPublic;
  busy: boolean;
  onOpen: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <HeaderButton ref={buttonRef} disabled={busy} onClick={onOpen} aria-label="Your guest player">
      <Avatar identity={player.name} avatarId={player.avatarId} size={24} />Your player
    </HeaderButton>
  );
}

export function GuestPlayerDialog({ initial, next, view, playerId, onClose, onApply, returnFocusRef }: {
  initial: GuestIdentity;
  next: string;
  view?: PublicView;
  playerId?: string;
  onClose: () => void;
  onApply: (value: GuestIdentity) => Promise<void>;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useModalFocus(true, returnFocusRef);
  const [name, setName] = useState(initial.name);
  const [avatarId, setAvatarId] = useState(avatarIndex(initial.name || "Guest", initial.avatarId));
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !working.current) onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (working.current) return;
    setError(null);
    try {
      const clean = displayNameValue(name);
      working.current = true;
      setBusy(true);
      await onApply({ name: clean, avatarId });
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update your player. Try again.");
    } finally { working.current = false; setBusy(false); }
  };
  return createPortal(
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal aria-labelledby="guest-player-title" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 outline-none animate-fade">
      <div className="max-h-[calc(100dvh-32px)] w-full max-w-[640px] overflow-y-auto overscroll-contain rounded-panel bg-surface p-5 shadow-float hairline sm:p-8">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar identity={name || "Guest"} avatarId={avatarId} size={64} />
          <div className="min-w-0"><h2 id="guest-player-title" className="t-title2">Your guest player</h2><div className="mt-2"><Chip>Guest</Chip></div></div>
        </div>
        <p className="t-sub mt-4 text-ink-2">Make yourself at home. Your look is temporary, and your results stay at this table.</p>
        <form className="mt-5 flex min-w-0 flex-col gap-5" aria-label="Guest player settings" onSubmit={(event) => void submit(event)}>
          <Field label="Display name"><input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} autoComplete="nickname" maxLength={18} required disabled={busy} /></Field>
          <AvatarPicker identity={name || "Guest"} value={avatarId} onChange={setAvatarId} disabled={busy} />
          {error ? <Notification title="Your player" tone="bad" onDismiss={() => setError(null)}>{error}</Notification> : null}
          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-5">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>{busy ? "Applying" : "Apply changes"}</Button>
          </div>
        </form>
        {view && playerId ? <div className="mt-6"><GuestTableStats view={view} playerId={playerId} /></div> : null}
        <p className="t-sub mt-6 text-ink-2"><Link href={loginHref(next, "register")} onClick={(event) => {
          if (busy) { event.preventDefault(); return; }
          try { storeGuestIdentity({ name: displayNameValue(name), avatarId }); }
          catch (error) { event.preventDefault(); setError(error instanceof Error ? error.message : "Enter your display name."); }
        }} className="font-medium text-ink hover:text-ink-2">Create an account</Link> to keep your avatar, add friends, and track future rounds.</p>
      </div>
    </div>, document.body,
  );
}
