import type React from "react";
import type { CapabilitiesData, DiagnosticsData } from "../../types/diagnostics";
import type { UserSettings } from "../../types/ui";
import type { ProviderState } from "../../shared/providerStatus";

/** One "label — value" line inside an opened row. `info` is a plain fact, not a state. */
export interface ServiceDetailRow {
  label: string;
  value: string;
  tone?: "ready" | "warming" | "absent" | "info";
}

/**
 * What a row means when opened. The closed row only has room for a status word, so every row can open:
 * a reader is never left with a word and no way to find out whether they must act.
 */
export interface ServiceExplanation {
  heading: string;
  body: string;
}

/**
 * Why a row needs a closer look, beyond its state word. At most one applies.
 * - `needs-action`: the reader must do something (the only one that pulses).
 * - `covered`: the main service is down and a live fallback is answering.
 * - `outage`: every tier answered that it cannot serve.
 * - `warming`: a cold start that resolves by itself.
 * - `unknown`: the main service is down and the fallback could not be checked; not a confirmed outage.
 */
export type ServiceEmphasis = "needs-action" | "covered" | "outage" | "warming" | "unknown";

export interface ServiceStatusCard {
  id: string;
  name: string;
  category: "genomic" | "compute" | "literature";
  description: string;
  /** The one truth about this row. Its word, the header count and the header tone all come from it. */
  state: ProviderState;
  emphasis?: ServiceEmphasis;
  /** True when the row's state comes from this browser's settings rather than from the server's probe. */
  localState?: boolean;
  latency?: number | string | null;
  tag?: string;
  /** Extra detail for the row's tooltip, such as how old a coverage verdict is. */
  detail?: string;
  actionIcon?: React.ReactNode;
  /** The action's name: the drawer button's text, or the overlay button's name on a row that cannot open. */
  actionLabel?: string;
  onAction?: () => void;
  explain?: ServiceExplanation;
  detailRows?: ServiceDetailRow[];
}

/** Everything a row needs to work out what to say. */
export interface ServiceCardContext {
  diagnostics: DiagnosticsData | null;
  capabilities: CapabilitiesData | null;
  settings: UserSettings;
  serverGeminiReady: boolean;
  authLost: boolean;
  linking: boolean;
  linkError: string | null;
  linkGeminiKey: () => void;
  now: number;
  isLoaded: boolean;
  /** No reading yet, and one is on its way. */
  isChecking: boolean;
  /** The request finished with no reading, so no row may claim anything about setup. */
  noReadout: boolean;
  coveragePending: boolean;
  refresh: () => void;
  configure: (tab?: "connections" | "api") => void;
}

export const CHECKING_EXPLAIN: ServiceExplanation = {
  heading: "Checking now",
  body: "This service is being checked. The row updates when the check finishes."
};

/** For a row the server said nothing about: "working" or "not answering" would invent a probe result. */
export const NOT_REPORTED_EXPLAIN: ServiceExplanation = {
  heading: "Status not reported",
  body:
    "The server has not reported on this service, so its state is not known yet. " +
    "Re-check the service status to ask again."
};

export const OUT_OF_DATE_EXPLAIN: ServiceExplanation = {
  heading: "This reading is out of date",
  body:
    "The app could not re-check this service, so this row cannot say how it is doing now. " +
    "It updates by itself at the next successful check, or you can re-check the services now."
};

/** The shared ladder for a row whose state comes straight from one probe. */
export function probeState(ctx: ServiceCardContext, ready: boolean, reported: boolean): ProviderState {
  if (ctx.isChecking) return "checking";
  if (ready) return "connected";
  if (reported || ctx.noReadout) return "unreachable";
  return "not-configured";
}

export function formatLatency(ms?: number | null): string | null {
  if (typeof ms !== "number" || isNaN(ms) || ms < 0) return null;
  return ms < 1 ? "< 1ms" : `${Math.round(ms)}ms`;
}
