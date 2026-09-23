"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { authenticate, deleteAccount, signOut, updateAccount, type StoredProfile } from "@/lib/client/profile";
import { AVATAR_OPTIONS, avatarIndex } from "@/lib/avatars";
import { Avatar } from "./Avatar";
import { Button, Field, inputClass } from "./ui";

type Mode = "login" | "register";
const errorText = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Try again.";

export function AuthForm({ initialMode = "login", initialName = "", legacy = false }: { initialMode?: Mode; initialName?: string; legacy?: boolean }) {
  const [mode, setMode] = useState<Mode>(legacy ? "register" : initialMode);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = displayName ?? initialName;
  const registering = mode === "register";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (registering && password !== confirm) { setError("Your passwords do not match."); return; }
    setBusy(true);
    try {
      await authenticate(mode, { username, password, ...(registering ? { displayName: name } : {}) });
      setPassword(""); setConfirm("");
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  };
  return (
    <section className="rounded-panel bg-surface p-5 hairline sm:p-6" aria-label={legacy ? "Secure your saved profile" : "Account access"}>
      <h1 className="t-title2">{legacy ? "Secure your saved profile" : registering ? "Create an account" : "Welcome back"}</h1>
      <p className="t-sub mt-2 text-ink-2">
        {legacy ? "Add a username and password to keep this profile, including all your stats and friends. You can then log in from any browser."
          : registering ? "Save your stats and keep your friends between games."
            : "Log in to pick up where you left off."}
      </p>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4" aria-label={registering ? "Create account" : "Log in"}>
        <Field label="Username">
          <input className={inputClass} name="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={18} pattern="[a-zA-Z0-9]{3,18}" required disabled={busy} aria-describedby={registering ? "username-help" : undefined} />
        </Field>
        {registering ? <p id="username-help" className="t-footnote -mt-2 text-ink-3">For logging in and adding friends. Use 3 to 18 letters or numbers.</p> : null}
        {registering ? <Field label="Display name">
          <input className={inputClass} name="displayName" value={name} onChange={(event) => setDisplayName(event.target.value)} autoComplete="nickname" maxLength={18} required disabled={busy} placeholder="Your name at the table" />
        </Field> : null}
        <Field label="Password">
          <input className={inputClass} name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 8 : 1} maxLength={128} required disabled={busy} />
        </Field>
        {registering ? <>
          <p className="t-footnote -mt-2 text-ink-3">Use 8 to 128 characters. A memorable phrase works well. Save it in your password manager.</p>
          <Field label="Confirm password"><input className={inputClass} name="confirmPassword" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} /></Field>
        </> : null}
        {error ? <p role="alert" className="t-sub text-red">{error}</p> : null}
        <Button type="submit" variant="primary" size="lg" disabled={busy}>{busy ? "Please wait" : registering ? legacy ? "Secure this profile" : "Create account" : "Log in"}</Button>
      </form>
      {!legacy ? <p className="t-sub mt-5 text-center text-ink-2">
        {registering ? "Already have an account?" : "New to Cambio?"}{" "}
        <button type="button" className="font-semibold text-ink hover:text-ink-2 disabled:opacity-40" disabled={busy} onClick={() => { setMode(registering ? "login" : "register"); setError(null); setPassword(""); setConfirm(""); }}>{registering ? "Log in" : "Create account"}</button>
      </p> : null}
    </section>
  );
}

export function AccountSettings({ stored, onExit }: { stored: StoredProfile; onExit: () => void }) {
  type Editor = "avatar" | "name" | "username" | "password" | "delete";
  const [editing, setEditing] = useState<Editor | null>(null);
  const changeButtons = useRef<Partial<Record<Editor, HTMLButtonElement | null>>>({});
  const [avatarDraft, setAvatarDraft] = useState<number | null>(null);
  const selectedAvatar = avatarDraft ?? avatarIndex(stored.profile.id, stored.profile.avatarId);
  const [nameDraft, setDisplayName] = useState<string | null>(null);
  const displayName = nameDraft ?? stored.profile.displayName;
  const [usernameDraft, setUsername] = useState<string | null>(null);
  const username = usernameDraft ?? stored.username ?? "";
  const [usernamePassword, setUsernamePassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: string; text: string; error: boolean } | null>(null);
  const edit = (next: Editor | null) => {
    setAvatarDraft(null);
    setDisplayName(null); setUsername(null); setUsernamePassword("");
    setCurrentPassword(""); setPassword(""); setConfirmPassword("");
    setDeletePassword(""); setConfirmation(""); setNotice(null);
    setEditing(next);
    if (next === null && editing) requestAnimationFrame(() => changeButtons.current[editing]?.focus({ preventScroll: true }));
  };
  const perform = async (kind: string, work: () => Promise<string>) => {
    setBusy(kind); setNotice(null);
    try {
      const text = await work();
      setEditing(null);
      requestAnimationFrame(() => changeButtons.current[kind as Editor]?.focus({ preventScroll: true }));
      setNotice({ kind, text, error: false });
    }
    catch (error) { setNotice({ kind, text: errorText(error), error: true }); }
    finally { setBusy(null); }
  };
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (notice) noticeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [notice]);
  const feedback = (kind: string) => notice?.kind === kind ? <p ref={noticeRef} role={notice.error ? "alert" : "status"} className={`t-sub mt-4 ${notice.error ? "text-red" : "text-accent"}`}>{notice.text}</p> : null;
  const change = (kind: Editor, label: string) => editing !== kind ? (
    <Button ref={(button) => { changeButtons.current[kind] = button; }} type="button" size="sm" className="shrink-0" aria-label={`Change ${label}`} disabled={!!busy} onClick={() => edit(kind)}>Change</Button>
  ) : null;
  const cancel = <Button type="button" variant="ghost" disabled={!!busy} onClick={() => edit(null)}>Cancel</Button>;
  const row = "flex items-center justify-between gap-4";
  const formClass = "mt-5 flex flex-col gap-4";
  const actions = "flex flex-wrap gap-2";
  return (
    <div className="flex flex-col gap-5" aria-label="Account settings">
      <div className="divide-y divide-ink/10 rounded-panel bg-surface hairline">
        <section className="p-5 sm:p-6" aria-labelledby="avatar-heading">
          <div className={row}>
            <div className="flex min-w-0 items-center gap-3">
              <Avatar identity={stored.profile.id} avatarId={selectedAvatar} size={64} />
              <div className="min-w-0"><h2 id="avatar-heading" className="t-headline">Avatar</h2><p className="t-sub mt-1 text-ink-2">Your look at the table.</p></div>
            </div>
            {change("avatar", "avatar")}
          </div>
          {editing === "avatar" ? <form id="avatar-form" className={formClass} aria-label="Avatar settings" onSubmit={(event) => { event.preventDefault(); void perform("avatar", async () => {
            const result = await updateAccount({ avatarId: selectedAvatar }); setAvatarDraft(null);
            return result.warning ?? "Avatar updated everywhere you play.";
          }); }}>
            <fieldset disabled={!!busy}>
              <legend className="t-sub mb-3 text-ink-2">Choose your avatar. Change it whenever you like.</legend>
              <div className="grid grid-cols-3 gap-2">
                {AVATAR_OPTIONS.map((option) => <label key={option.id} className="min-w-0 cursor-pointer">
                  <input className="peer sr-only" type="radio" name="avatarId" value={option.id} checked={selectedAvatar === option.id} onChange={() => setAvatarDraft(option.id)} autoFocus={selectedAvatar === option.id} />
                  <span className="flex min-w-0 flex-col items-center gap-1 rounded-2xl border border-line-strong px-1 py-3 transition-colors hover:bg-ink/5 peer-checked:border-accent peer-checked:bg-accent/10 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:cursor-wait peer-disabled:opacity-60">
                    <Avatar identity={stored.profile.id} avatarId={option.id} size={56} />
                    <span className="text-center text-[11px] leading-snug text-ink-2">{option.label}</span>
                  </span>
                </label>)}
              </div>
            </fieldset>
            <div className={actions}><Button type="submit" variant="primary" disabled={!!busy}>{busy === "avatar" ? "Saving" : "Save avatar"}</Button>{cancel}</div>
          </form> : null}
          {feedback("avatar")}
        </section>
        <section className="p-5 sm:p-6" aria-labelledby="display-name-heading">
          <div className={row}>
            <div className="min-w-0"><h2 id="display-name-heading" className="t-headline">Display name</h2>{editing !== "name" ? <p className="t-body mt-1 break-words">{stored.profile.displayName}</p> : null}</div>
            {change("name", "display name")}
          </div>
          <p className="t-sub mt-2 text-ink-2">The name players see at the table.</p>
          {editing === "name" ? <form id="name-form" className={formClass} aria-label="Display name settings" onSubmit={(event) => { event.preventDefault(); void perform("name", async () => {
            const result = await updateAccount({ displayName }); setDisplayName(null);
            return result.warning ?? "Display name updated everywhere you play.";
          }); }}>
            <Field label="Display name"><input autoFocus className={inputClass} name="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="nickname" maxLength={18} required disabled={!!busy} /></Field>
            <div className={actions}><Button type="submit" variant="primary" disabled={!!busy}>{busy === "name" ? "Saving" : "Save display name"}</Button>{cancel}</div>
          </form> : null}
          {feedback("name")}
        </section>
        <section className="p-5 sm:p-6" aria-labelledby="username-heading">
          <div className={row}>
            <div className="min-w-0"><h2 id="username-heading" className="t-headline">Username</h2>{editing !== "username" ? <p className="t-body mt-1 break-all">@{stored.username}</p> : null}</div>
            {change("username", "username")}
          </div>
          <p className="t-sub mt-2 text-ink-2">Use it to log in. Friends use it to find and add you.</p>
          {editing === "username" ? <form id="username-form" className={formClass} aria-label="Username settings" onSubmit={(event) => { event.preventDefault(); void perform("username", async () => {
            await updateAccount({ username, currentPassword: usernamePassword }); setUsername(null); setUsernamePassword("");
            return "Username updated. Use it to log in and share it with friends.";
          }); }}>
            <p className="t-sub text-ink-2">Changing this also changes your profile link. Your friends and stats stay with you.</p>
            <Field label="Username"><input autoFocus className={inputClass} name="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} pattern="[a-zA-Z0-9]{3,18}" minLength={3} maxLength={18} required disabled={!!busy} aria-describedby="change-username-help" /></Field>
            <p id="change-username-help" className="t-footnote -mt-2 text-ink-3">3 to 18 letters or numbers. Usernames are not case sensitive.</p>
            <Field label="Current password"><input className={inputClass} name="currentPassword" type="password" value={usernamePassword} onChange={(event) => setUsernamePassword(event.target.value)} autoComplete="current-password" maxLength={128} required disabled={!!busy} /></Field>
            <div className={actions}><Button type="submit" variant="primary" disabled={!!busy}>{busy === "username" ? "Saving" : "Save username"}</Button>{cancel}</div>
          </form> : null}
          {feedback("username")}
        </section>
        <section className="p-5 sm:p-6" aria-labelledby="password-heading">
          <div className={row}>
            <div className="min-w-0"><h2 id="password-heading" className="t-headline">Password</h2><p className="t-sub mt-2 text-ink-2">Keep your account secure.</p></div>
            {change("password", "password")}
          </div>
          {editing === "password" ? <form id="password-form" className={formClass} aria-label="Password settings" onSubmit={(event) => { event.preventDefault(); void perform("password", async () => {
            if (password !== confirmPassword) throw new Error("Your new passwords do not match.");
            await updateAccount({ password, currentPassword }); setCurrentPassword(""); setPassword(""); setConfirmPassword("");
            return "Password changed. Other devices have been signed out.";
          }); }}>
            <p className="t-sub text-ink-2">Use 8 to 128 characters. Changing your password signs out other devices.</p>
            <input type="hidden" name="username" value={stored.username ?? ""} autoComplete="username" />
            <Field label="Current password"><input autoFocus className={inputClass} name="currentPassword" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" maxLength={128} required disabled={!!busy} /></Field>
            <Field label="New password"><input className={inputClass} name="newPassword" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required disabled={!!busy} /></Field>
            <Field label="Confirm new password"><input className={inputClass} name="confirmPassword" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required disabled={!!busy} /></Field>
            <div className={actions}><Button type="submit" variant="primary" disabled={!!busy}>{busy === "password" ? "Saving" : "Save password"}</Button>{cancel}</div>
          </form> : null}
          {feedback("password")}
        </section>
      </div>
      <div className="divide-y divide-ink/10 rounded-panel bg-surface hairline">
        <section className="p-5 sm:p-6" aria-label="Sign out">
          <h2 className="t-headline">Sign out</h2>
          <p className="t-sub mt-2 text-ink-2">Sign out of this browser. Your stats and friends stay saved.</p>
          <Button className="mt-4" type="button" disabled={!!busy} onClick={() => void perform("logout", async () => { await signOut(); onExit(); return "Signed out."; })}>{busy === "logout" ? "Signing out" : "Sign out"}</Button>
          {feedback("logout")}
        </section>
        <section className="p-5 sm:p-6" aria-label="Delete account">
          <h2 className="t-headline">Delete account</h2>
          <p className="t-sub mt-2 text-ink-2">Permanently delete your account, stats, friends, and invites. This cannot be undone.</p>
          {editing === "delete" ? <form id="delete-form" className={formClass} aria-label="Confirm account deletion" onSubmit={(event) => { event.preventDefault(); void perform("delete", async () => { await deleteAccount(deletePassword, confirmation); onExit(); return "Account deleted."; }); }}>
            <input type="hidden" name="username" value={stored.username ?? ""} autoComplete="username" />
            <Field label="Current password"><input autoFocus className={inputClass} name="currentPassword" type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} autoComplete="current-password" maxLength={128} required disabled={!!busy} /></Field>
            <Field label="Type DELETE to confirm"><input className={inputClass} name="confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} pattern="DELETE" required disabled={!!busy} /></Field>
            <div className={actions}><Button type="submit" variant="danger" disabled={!!busy || confirmation !== "DELETE"}>{busy === "delete" ? "Deleting" : "Permanently delete account"}</Button>{cancel}</div>
          </form> : <Button ref={(button) => { changeButtons.current.delete = button; }} className="mt-4 text-red" type="button" disabled={!!busy} onClick={() => edit("delete")}>Delete account</Button>}
          {feedback("delete")}
        </section>
      </div>
    </div>
  );
}
