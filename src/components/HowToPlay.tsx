"use client";

import { useEffect } from "react";
import { Button } from "./ui";

const SECTIONS: { title: string; lines: string[] }[] = [
  { title: "Goal", lines: ["Lowest hand wins the round.", "Aces are 1. Jacks and queens are 10. Red kings are minus 1. Black kings and jokers are 0. Everything else is its number."] },
  { title: "Your turn", lines: ["Draw the top card of the deck.", "Place it on the pile, or swap it for one of your own cards. The card you let go of lands on the pile face up."] },
  { title: "Powers", lines: ["Only a placed card has a power. A swapped one gives it up.", "7 or 8: look at one of your cards.", "9 or 10: look at one of someone else's.", "Jack or queen: swap one of yours for one of theirs, unseen.", "Black king: look at two cards from two different players, then swap them or not."] },
  { title: "Sticking", lines: ["Whenever a card lands on the pile, anyone can click a card they believe matches it, from any hand.", "Right, and the card leaves the game. If it was someone else's, you hand them one of yours.", "Wrong, and you draw a penalty card.", "The player mid turn cannot stick until their card is down."] },
  { title: "Cambio", lines: ["Call it at the start of your turn instead of drawing. Everyone else gets one more turn.", "Running out of cards calls it for you."] },
  { title: "Scores", lines: ["Hands are revealed and totalled. Ties stand.", "The winner leads the next round at the same table."] },
];

/** A quiet reference that slides in beside the table. */
export function HowToPlay({ open, onClose, onReplay }: { open: boolean; onClose: () => void; onReplay: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 animate-fade" role="dialog" aria-modal aria-label="How to play">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-[380px] flex-col bg-surface shadow-float" style={{ animation: "slide-in 280ms cubic-bezier(0.2, 0.8, 0.2, 1) both" }}>
        <header className="flex items-center justify-between px-6 pt-5 pb-4">
          <h2 className="t-headline">How to play</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {SECTIONS.map((s) => (
            <section key={s.title} className="border-t border-line py-4">
              <h3 className="t-caption text-ink-3">{s.title}</h3>
              <ul className="mt-2 space-y-1.5">
                {s.lines.map((l) => <li key={l} className="t-sub text-ink-2">{l}</li>)}
              </ul>
            </section>
          ))}
          <div className="border-t border-line pt-5">
            <Button variant="secondary" size="sm" onClick={onReplay}>Show the walkthrough again</Button>
          </div>
        </div>
      </aside>
      <style>{`@keyframes slide-in { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }`}</style>
    </div>
  );
}
