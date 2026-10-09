/**
 * externalLink.ts — the one guard for payload-supplied URLs rendered as links.
 *
 * Link data travels from third-party curations (ClinGen dosage reports, dbNSFP provenance) and
 * the app's own backend into `href`s. `new URL()` parses, then only http(s) survives. Everything
 * else — `javascript:`, `data:`, whitespace-padded schemes — renders as inert text, never as a
 * click target. Mirrors `reportReferenceUrl` in `reportDocument.ts` for the non-report surfaces.
 */
export function safeExternalHref(value: string | null | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
