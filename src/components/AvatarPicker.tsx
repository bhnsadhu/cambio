"use client";

import { AVATAR_OPTIONS, SKIN_TONE_OPTIONS, avatarChoice, avatarStyle, avatarTone } from "@/lib/avatars";
import { Avatar } from "./Avatar";

/** Shared style and tone controls; the surrounding form owns saving and preview. */
export function AvatarPicker({ identity, value, onChange, disabled = false, autoFocus = false }: {
  identity: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const selectedStyle = avatarStyle(value);
  const selectedTone = avatarTone(value);
  return <>
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="t-sub mb-3 text-ink-2">Choose your avatar. Change it whenever you like.</legend>
      <div className="grid grid-cols-3 gap-2">
        {AVATAR_OPTIONS.map((option) => <label key={option.id} className="group relative min-w-0 cursor-pointer">
          <input className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-wait" type="radio" name="avatarId" value={option.id} checked={selectedStyle === option.id} onChange={() => onChange(avatarChoice(option.id, selectedTone))} autoFocus={autoFocus && selectedStyle === option.id} />
          <span className="flex h-full min-w-0 flex-col items-center gap-1 rounded-2xl border border-line-strong px-1 py-3 transition-colors group-hover:bg-ink/5 peer-checked:border-accent peer-checked:bg-accent/10 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:cursor-wait peer-disabled:opacity-60">
            <Avatar identity={identity} avatarId={avatarChoice(option.id, selectedTone)} size={56} />
            <span className="text-center text-[11px] leading-snug text-ink-2">{option.label}</span>
          </span>
        </label>)}
      </div>
    </fieldset>
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="t-sub mb-3 text-ink-2">Skin tone</legend>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {SKIN_TONE_OPTIONS.map((option) => <label key={option.id} className="group relative min-w-0 cursor-pointer">
          <input className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-wait" type="radio" name="skinTone" value={option.id} checked={selectedTone === option.id} onChange={() => onChange(avatarChoice(selectedStyle, option.id))} />
          <span className="flex h-full min-w-0 flex-col items-center gap-2 rounded-xl border border-line-strong px-1 pt-3 pb-2 transition-colors group-hover:bg-ink/5 peer-checked:border-accent peer-checked:bg-accent/10 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:cursor-wait peer-disabled:opacity-60">
            <span aria-hidden="true" className="size-6 shrink-0 rounded-full ring-1 ring-white/15" style={{ background: option.color ?? "conic-gradient(#f1c6a7, #dca27b, #ba7b53, #895337, #593725, #f1c6a7)" }} />
            <span className="flex min-h-7 items-center justify-center text-center text-[11px] leading-tight text-ink-2">{option.label}</span>
          </span>
        </label>)}
      </div>
    </fieldset>
  </>;
}
