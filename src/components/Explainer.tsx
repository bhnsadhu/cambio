"use client";

import { useEffect, useState } from "react";
import { CardBack, FaceCard } from "./cards";
import { Button } from "./ui";

/**
 * First time on a table: four short steps, each with the real pieces.
 * Skippable at any point. Reopens from "How to play".
 */
const STEPS = [
  {
    title: "Your cards stay face down.",
    body: "Four each. You will not see them again after the start, so memory is the whole game.",
    art: <Art1 />,
  },
  {
    title: "Look once. Then remember.",
    body: "At the start you get ten seconds with your bottom two cards. After that, every card on the table is face down.",
    art: <Art2 />,
  },
  {
    title: "Powers fire when you place.",
    body: "Draw, then place the card on the pile or swap it into your hand. A placed 7, 8, 9, 10, jack, queen or black king does something. A swapped one does not.",
    art: <Art3 />,
  },
  {
    title: "Stick any time.",
    body: "When a card lands on the pile, click any card you believe matches it, in anyone's hand. Right, and it leaves the game. Wrong, and you draw a penalty.",
    art: <Art4 />,
  },
];

export function Explainer({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone();
      if (e.key === "ArrowRight" || e.key === "Enter") setI((x) => (x === STEPS.length - 1 ? x : x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 animate-fade" role="dialog" aria-modal aria-label="How Cambio works">
      <div className="w-full max-w-[560px] animate-rise overflow-hidden rounded-panel bg-surface shadow-float hairline">
        <div className="flex h-[220px] items-center justify-center bg-bg" key={i}>
          <div className="animate-pop">{step.art}</div>
        </div>
        <div className="min-h-[236px] px-8 pt-6 pb-7">
          <p className="t-caption text-ink-3">{i + 1} of {STEPS.length}</p>
          <h2 className="t-title2 mt-2" key={`t${i}`}>{step.title}</h2>
          <p className="t-body mt-2 text-ink-2" key={`b${i}`}>{step.body}</p>
          <div className="mt-7 flex items-center justify-between">
            <div className="flex items-center gap-1.5" aria-hidden>
              {STEPS.map((_, k) => (
                <button key={k} type="button" onClick={() => setI(k)} className={`h-1.5 rounded-full transition-all duration-200 ease-out ${k === i ? "w-5 bg-ink" : "w-1.5 bg-line-strong hover:bg-ink-3"}`} />
              ))}
            </div>
            <div className="flex items-center gap-2">
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
    <div className="flex items-center gap-5">
      <CardBack size="md" className="opacity-60" />
      <span className="t-sub text-ink-3">place</span>
      <div className="flex flex-col items-center gap-2">
        <FaceCard size="md" card={{ id: "x3", rank: "8", suit: "D" }} className="shadow-lift" />
        <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-medium text-bg">Peek at one of yours</span>
      </div>
    </div>
  );
}

function Art4() {
  return (
    <div className="flex items-center gap-6">
      <div className="relative">
        <CardBack size="md" className="-translate-y-1.5 shadow-lift" />
        <span className="absolute inset-x-0 -bottom-1 rounded-b-[8px] bg-bg/95 py-0.5 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-ink">Stick</span>
      </div>
      <span className="t-sub text-ink-3">matches</span>
      <FaceCard size="md" card={{ id: "x4", rank: "7", suit: "C" }} />
    </div>
  );
}
