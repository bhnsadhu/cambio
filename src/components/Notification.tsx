"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { dismissAccountNotice, useAccountNotice } from "@/lib/client/profile";
import { useActiveDialog } from "@/lib/client/useModalFocus";

type Tone = "neutral" | "good" | "bad";
type Kind = "game" | "stick" | "reveal" | "pause" | "social" | "account" | "info";
interface Message { id: number; text: string; title: string; tone: Tone }
type Notify = (text: string, tone?: Tone, title?: string) => void;
const HostContext = createContext<HTMLElement | null>(null);
const NotifyContext = createContext<Notify>(() => {});
const AreaContext = createContext<(area: HTMLElement | null) => void>(() => {});

/** One viewport survives navigation; every notification portals into this stack. */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [area, setArea] = useState<HTMLElement | null>(null);
  const dialog = useActiveDialog();
  useEffect(() => {
    if (!dialog || !area || !host) return;
    // Keep the table placement while moving the stack into a dialog's focus scope.
    const reset = () => { for (const key of ["left", "top", "bottom", "transform", "width"]) host.style.removeProperty(key); };
    const place = () => {
      reset();
      if (!window.matchMedia("(min-width: 1024px)").matches) return;
      area.style.setProperty("min-height", `${host.scrollHeight}px`);
      const box = area.getBoundingClientRect();
      if (box.bottom <= 0 || box.top >= innerHeight) return;
      Object.assign(host.style, { left: `${box.left + box.width / 2}px`, top: `${box.top + box.height / 2}px`, bottom: "auto", transform: "translate(-50%, -50%)", width: `${Math.min(760, box.width)}px` });
    };
    const observer = new ResizeObserver(place);
    observer.observe(area);
    observer.observe(host);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    place();
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); area.style.removeProperty("min-height"); reset(); };
  }, [area, dialog, host]);
  const [messages, setMessages] = useState<Message[]>([]);
  const sequence = useRef(0);
  const notify = useCallback<Notify>((text, tone = "neutral", title = "Cambio") => {
    const message = { id: ++sequence.current, text, tone, title };
    setMessages((current) => [...current.filter((item) => item.text !== text).slice(-2), message]);
  }, []);
  const dismiss = useCallback((id: number) => setMessages((current) => current.filter((item) => item.id !== id)), []);
  const destination = dialog ?? area;
  const viewport = <section ref={setHost} className="notification-viewport" data-notification-viewport data-docked={!!area && !dialog} data-modal={!!dialog} role="region" aria-label="Notifications" />;
  return <NotifyContext.Provider value={notify}>
    <AreaContext.Provider value={setArea}>
      <HostContext.Provider value={host}>
        {children}
        <AccountNotification />
        {messages.map((message) => <TimedMessage key={message.id} message={message} dismiss={dismiss} />)}
        {destination ? createPortal(viewport, destination) : viewport}
      </HostContext.Provider>
    </AreaContext.Provider>
  </NotifyContext.Provider>;
}

/** The original table space between the hands and the round controls. */
export function NotificationArea({ children }: { children: ReactNode }) {
  const register = useContext(AreaContext);
  const ref = useRef<HTMLDivElement>(null);
  // Effects also clean up when Next hides a retained route tree.
  useEffect(() => { register(ref.current); return () => register(null); }, [register]);
  return <div ref={ref} data-notification-area className="notification-area order-3">{children}</div>;
}

export function useNotify() { return useContext(NotifyContext); }

function TimedMessage({ message, dismiss }: { message: Message; dismiss: (id: number) => void }) {
  const close = useCallback(() => dismiss(message.id), [dismiss, message.id]);
  return <Notification title={message.title} tone={message.tone} onDismiss={close} duration={message.tone === "bad" ? 8000 : 5000}>{message.text}</Notification>;
}

function AccountNotification() {
  const notice = useAccountNotice();
  return notice ? <Notification title="Account" kind="account" onDismiss={dismissAccountNotice}>{notice}</Notification> : null;
}

/** Shared shell for passive events, errors, private reveals, and actionable requests. */
export function Notification({ title, children, tone = "neutral", kind = "info", label, actions, onDismiss, duration, priority = 10, announce = true, custom = false, className = "" }: {
  title: string;
  children: ReactNode;
  tone?: Tone;
  kind?: Kind;
  label?: string;
  actions?: ReactNode;
  onDismiss?: () => void;
  duration?: number;
  priority?: number;
  announce?: boolean;
  custom?: boolean;
  className?: string;
}) {
  const host = useContext(HostContext);
  const [held, setHeld] = useState(false);
  const close = useRef(onDismiss);
  useEffect(() => { close.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    if (!host || !duration || held) return;
    const timer = window.setTimeout(() => close.current?.(), duration);
    return () => window.clearTimeout(timer);
  }, [host, duration, held, children]);
  const style = useMemo(() => ({ order: priority }), [priority]);
  if (!host) return null;
  return createPortal(
    <section className={`app-notification ${custom ? "" : "notification-surface animate-rise"} ${className}`} data-tone={tone} data-kind={kind} data-interactive={!!(actions || onDismiss || kind === "pause")} style={style}
      aria-label={label ?? `${title} notification`} onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHeld(false); }}>
      {custom ? <div role={announce ? tone === "bad" ? "alert" : "status" : undefined} aria-atomic={announce || undefined} className="contents">{children}</div> : <div className="notification-content">
        <p className="notification-heading t-caption">{title}</p>
        <div role={announce ? tone === "bad" ? "alert" : "status" : undefined} aria-atomic={announce || undefined} className="notification-message">{children}</div>
      </div>}
      {onDismiss ? <button type="button" className="notification-dismiss" aria-label={`Dismiss ${title.toLowerCase()} notification`} onClick={onDismiss}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button> : null}
      {actions ? <div className="notification-actions">{actions}</div> : null}
    </section>, host,
  );
}
