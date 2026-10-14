import { useSyncExternalStore } from "react";

const never = () => () => {};

/** False on the server and during hydration, true from the first client render after it. */
export function useHydrated() {
  return useSyncExternalStore(never, () => true, () => false);
}
