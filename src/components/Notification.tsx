"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { dismissAccountNotice, useAccountNotice } from "@/lib/client/profile";
import { useActiveDialog } from "@/lib/client/useModalFocus";

type Tone = "neutral" | "good" | "bad";
interface Message { id: number; text: string; title: string; tone: Tone }
type Notify = (text: string, tone?: Tone, title?: string) => void;
const HostContext = createContext<HTMLElement | null>(null);
const NotifyContext = createContext<Notify>(() => {});

/** One viewport survives navigation; every notification portals into this stack. */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const dialog = useActiveDialog();
  const pathname = usePathname();
  useEffect(() => {
    let header: HTMLElement | undefined;
    // Next can retain hidden route trees. Only the visible header sets the inset.
    const measure = () => {
      const visible = Array.from(document.querySelectorAll<HTMLElement>("[data-app-header]")).find((element) => element.offsetHeight > 0);
      if (visible !== header) {
        observer.disconnect();
        header = visible;
        if (header) observer.observe(header);
      }
      if (header) document.documentElement.style.setProperty("--notification-top", `${header.offsetHeight + 12}px`);
    };
    const observer = new ResizeObserver(measure);
    const routes = new MutationObserver(() => { if (!header?.isConnected || !header.offsetHeight) measure(); });
    routes.observe(document.body, { childList: true, subtree: true });
    measure();
    return () => { observer.disconnect(); routes.disconnect(); document.documentElement.style.removeProperty("--notification-top"); };
  }, [pathname]);
  const [messages, setMessages] = useState<Message[]>([]);
  const sequence = useRef(0);
  const notify = useCallback<Notify>((text, tone = "neutral", title = "Cambio") => {
    const message = { id: ++sequence.current, text, tone, title };
    setMessages((current) => [...current.filter((item) => item.text !== text).slice(-2), message]);
  }, []);
  const dismiss = useCallback((id: number) => setMessages((current) => current.filter((item) => item.id !== id)), []);
  const viewport = <section ref={setHost} className="notification-viewport" data-notification-viewport role="region" aria-label="Notifications" />;
  return <NotifyContext.Provider value={notify}>
    <HostContext.Provider value={host}>
      {children}
      <AccountNotification />
      {messages.map((message) => <TimedMessage key={message.id} message={message} dismiss={dismiss} />)}
      {dialog ? createPortal(viewport, dialog) : viewport}
    </HostContext.Provider>
  </NotifyContext.Provider>;
}

export function useNotify() { return useContext(NotifyContext); }

function TimedMessage({ message, dismiss }: { message: Message; dismiss: (id: number) => void }) {
  const close = useCallback(() => dismiss(message.id), [dismiss, message.id]);
  return <Notification title={message.title} tone={message.tone} onDismiss={close} duration={message.tone === "bad" ? 8000 : 5000}>{message.text}</Notification>;
}

function AccountNotification() {
  const notice = useAccountNotice();
  return notice ? <Notification title="Account" onDismiss={dismissAccountNotice}>{notice}</Notification> : null;
}

/** Shared shell for passive events, errors, private reveals, and actionable requests. */
export function Notification({ title, children, tone = "neutral", label, actions, onDismiss, duration, priority = 10, announce = true }: {
  title: string;
  children: ReactNode;
  tone?: Tone;
  label?: string;
  actions?: ReactNode;
  onDismiss?: () => void;
  duration?: number;
  priority?: number;
  announce?: boolean;
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
    <section className="app-notification" data-tone={tone} data-interactive={!!(actions || onDismiss)} style={style}
      aria-label={label ?? `${title} notification`} onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHeld(false); }}>
      <div className="notification-content">
        <p className="notification-heading"><span className="notification-mark" aria-hidden />{title}</p>
        <div role={announce ? tone === "bad" ? "alert" : "status" : undefined} aria-atomic={announce || undefined} className="notification-message">{children}</div>
      </div>
      {onDismiss ? <button type="button" className="notification-dismiss" aria-label={`Dismiss ${title.toLowerCase()} notification`} onClick={onDismiss}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button> : null}
      {actions ? <div className="notification-actions">{actions}</div> : null}
    </section>, host,
  );
}
