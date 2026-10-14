import { useEffect } from "react";
import { subscribeStaleData } from "../api/authSession";
import { useVariantAnalysisStore } from "../context/VariantAnalysisContext";
import { staleDataSentence, type StaleDataNote } from "../shared/providerLimits";

/** Data already named in a notice is not named again for this long. */
export const STALE_NOTICE_QUIET_MS = 5 * 60_000;

/**
 * The notes worth a notice now: data not named in the last {@link STALE_NOTICE_QUIET_MS}.
 * Records the ones it returns in `lastShown`. Pure apart from that map, so it is tested directly.
 */
export function notesToAnnounce(
  notes: readonly StaleDataNote[],
  lastShown: Map<string, number>,
  now: number
): StaleDataNote[] {
  const fresh = notes.filter(n => now - (lastShown.get(n.data) ?? -Infinity) >= STALE_NOTICE_QUIET_MS);
  for (const n of fresh) lastShown.set(n.data, now);
  return fresh;
}

/**
 * Tells the reader when a result used saved data past its expiry because a provider was limiting
 * requests (WP-I2): "Showing UniProt FASTA data saved 3 h ago; UniProt is limiting requests." The data
 * is still shown; the notice says how old it is and why nothing newer came back.
 */
export function useStaleDataNotice(): void {
  const addNotification = useVariantAnalysisStore(s => s.addNotification);
  useEffect(() => {
    const lastShown = new Map<string, number>();
    return subscribeStaleData(report => {
      const fresh = notesToAnnounce(report.notes, lastShown, report.at);
      if (fresh.length > 0) addNotification("info", staleDataSentence(fresh));
    });
  }, [addNotification]);
}
