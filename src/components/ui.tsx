"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "accent" | "ghost";

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; children: ReactNode }) {
  const base =
    "press inline-flex items-center justify-center gap-2 rounded-full font-medium select-none whitespace-nowrap " +
    "disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30";
  const sizes = { sm: "h-8 px-3.5 text-[13px]", md: "h-10 px-4.5 text-[14px]", lg: "h-12 px-6 text-[15px]" }[size];
  const variants: Record<Variant, string> = {
    primary: "bg-ink text-bg hover:bg-tile-2",
    secondary: "bg-surface-2 text-ink hover:bg-surface-3",
    accent: "bg-accent text-black hover:brightness-110",
    ghost: "bg-transparent text-ink-2 hover:text-ink hover:bg-surface-2",
  };
  return (
    <button className={`${base} ${sizes} ${variants[variant]} ${className}`} {...rest}>
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

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="t-sub mb-1.5 block font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "h-11 w-full rounded-[12px] bg-surface-2 px-3.5 text-[15px] text-ink outline-none placeholder:text-ink-3 " +
  "focus:hairline-strong transition-shadow duration-150";
