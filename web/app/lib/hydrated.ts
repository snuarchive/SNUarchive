import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * False during server rendering and hydration, true afterwards. Lets a
 * control stay usable without JavaScript and pick up its JS-only rules
 * (like a disabled submit button) once the page is interactive.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
