"use client";

import { useEffect, useRef } from "react";
import type { LogEntry } from "@/lib/game/types";

export function EventFeed({ log }: { log: LogEntry[] }) {
  const ref = useRef<HTMLOListElement>(null);
  const lastSeq = log[log.length - 1]?.seq;
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastSeq]);
  return (
    <aside className="flex min-h-0 flex-col rounded-panel bg-surface hairline" aria-label="table log">
      <header className="px-5 pt-4 pb-3">
        <h3 className="text-[15px] font-medium">What happened</h3>
      </header>
      <ol ref={ref} className="flex-1 space-y-2 overflow-y-auto px-5 pb-5">
        {log.map((e) => (
          <li
            key={e.seq}
            className={[
              "text-[13px] leading-snug animate-fade",
              e.tone === "accent" ? "font-medium text-accent-ink" : e.tone === "bad" ? "text-red" : e.tone === "good" ? "text-ink" : "text-ink-2",
            ].join(" ")}
          >
            {e.text}
          </li>
        ))}
      </ol>
    </aside>
  );
}
