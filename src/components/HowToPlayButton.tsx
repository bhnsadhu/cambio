"use client";

import { useCallback, useState } from "react";
import { setPref, usePrefs } from "@/lib/client/prefs";
import { Explainer } from "./Explainer";
import { HowToPlay } from "./HowToPlay";
import { Button } from "./ui";

/** The same introduction and rules, wherever someone needs a reminder. */
export function HowToPlayButton({ introduce = false }: { introduce?: boolean }) {
  const prefs = usePrefs();
  const [screen, setScreen] = useState<"walkthrough" | "rules" | null>(null);
  const walkthrough = screen === "walkthrough" || (screen === null && introduce && prefs.onboarded !== true);
  const closeWalkthrough = useCallback(() => {
    setPref("onboarded", true);
    setScreen(null);
  }, []);
  const readRules = useCallback(() => {
    setPref("onboarded", true);
    setScreen("rules");
  }, []);
  const closeRules = useCallback(() => setScreen(null), []);
  const replay = useCallback(() => setScreen("walkthrough"), []);

  return <>
    <Button
      variant="ghost"
      size="sm"
      aria-haspopup="dialog"
      aria-expanded={walkthrough || screen === "rules"}
      onClick={() => setScreen(prefs.onboarded === true ? "rules" : "walkthrough")}
    >How to play</Button>
    {walkthrough ? <Explainer onDone={closeWalkthrough} onRules={readRules} /> : null}
    <HowToPlay open={screen === "rules"} onClose={closeRules} onReplay={replay} />
  </>;
}
