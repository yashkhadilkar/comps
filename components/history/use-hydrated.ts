import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

// False on the server and during hydration, true afterwards. Dates are grouped and formatted in the viewer's own
// time zone, which the server doesn't know, so those parts render only once this is true.
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
