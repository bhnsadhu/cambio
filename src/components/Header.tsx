"use client";

import Link from "next/link";
import { useSyncExternalStore, type ComponentPropsWithRef, type ComponentProps, type ReactNode } from "react";
import { currentTheme, setTheme, subscribeTheme } from "@/lib/client/theme";
import { Wordmark } from "./ui";

/** One size, spacing and state treatment for every control above the divider. */
const controlClass = "press inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-transparent px-3 pt-0.5 text-[13px] font-medium leading-5 text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40 aria-[current=page]:bg-surface-2 aria-[current=page]:text-ink aria-pressed:bg-surface-2 aria-pressed:text-ink aria-checked:bg-accent-soft aria-checked:text-accent-ink";

export function HeaderLink({ className = "", ...props }: ComponentProps<typeof Link>) {
  return <Link {...props} data-header-control className={`${controlClass} ${className}`} />;
}

export function HeaderButton({ className = "", type = "button", ...props }: ComponentPropsWithRef<"button">) {
  return <button {...props} type={type} data-header-control className={`${controlClass} ${className}`} />;
}

/** One icon at the far edge: the sun while dark, the moon while light. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  // Unknown until hydration; the prepaint script has already applied it to the page.
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => null);
  const next = theme === "light" ? "dark" : "light";
  return <HeaderButton aria-label={`Switch to ${next} theme`} onClick={() => setTheme(next)} className={`ring-1 ring-inset ring-line-strong ${className}`}>
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={theme ? undefined : "invisible"}>
      {theme === "light"
        ? <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        : <><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></>}
    </svg>
  </HeaderButton>;
}

export function HeaderBar({ children, context, status, label, className = "" }: {
  children: ReactNode;
  context?: ReactNode;
  status?: ReactNode;
  label: string;
  className?: string;
}) {
  return <header data-app-header className={`flex min-h-20 shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b border-line py-4 xl:grid xl:grid-cols-[1fr_auto_1fr] ${className}`}>
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-4 gap-y-2">
      <Link href="/" aria-label="Cambio home" className="inline-flex h-10 shrink-0 items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"><Wordmark /></Link>
      {context}
      {status}
    </div>
    <ThemeToggle className="ml-auto xl:col-start-3 xl:row-start-1 xl:justify-self-end" />
    <nav aria-label={label} className="flex min-w-0 basis-full flex-wrap items-center justify-center gap-2 xl:basis-auto">
      {children}
    </nav>
  </header>;
}
