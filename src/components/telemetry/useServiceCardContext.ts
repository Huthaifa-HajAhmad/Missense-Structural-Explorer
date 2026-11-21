import { useEffect, useState, useSyncExternalStore } from "react";
import { useDiagnostics } from "../../hooks/useDiagnostics";
import { useSettings } from "../../context/SettingsContext";
import type { useApiConnections } from "../../hooks/useApiConnections";
import { getAuthLapse, subscribeAuthLapse } from "../../api/authSession";
import { isReadingStale } from "./serviceSummary";
import type { ServiceCardContext } from "./serviceCardModel";

type GeminiLink = Pick<ReturnType<typeof useApiConnections>, "linking" | "linkError" | "linkGeminiKey">;

/**
 * Everything a service row needs to say how its service is doing, read once for every surface that
 * shows service rows (the Analysis monitor's status panel and Settings → Connections), so they agree.
 *
 * `gemini` is the caller's own connection state, so a Gemini key linked on that surface shows on its row.
 */
export function useServiceCardContext({ configure, gemini }: {
  configure: ServiceCardContext["configure"];
  gemini: GeminiLink;
}) {
  const { diagnostics, capabilities, loading, refresh, checkedAt, lastCheckFailed, coveragePending } = useDiagnostics({ live: true });
  const { settings, serverGeminiReady } = useSettings();
  const authLapse = useSyncExternalStore(subscribeAuthLapse, getAuthLapse, getAuthLapse);

  /** Moves the states that change with the clock: the Gemini session countdown and the reading's age. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const isLoaded = Boolean(diagnostics);
  const ctx: ServiceCardContext = {
    diagnostics,
    capabilities,
    settings,
    serverGeminiReady,
    authLost: authLapse !== null,
    linking: gemini.linking,
    linkError: gemini.linkError,
    linkGeminiKey: gemini.linkGeminiKey,
    now,
    isLoaded,
    isChecking: !isLoaded && loading,
    noReadout: !isLoaded && !loading,
    coveragePending: Boolean(coveragePending),
    refresh,
    configure
  };

  // When the reading was taken, for the opened rows.
  const sweptAt = diagnostics?.timestamp ? new Date(diagnostics.timestamp) : null;
  const sweptAtLabel = sweptAt && !isNaN(sweptAt.getTime())
    ? sweptAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return {
    ctx,
    /**
     * A check that failed before any reading arrived is "could not check", not "every service is down",
     * so the reading's age is not the only thing that makes it out of date.
     */
    stale: isReadingStale(lastCheckFailed, checkedAt, now),
    sweptAtLabel,
    checkedAt,
    now,
    loading,
    refresh
  };
}
