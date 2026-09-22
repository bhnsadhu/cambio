"use client";

import { useStoredProfile } from "./profile";
import { useState, useSyncExternalStore } from "react";
import { getServerStoredName, getStoredName, subscribeStoredName } from "./session";

/** A name field that starts from the last name used on this device. */
export function useStoredName(): [string, (v: string) => void] {
  const profile = useStoredProfile();
  const stored = useSyncExternalStore(subscribeStoredName, getStoredName, getServerStoredName);
  const [typed, setTyped] = useState<string | null>(null);
  return [profile?.profile.displayName ?? typed ?? stored, setTyped];
}
