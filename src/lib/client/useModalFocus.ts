"use client";

import { useEffect, useRef } from "react";

const stack: HTMLElement[] = [];
let previousOverflow = "";

/** Keep keyboard navigation inside the top dialog and restore its trigger. */
export function useModalFocus(open = true) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!stack.length) { previousOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    stack.push(dialog);
    dialog.focus({ preventScroll: true });
    const top = () => stack.at(-1) === dialog;
    const onKey = (event: KeyboardEvent) => {
      if (!top() || event.key !== "Tab") return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]'))
        .filter((item) => item.tabIndex >= 0 && item.getClientRects().length > 0);
      const first = items[0]; const last = items.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const onFocus = (event: FocusEvent) => {
      if (top() && event.target instanceof Node && !dialog.contains(event.target)) dialog.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
      const wasTop = top();
      const index = stack.indexOf(dialog);
      if (index >= 0) stack.splice(index, 1);
      if (!stack.length) document.body.style.overflow = previousOverflow;
      if (wasTop && trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open]);
  return ref;
}
