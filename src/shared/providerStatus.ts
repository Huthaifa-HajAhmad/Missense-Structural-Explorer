/**
 * providerStatus.ts — the one vocabulary for how a data PROVIDER or a local SERVICE is reported on
 * the Services rail (src/components/telemetry/LiveTelemetryPanel.tsx).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THESE WORDS DESCRIBE
 * ─────────────────────────────────────────────────────────────────────────────
 * A health probe or a configuration. They say whether a provider answered the last check, whether a
 * verified fallback is covering for it, or whether it has been set up at all. They do NOT describe a
 * computation. A computed result, an engine run or a per-variant outcome is named by
 * ENGINE_STATE_LABELS in engineStatus.ts. Keeping the two vocabularies apart stops a reachability
 * probe from being rendered as if it were a verdict about a variant.
 *
 * "Offline" and "Standby" stay retired. Each was used for several different situations (not set up,
 * not answering, not yet probed, coverage unverified), so neither said which one was true. Each
 * situation now has its own state. The detail the old pills carried (transport, key source, the
 * fallback's name, latency) belongs in the row's sub-line, not in a new word.
 *
 * The module is pure and imports nothing, so server and client can both use it.
 */

export const PROVIDER_STATE_LABELS = {
  /** Something answered: the last probe, or a live session or key the server holds. */
  connected: "Connected",
  /** Set up in this browser (a key or an endpoint), and nothing has tested it yet. */
  configured: "Configured",
  /**
   * Not at full strength. A verified fallback is covering for a primary that did not answer, a local
   * component is installed but cannot run, or a credential has lapsed. It is also used where the probe
   * could not tell whether coverage exists, but only while the row's sub-line says the fallback is not
   * verified.
   */
  degraded: "Degraded",
  /** The health record says the service did not answer, or the server says it cannot serve. */
  unreachable: "Unreachable",
  /** Nothing is set up for it: no key, no URL, no installed program, or the server reported no record. */
  "not-configured": "Not configured",
  /** A probe is still in flight. */
  checking: "Checking",
  /** The last reading could not be renewed, so it cannot say how the service is doing now. */
  stale: "Out of date",
} as const;

export type ProviderState = keyof typeof PROVIDER_STATE_LABELS;
