"use client";

import { useEffect } from "react";
import { useModalFocus } from "@/lib/client/useModalFocus";
import { Button } from "./ui";

const SECTIONS: { title: string; lines: string[] }[] = [
  { title: "Goal", lines: ["Lowest hand wins the round.", "Aces are 1. Jacks and queens are 10. Red kings are minus 1. Black kings and jokers are 0. Everything else is its number."] },
  { title: "Your turn", lines: ["Draw the top card of the deck.", "Place it on the pile, or swap it into any card's place at the table, including your own or another player's.", "Whichever card it replaces lands on the pile face up, so the whole table sees what went."] },
  { title: "Powers", lines: ["Only a placed card has a power. A swapped one gives it up.", "7 or 8: look at one of your cards.", "9 or 10: look at one of someone else's.", "Jack or queen: swap any two cards belonging to two different players, unseen. You do not have to be one of them.", "Black king: look at two cards from two different players, then swap them or not."] },
  { title: "Sticking", lines: ["Whenever a card lands on the pile, anyone can select a card they believe matches it, from any hand.", "Right, and the card leaves the game. If it was someone else's, you hand them one of yours.", "Wrong, and you draw a penalty card.", "You can stick during your own turn too. If you are holding a drawn card or using a power, select Stick a card first."] },
  { title: "Cambio", lines: ["Call it at the start of your turn instead of drawing. Everyone else gets one more turn.", "Running out of cards calls it for you."] },
  { title: "Scores", lines: ["Hands are revealed and totaled. Ties stand.", "The winner leads the next round at the same table.", "Another round needs everyone. If anyone leaves instead, the rest go back to the lobby with a seat open."] },
];

/** A quiet reference that slides in beside the table. */
export function HowToPlay({ open, onClose, onReplay }: { open: boolean; onClose: () => void; onReplay: () => void }) {
  const dialogRef = useModalFocus(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 outline-none animate-fade" role="dialog" aria-modal aria-label="How to play">
      <button type="button" tabIndex={-1} aria-hidden className="absolute inset-0 bg-black/60" onClick={onClose} />
      <aside className="animate-slide-in absolute inset-y-0 right-0 flex w-[380px] max-w-full flex-col bg-surface shadow-float">
        <header className="flex shrink-0 items-center justify-between gap-4 px-5 pt-5 pb-4 sm:px-6">
          <h2 className="t-headline">How to play</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 sm:px-6">
          {SECTIONS.map((s) => (
            <section key={s.title} className="border-t border-line py-4">
              <h3 className="t-caption text-ink-3">{s.title}</h3>
              <ul className="mt-2 space-y-1.5">
                {s.lines.map((l) => <li key={l} className="t-sub text-ink-2">{l}</li>)}
              </ul>
            </section>
          ))}
          <div className="border-t border-line pt-5">
            <Button variant="secondary" size="sm" onClick={onReplay}>Show walkthrough again</Button>
          </div>
        </div>
      </aside>
    </div>
  );
}
