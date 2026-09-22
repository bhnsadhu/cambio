"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { authenticate, deleteAccount, signOut, updateAccount, type StoredProfile } from "@/lib/client/profile";
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
    <section className="rounded-panel bg-surface p-6 hairline" aria-label={legacy ? "Secure your saved profile" : "Account access"}>
      <h2 className="t-headline">{legacy ? "Secure your saved profile" : registering ? "Create an account" : "Welcome back"}</h2>
      <p className="t-sub mt-2 text-ink-2">
        {legacy ? "Add a username and password to keep this profile, including all your stats and friends. You can then log in from any browser."
          : registering ? "Your username is for logging in. Your display name is what other players see."
            : "Log in with your username and password to get back to your stats and friends."}
      </p>
      {!legacy ? (
        <div className="mt-5 flex gap-2" role="group" aria-label="Account access options">
          <Button type="button" variant={!registering ? "primary" : "ghost"} size="sm" disabled={busy} aria-pressed={!registering} onClick={() => { setMode("login"); setError(null); setPassword(""); setConfirm(""); }}>Log in</Button>
          <Button type="button" variant={registering ? "primary" : "ghost"} size="sm" disabled={busy} aria-pressed={registering} onClick={() => { setMode("register"); setError(null); setPassword(""); setConfirm(""); }}>Create account</Button>
        </div>
      ) : null}
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4" aria-label={registering ? "Create account" : "Log in"}>
        <Field label="Username">
          <input className={inputClass} name="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={18} pattern="[a-zA-Z0-9]{3,18}" required disabled={busy} aria-describedby="username-help" />
        </Field>
        <p id="username-help" className="t-footnote -mt-2 text-ink-3">3 to 18 letters or numbers. Capitalization does not affect your login.</p>
        {registering ? <Field label="Display name">
          <input className={inputClass} name="displayName" value={name} onChange={(event) => setDisplayName(event.target.value)} autoComplete="nickname" maxLength={18} required disabled={busy} placeholder="Your name at the table" />
        </Field> : null}
        <Field label="Password">
          <input className={inputClass} name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 15 : 1} maxLength={128} required disabled={busy} />
        </Field>
        {registering ? <>
          <p className="t-footnote -mt-2 text-ink-3">Use 15 to 128 characters. A memorable phrase works well. Save it in your password manager.</p>
          <Field label="Confirm password"><input className={inputClass} name="confirmPassword" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" minLength={15} maxLength={128} required disabled={busy} /></Field>
        </> : null}
        {error ? <p role="alert" className="t-sub text-red">{error}</p> : null}
        <Button type="submit" variant="primary" size="lg" disabled={busy}>{busy ? "Please wait" : registering ? legacy ? "Secure this profile" : "Create account" : "Log in"}</Button>
        {!registering ? <p className="t-footnote text-ink-3">Your display name can be different from your username.</p> : null}
      </form>
    </section>
  );
}

export function AccountSettings({ stored }: { stored: StoredProfile }) {
  const [nameDraft, setDisplayName] = useState<string | null>(null);
  const displayName = nameDraft ?? stored.profile.displayName;
  const [usernameDraft, setUsername] = useState<string | null>(null);
  const username = usernameDraft ?? stored.username ?? "";
  const [usernamePassword, setUsernamePassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const perform = async (kind: string, work: () => Promise<string>) => {
    setBusy(kind); setNotice(null);
    try { setNotice({ text: await work(), error: false }); }
    catch (error) { setNotice({ text: errorText(error), error: true }); }
    finally { setBusy(null); }
  };
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (notice) noticeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [notice]);
  const panel = "scroll-mt-6 flex flex-col gap-4 rounded-panel bg-surface p-6 hairline";
  return (
    <div className="flex flex-col gap-5" aria-label="Account settings">
      {notice ? <p ref={noticeRef} role={notice.error ? "alert" : "status"} className={`t-sub rounded-[16px] p-4 ${notice.error ? "bg-surface-2 text-red" : "bg-accent-soft text-accent"}`}>{notice.text}</p> : null}
      <form id="display-name" className={panel} aria-label="Display name settings" onSubmit={(event) => { event.preventDefault(); void perform("name", async () => {
        const result = await updateAccount({ displayName }); setDisplayName(null);
        return result.warning ?? "Display name updated everywhere you play.";
      }); }}>
        <div><h2 className="t-headline">Display name</h2><p className="t-sub mt-1 text-ink-2">The name shown at the table and in your friends list. It does not change your login.</p></div>
        <Field label="Display name"><input className={inputClass} name="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="nickname" maxLength={18} required disabled={!!busy} /></Field>
        <Button type="submit" variant="primary" disabled={!!busy}>{busy === "name" ? "Saving" : "Save display name"}</Button>
      </form>
      <form id="username" className={panel} aria-label="Username settings" onSubmit={(event) => { event.preventDefault(); void perform("username", async () => {
        await updateAccount({ username, currentPassword: usernamePassword }); setUsername(null); setUsernamePassword("");
        return "Username updated. Use it the next time you log in.";
      }); }}>
        <div><h2 className="t-headline">Login username</h2><p className="t-sub mt-1 text-ink-2">Your current username is <strong>{stored.username}</strong>. Your public friend handle stays @{stored.profile.handle}.</p></div>
        <Field label="Username"><input className={inputClass} name="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} pattern="[a-zA-Z0-9]{3,18}" minLength={3} maxLength={18} required disabled={!!busy} /></Field>
        <Field label="Current password"><input className={inputClass} name="currentPassword" type="password" value={usernamePassword} onChange={(event) => setUsernamePassword(event.target.value)} autoComplete="current-password" maxLength={128} required disabled={!!busy} /></Field>
        <Button type="submit" disabled={!!busy}>{busy === "username" ? "Saving" : "Save username"}</Button>
      </form>
      <form id="password" className={panel} aria-label="Password settings" onSubmit={(event) => { event.preventDefault(); void perform("password", async () => {
        if (password !== confirmPassword) throw new Error("Your new passwords do not match.");
        await updateAccount({ password, currentPassword }); setCurrentPassword(""); setPassword(""); setConfirmPassword("");
        return "Password changed. Other devices have been signed out.";
      }); }}>
        <div><h2 className="t-headline">Password</h2><p className="t-sub mt-1 text-ink-2">Use 15 to 128 characters. Changing your password signs out other sessions.</p></div>
        <input type="hidden" name="username" value={stored.username ?? ""} autoComplete="username" />
        <Field label="Current password"><input className={inputClass} name="currentPassword" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" maxLength={128} required disabled={!!busy} /></Field>
        <Field label="New password"><input className={inputClass} name="newPassword" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={15} maxLength={128} required disabled={!!busy} /></Field>
        <Field label="Confirm new password"><input className={inputClass} name="confirmPassword" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={15} maxLength={128} required disabled={!!busy} /></Field>
        <Button type="submit" disabled={!!busy}>{busy === "password" ? "Updating" : "Change password"}</Button>
      </form>
      <section id="sign-out" className={panel} aria-label="Sign out">
        <div><h2 className="t-headline">Sign out</h2><p className="t-sub mt-1 text-ink-2">Sign out of this browser. Your stats and friends stay saved. Log in again with your username and password.</p></div>
        <Button type="button" disabled={!!busy} onClick={() => void perform("logout", async () => { await signOut(); return "Signed out."; })}>{busy === "logout" ? "Signing out" : "Sign out"}</Button>
      </section>
      <section id="delete-account" className={`${panel} border border-red/30`} aria-label="Delete account">
        <div><h2 className="t-headline">Delete account</h2><p className="t-sub mt-1 text-ink-2">Permanently delete your account, stats, friendships, and invites. This cannot be undone.</p></div>
        {deleting ? <form className="flex flex-col gap-4" aria-label="Confirm account deletion" onSubmit={(event) => { event.preventDefault(); void perform("delete", async () => { await deleteAccount(deletePassword, confirmation); return "Account deleted."; }); }}>
          <Field label="Current password"><input className={inputClass} name="currentPassword" type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} autoComplete="current-password" maxLength={128} required disabled={!!busy} /></Field>
          <Field label="Type DELETE to confirm"><input className={inputClass} name="confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} pattern="DELETE" required disabled={!!busy} /></Field>
          <Button type="submit" className="bg-red text-white hover:bg-red/80" disabled={!!busy || confirmation !== "DELETE"}>{busy === "delete" ? "Deleting" : "Permanently delete account"}</Button>
          <Button type="button" variant="ghost" disabled={!!busy} onClick={() => { setDeleting(false); setDeletePassword(""); setConfirmation(""); }}>Cancel</Button>
        </form> : <Button type="button" className="text-red" disabled={!!busy} onClick={() => { setNotice(null); setDeleting(true); }}>Delete account</Button>}
      </section>
    </div>
  );
}
