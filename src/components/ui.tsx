"use client";

import type { ComponentPropsWithRef, ReactNode } from "react";
import { BOT_DIFFICULTIES, type BotDifficulty } from "@/lib/game/types";

type Variant = "primary" | "secondary" | "accent" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const BUTTON_BASE =
  "press inline-flex items-center justify-center gap-2 rounded-xl font-medium select-none whitespace-nowrap " +
  "disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30";

const BUTTON_SIZES: Record<Size, string> = {
  sm: "h-8 px-3.5 text-[13px]",
  md: "h-10 px-4.5 text-[14px]",
  lg: "h-12 px-6 text-[15px]",
};

const BUTTON_VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-bg hover:bg-tile-2",
  secondary: "bg-surface-2 text-ink hover:bg-surface-3",
  accent: "bg-accent text-bg hover:brightness-110",
  ghost: "bg-transparent text-ink-2 hover:text-ink hover:bg-surface-2",
  /** The one destructive look. Red is never used for anything reversible. */
  danger: "bg-red text-ink hover:brightness-110",
};

/**
 * The button look on its own, for the places that need a link rather than a
 * button. A styled Link and a Button stay the same shape because they read
 * from here instead of copying the classes.
 */
export function buttonClass({ variant = "secondary", size = "md", className = "" }: { variant?: Variant; size?: Size; className?: string } = {}) {
  return `${BUTTON_BASE} ${BUTTON_SIZES[size]} ${BUTTON_VARIANTS[variant]} ${className}`;
}

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  children,
  ...rest
}: ComponentPropsWithRef<"button"> & { variant?: Variant; size?: Size; children: ReactNode }) {
  return (
    <button className={buttonClass({ variant, size, className })} {...rest}>
      {children}
    </button>
  );
}

export function Chip({ tone = "neutral", children }: { tone?: "neutral" | "ink" | "accent" | "muted"; children: ReactNode }) {
  const cls = {
    neutral: "bg-surface-2 text-ink-2",
    ink: "bg-ink text-bg",
    accent: "bg-accent-soft text-accent-ink",
    muted: "bg-transparent text-ink-3 hairline",
  }[tone];
  return <span className={`inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11.5px] font-medium ${cls}`}>{children}</span>;
}

/** The one status dot. Green and breathing means live or active, everywhere. */
export function Pip({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`pip inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent ${className}`} />;
}

/** Its counterpart for a state that is not live: still, and gray. */
export function DotOff({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3 ${className}`} />;
}

export type Presence = "playing" | "online" | "offline";

/**
 * What the dot beside a name actually means, in three states rather than two:
 *   playing  mint and breathing — they are at a table right now
 *   online   mint and still — the app is open, they are free to be asked
 *   offline  gray — nothing has been heard from them
 */
export function PresenceDot({ state, className = "" }: { state: Presence; className?: string }) {
  if (state === "playing") return <Pip className={className} />;
  if (state === "online") {
    return <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent ${className}`} />;
  }
  return <DotOff className={className} />;
}

/** The same three states in words, for the line under a name. */
export function presenceOf(friend: { online: boolean; playing: unknown }): Presence {
  if (friend.playing) return "playing";
  return friend.online ? "online" : "offline";
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="relative inline-block h-5 w-4 rounded-[4px] card-back" aria-hidden />
      <span className="t-headline">Cambio</span>
    </span>
  );
}

/**
 * Bot names carry the brand: the Cam is always bold. One element, never a
 * fragment, so a flex parent cannot open a gap inside the name.
 */
export function PlayerName({ name, isBot }: { name: string; isBot: boolean }) {
  if (isBot && /^cam/i.test(name)) {
    return (
      <span>
        <b className="font-semibold">{name.slice(0, 3)}</b>
        {name.slice(3)}
      </span>
    );
  }
  return <span>{name}</span>;
}

/** What each level means, in one line, wherever a bot seat is being set. */
export const DIFFICULTY_LABEL: Record<BotDifficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

export const DIFFICULTY_BLURB: Record<BotDifficulty, string> = {
  easy: "Lets sticks go by and keeps cards it should not. Plays like someone learning.",
  medium: "The house's basic strategy: remembers what it has seen and plays it straight.",
  hard: "Counts the pile, weighs every hand at the table, and reacts faster than you can.",
};

/**
 * How hard one bot seat plays. The host picks; everyone else reads it, so a
 * table always knows what it is sitting across from.
 */
export function DifficultyPicker({
  value,
  onChange,
  disabled,
  canEdit,
  label,
}: {
  value: BotDifficulty;
  onChange: (d: BotDifficulty) => void;
  disabled?: boolean;
  canEdit: boolean;
  label: string;
}) {
  if (!canEdit) return <Chip tone={value === "hard" ? "accent" : "neutral"}>{DIFFICULTY_LABEL[value]}</Chip>;
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full bg-surface-2 p-[3px]">
      {BOT_DIFFICULTIES.map((d) => (
        <button
          key={d}
          type="button"
          disabled={disabled}
          aria-pressed={value === d}
          title={DIFFICULTY_BLURB[d]}
          onClick={() => onChange(d)}
          className={[
            "press h-[26px] rounded-full px-2.5 text-[11.5px] font-medium disabled:opacity-40",
            value === d ? "bg-ink text-bg" : "text-ink-3 hover:text-ink",
          ].join(" ")}
        >
          {DIFFICULTY_LABEL[d]}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="t-sub mb-1.5 block font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "h-11 w-full min-w-0 rounded-[12px] bg-surface-2 px-3.5 text-[15px] text-ink outline-none placeholder:text-ink-3 " +
  "focus:hairline-strong transition-shadow duration-150";
