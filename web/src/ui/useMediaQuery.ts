import { useCallback, useSyncExternalStore } from "react";

/** Whether a media query matches, kept up to date as the window changes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

/** Below this width the panels leave the screen and open as bottom sheets (index.css). */
export const MOBILE_QUERY = "(max-width: 759px)";
