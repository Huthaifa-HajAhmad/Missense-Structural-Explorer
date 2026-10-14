import { useEffect } from "react";
import { subscribeCredentialUse } from "../api/authSession";
import { useVariantAnalysisStore } from "../context/VariantAnalysisContext";
import { credentialUseSentence, type CredentialUse } from "../shared/credentials";

/** The same use ("Biohub on your token") is not repeated for this long. */
export const CREDENTIAL_NOTICE_QUIET_MS = 30 * 60_000;
/** A refusal (no token was used) is repeated sooner: it is something the reader can fix. */
export const CREDENTIAL_REFUSAL_QUIET_MS = 5 * 60_000;

function noticeKey(use: CredentialUse): string {
  return `${use.kind}:${use.source}:${use.refusal ?? ""}`;
}

/**
 * The uses worth a notice now, each with its sentence. Records the ones it returns in `lastShown`.
 * Pure apart from that map, so it is tested directly.
 */
export function usesToAnnounce(
  uses: readonly CredentialUse[],
  lastShown: Map<string, number>,
  now: number
): { use: CredentialUse; sentence: string }[] {
  const out: { use: CredentialUse; sentence: string }[] = [];
  for (const use of uses) {
    const sentence = credentialUseSentence(use);
    if (!sentence) continue;
    const quiet = use.source === "none" ? CREDENTIAL_REFUSAL_QUIET_MS : CREDENTIAL_NOTICE_QUIET_MS;
    const key = noticeKey(use);
    if (now - (lastShown.get(key) ?? -Infinity) < quiet) continue;
    lastShown.set(key, now);
    out.push({ use, sentence });
  }
  return out;
}

/**
 * After a result that called Biohub, Hugging Face or Tamarind, says whose token it ran on ("your token"
 * or "the team token"), or why it did not run (WP-I4). All are information: nothing failed that the
 * reader must act on now, and the alert-banner preference still applies.
 */
export function useCredentialUseNotice(): void {
  const addNotification = useVariantAnalysisStore(s => s.addNotification);
  useEffect(() => {
    const lastShown = new Map<string, number>();
    return subscribeCredentialUse(report => {
      for (const { use, sentence } of usesToAnnounce(report.uses, lastShown, report.at)) {
        addNotification("info", sentence);
      }
    });
  }, [addNotification]);
}
