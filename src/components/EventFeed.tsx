"use client";

import { useEffect, useRef } from "react";
import type { LogEntry } from "@/lib/game/types";

export function EventFeed({ log }: { log: LogEntry[] }) {
  const ref = useRef<HTMLOListElement>(null);
  const lastSeq = log[log.length - 1]?.seq;
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [lastSeq]);
  return (
    <aside className="flex min-h-0 min-w-0 flex-col rounded-panel bg-surface hairline" aria-label="table log">
      <header className="px-4 pt-4 pb-3">
        <h3 className="t-headline">Table log</h3>
      </header>
      {log.length === 0 ? (
        <p className="t-sub px-4 pb-5 text-ink-3">Quiet so far. Moves show up here as they happen.</p>
      ) : (
        <ol ref={ref} className="flex-1 space-y-2 overflow-y-auto px-4 pb-5">
          {log.map((e) => (
            <li
              key={e.seq}
              className={[
                "t-sub animate-fade",
                e.tone === "accent" ? "font-medium text-accent-ink" : e.tone === "bad" ? "text-ink" : e.tone === "good" ? "text-ink" : "text-ink-2",
              ].join(" ")}
            >
              {e.text}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
