"use client";

import { useStoredProfile } from "./profile";
import { useState, useSyncExternalStore } from "react";
import { getServerStoredName, getStoredName, subscribeStoredName } from "./session";
import { useGuestIdentity } from "./guest";

/** A name field that starts from the last name used on this device. */
export function useStoredName(fallback = ""): [string, (v: string) => void] {
  const profile = useStoredProfile();
  const guest = useGuestIdentity();
  const stored = useSyncExternalStore(subscribeStoredName, getStoredName, getServerStoredName);
  const [typed, setTyped] = useState<string | null>(null);
  return [profile?.profile.displayName ?? typed ?? guest?.name ?? (stored || fallback), setTyped];
}
