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
    "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-[background-color,color,transform,opacity] duration-150 " +
    "disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98] select-none whitespace-nowrap";
  const sizes = { sm: "h-8 px-3.5 text-[13px]", md: "h-10 px-4.5 text-[14px]", lg: "h-12 px-6 text-[15px]" }[size];
  const variants: Record<Variant, string> = {
    primary: "bg-ink text-bg hover:bg-tile-2",
    secondary: "bg-surface text-ink hairline hover:bg-surface-2",
    accent: "bg-accent text-white hover:bg-accent-ink",
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
  return <span className={`inline-flex h-5.5 items-center rounded-full px-2 text-[11.5px] font-medium tracking-[0.01em] ${cls}`}>{children}</span>;
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="relative inline-block h-5 w-4 rounded-[4px] card-back" aria-hidden />
      <span className="text-[17px] font-semibold tracking-[-0.01em]">Cambio</span>
    </span>
  );
}

/** Bot names carry the brand: the "Cam" is always bold. */
export function PlayerName({ name, isBot }: { name: string; isBot: boolean }) {
  if (isBot && /^cam/i.test(name)) {
    return (
      <>
        <b className="font-semibold">{name.slice(0, 3)}</b>
        {name.slice(3)}
      </>
    );
  }
  return <>{name}</>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "h-11 w-full rounded-[10px] bg-card px-3.5 text-[15px] text-ink outline-none hairline placeholder:text-ink-3 " +
  "focus:hairline-strong transition-shadow";
