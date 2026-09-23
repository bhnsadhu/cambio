"use client";

import { useEffect, useRef, type RefObject } from "react";

const stack: { dialog: HTMLElement; layer: number }[] = [];
let previousOverflow = "";

/** The stack follows paint order, including when equal layers mount out of order. */
function topDialog() { return stack.at(-1)?.dialog ?? null; }

function restoreDialogFocus(trigger: HTMLElement | null, preferred?: RefObject<HTMLElement | null>) {
  const next = topDialog();
  // A table control can move into or out of the pause overlay while its
  // editor is open. Restore its current node, not the detached original.
  const target = preferred?.current ?? trigger;
  if (target?.isConnected && (!next || next.contains(target))) target.focus({ preventScroll: true });
  else next?.focus({ preventScroll: true });
}

/** Keep keyboard navigation in the highest visible dialog. */
export function useModalFocus(open = true, restoreFocus?: RefObject<HTMLElement | null>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!stack.length) { previousOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    // Cache paint order while nodes are connected. React removes nodes before
    // effect cleanup, which must still identify the departing top dialog.
    const entry = { dialog, layer: Number.parseInt(getComputedStyle(dialog).zIndex, 10) || 0 };
    stack.push(entry);
    stack.sort((a, b) => {
      if (a.layer !== b.layer) return a.layer - b.layer;
      const position = a.dialog.compareDocumentPosition(b.dialog);
      if (position & Node.DOCUMENT_POSITION_DISCONNECTED) return 0;
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    const top = () => topDialog() === dialog;
    if (top()) dialog.focus({ preventScroll: true });
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
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      if (!stack.length) document.body.style.overflow = previousOverflow;
      if (wasTop) restoreDialogFocus(trigger, restoreFocus);
    };
  }, [open, restoreFocus]);
  return ref;
}
