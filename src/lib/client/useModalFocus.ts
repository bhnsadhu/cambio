"use client";

import { useEffect, useRef, type RefObject } from "react";

const stack: { dialog: HTMLElement; layer: number }[] = [];
let previousOverflow = "";

/** A late game overlay must not steal focus from a visibly higher editor. */
function topDialog() {
  let top: HTMLElement | null = null;
  let topLayer = -Infinity;
  for (const { dialog, layer } of stack) {
    if (layer >= topLayer) { top = dialog; topLayer = layer; }
  }
  return top;
}

function restoreDialogFocus(trigger: HTMLElement | null, preferred?: RefObject<HTMLElement | null>) {
  const next = topDialog();
  // A table control can move into or out of the pause overlay while its
  // editor is open. Restore its current node, not the detached original.
  const target = preferred?.current ?? trigger;
  if (target?.isConnected && (!next || next.contains(target))) target.focus({ preventScroll: true });
  else next?.focus({ preventScroll: true });
}

/** Keep keyboard navigation in the highest dialog; newer dialogs win ties. */
export function useModalFocus(open = true, restoreFocus?: RefObject<HTMLElement | null>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!stack.length) { previousOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    // Keep the layer after React removes the DOM node, so cleanup can still
    // identify the departing top dialog and restore focus underneath it.
    const entry = { dialog, layer: Number.parseInt(getComputedStyle(dialog).zIndex, 10) || 0 };
    stack.push(entry);
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
