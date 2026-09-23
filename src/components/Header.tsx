"use client";

import Link from "next/link";
import type { ComponentPropsWithRef, ComponentProps, ReactNode } from "react";
import { Wordmark } from "./ui";

/** One size, spacing and state treatment for every control above the divider. */
const controlClass = "press inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-transparent px-3 text-[13px] font-medium leading-5 text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40 aria-[current=page]:bg-surface-2 aria-[current=page]:text-ink aria-pressed:bg-surface-2 aria-pressed:text-ink aria-checked:bg-accent-soft aria-checked:text-accent-ink";

export function HeaderLink({ className = "", ...props }: ComponentProps<typeof Link>) {
  return <Link {...props} data-header-control className={`${controlClass} ${className}`} />;
}

export function HeaderButton({ className = "", type = "button", ...props }: ComponentPropsWithRef<"button">) {
  return <button {...props} type={type} data-header-control className={`${controlClass} ${className}`} />;
}

export function HeaderBar({ children, context, status, label, className = "" }: {
  children: ReactNode;
  context?: ReactNode;
  status?: ReactNode;
  label: string;
  className?: string;
}) {
  return <header data-app-header className={`flex min-h-20 shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b border-line py-4 ${className}`}>
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-4 gap-y-2">
      <Link href="/" aria-label="Cambio home" className="inline-flex h-10 shrink-0 items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"><Wordmark /></Link>
      {context}
      {status}
    </div>
    <nav aria-label={label} className="flex min-w-0 basis-full flex-wrap items-center gap-2 xl:flex-1 xl:basis-auto">
      {children}
    </nav>
  </header>;
}
