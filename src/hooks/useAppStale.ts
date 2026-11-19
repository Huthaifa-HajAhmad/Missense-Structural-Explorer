import { useEffect, useSyncExternalStore } from "react";
import { appVersionWatch } from "../lib/appVersionWatch";

/** How often a visible page asks the server for its version. */
export const VERSION_CHECK_INTERVAL_MS = 5 * 60_000;

/**
 * Whether the server has been updated since this page loaded. Reads the version when the app starts
 * (which records the version this page loaded with), whenever the tab becomes visible again, and every
 * few minutes while it is. Requests the server refuses as malformed also trigger a check
 * (`fetchWithAuth`), so a mismatch is named as an out-of-date page rather than left as an error.
 */
export function useAppStale(): boolean {
  useEffect(() => {
    void appVersionWatch.check();
    const onVisible = () => { if (document.visibilityState === "visible") void appVersionWatch.check(); };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(onVisible, VERSION_CHECK_INTERVAL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);
  return useSyncExternalStore(appVersionWatch.subscribe, appVersionWatch.isStale);
}
