"use client";

import { useEffect, useState } from "react";
import { useModalFocus } from "@/lib/client/useModalFocus";
import { CardBack, FaceCard } from "./cards";
import { Button } from "./ui";

/**
 * First time on a table: four short steps, each with the real pieces.
 * Skippable at any point. Reopens from "How to play".
 */
const STEPS = [
  {
    title: "Lowest hand wins.",
    body: "Everyone gets four cards, face down. Remember what you have seen and try to finish with the lowest total.",
    art: <Art1 />,
  },
  {
    title: "Look once. Then remember.",
    body: "At the start you get five seconds with your bottom two cards. After that, your hand stays face down unless a power lets you peek.",
    art: <Art2 />,
  },
  {
    title: "Powers fire when you place.",
    body: "Draw, then place the card on the pile or swap it into any hand at the table. Swap into someone else's hand to leave them holding it. A placed 7, 8, 9, 10, jack, queen or black king does something. A swapped one does not.",
    art: <Art3 />,
  },
  {
    title: "Stick any time.",
    body: "When a card lands on the pile, select any card you believe matches it, in anyone's hand. Right, and it leaves the game. Wrong, and you draw a penalty. When your hand looks low, call Cambio at the start of your turn. Everyone else gets one last turn.",
    art: <Art4 />,
  },
];

export function Explainer({ onDone, onRules }: { onDone: () => void; onRules?: () => void }) {
  const dialogRef = useModalFocus();
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone();
      if (e.key === "ArrowRight") { e.preventDefault(); setI((x) => (x === STEPS.length - 1 ? x : x + 1)); }
      if (e.key === "ArrowLeft") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 outline-none animate-fade" role="dialog" aria-modal aria-label="How Cambio works">
      <div className="max-h-[calc(100dvh-32px)] w-full max-w-[560px] animate-rise overflow-y-auto rounded-panel bg-surface shadow-float hairline">
        <div className="flex h-[180px] items-center justify-center rounded-t-panel bg-bg px-4 sm:h-[220px]" key={i}>
          <div className="animate-pop">{step.art}</div>
        </div>
        <div className="min-h-[236px] px-5 pt-6 pb-7 sm:px-8">
          <p className="t-caption text-ink-3">{i + 1} of {STEPS.length}</p>
          <h2 className="t-title2 mt-2" key={`t${i}`}>{step.title}</h2>
          <p className="t-body mt-2 text-ink-2" key={`b${i}`}>{step.body}</p>
          {onRules ? <button type="button" onClick={onRules} className="t-sub mt-3 font-medium text-ink-2 hover:text-ink">Read full rules</button> : null}
          <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5" aria-hidden>
              {STEPS.map((_, k) => (
                <span key={k} className={`h-1.5 rounded-full transition-all duration-200 ease-out ${k === i ? "w-5 bg-ink" : "w-1.5 bg-line-strong"}`} />
              ))}
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {!last ? <Button variant="ghost" onClick={onDone}>Skip</Button> : null}
              {i > 0 ? <Button variant="secondary" onClick={() => setI(i - 1)}>Back</Button> : null}
              {last ? (
                <Button variant="primary" onClick={onDone}>Got it</Button>
              ) : (
                <Button variant="primary" onClick={() => setI(i + 1)}>Next</Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Art1() {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {[0, 1, 2, 3].map((k) => <CardBack key={k} size="md" />)}
    </div>
  );
}

function Art2() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="grid grid-cols-2 gap-2.5">
        <CardBack size="md" />
        <CardBack size="md" />
        <FaceCard size="md" card={{ id: "x1", rank: "7", suit: "S" }} />
        <FaceCard size="md" card={{ id: "x2", rank: "K", suit: "H" }} />
      </div>
      <div className="h-[3px] w-[122px] overflow-hidden rounded-full bg-line-strong">
        <div className="h-full origin-left rounded-full bg-ink" style={{ animation: "countdown 4s linear infinite" }} />
      </div>
    </div>
  );
}

function Art3() {
  return (
    <div className="flex items-center gap-3 sm:gap-5">
      <CardBack size="md" className="opacity-60" />
      <span className="t-sub text-ink-3">Place</span>
      <div className="flex max-w-[124px] flex-col items-center gap-2">
        <FaceCard size="md" card={{ id: "x3", rank: "8", suit: "D" }} className="shadow-lift" />
        <span className="rounded-full bg-ink px-2 py-1 text-center text-[11px] leading-4 font-medium text-bg">Peek at one of yours</span>
      </div>
    </div>
  );
}

function Art4() {
  return (
    <div className="flex items-center gap-4 sm:gap-6">
      <div className="relative">
        <CardBack size="md" className="-translate-y-1.5 shadow-lift" />
        <span className="absolute inset-x-0 -bottom-1 rounded-b-[8px] bg-bg/95 py-0.5 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-ink">Stick</span>
      </div>
      <span className="t-sub text-ink-3">Matches</span>
      <FaceCard size="md" card={{ id: "x4", rank: "7", suit: "C" }} />
    </div>
  );
}
