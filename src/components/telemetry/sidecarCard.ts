import type { ProviderState } from "../../shared/providerStatus";
import {
  CHECKING_EXPLAIN,
  NOT_REPORTED_EXPLAIN,
  formatLatency,
  type ServiceCardContext,
  type ServiceDetailRow,
  type ServiceExplanation,
  type ServiceStatusCard
} from "./serviceCardModel";

const ENGINE_ROWS: Array<[string, string]> = [
  ["thermompnn", "Stability prediction (ThermoMPNN)"],
  ["stabilityoracle", "Structure stability (StabilityOracle)"],
  ["saprot", "Structure-aware language model (SaProt)"]
];

/** Per-model lines, only from what the server reported. An engine it did not report is left out. */
function sidecarDetailRows(ctx: ServiceCardContext): ServiceDetailRow[] {
  const statusOf = (id: string) => ctx.capabilities?.engines?.find(e => e.id === id)?.status;
  const rows: ServiceDetailRow[] = [];
  for (const [id, label] of ENGINE_ROWS) {
    const status = statusOf(id);
    if (!status) continue;
    rows.push({
      label,
      value: status === "ready" ? "Available" : status === "warming_up" ? "Still loading" : "Not available",
      tone: status === "ready" ? "ready" : status === "warming_up" ? "warming" : "absent"
    });
  }
  const japanFold = statusOf("japanfold");
  if (japanFold) {
    rows.push({
      label: "Cloud structure folding (JapanFold)",
      value: japanFold === "ready" ? "Available" : "Not available",
      tone: japanFold === "ready" ? "ready" : "absent"
    });
  }
  rows.push({ label: "Technical name", value: "Python ML sidecar", tone: "info" });
  return rows;
}

function sidecarExplain(state: ProviderState, warming: boolean, ready: boolean): ServiceExplanation {
  if (state === "checking") return CHECKING_EXPLAIN;
  if (state === "not-configured") return NOT_REPORTED_EXPLAIN;
  // The sidecar reports only "warming up", not how far along, so no estimate is offered: it would be invented.
  if (warming) {
    return {
      heading: "Not broken — just starting up",
      body:
        "Some prediction models are loading into memory. This can happen when the service " +
        "starts; the service has not reported how long remains. You " +
        "can keep reading evidence and results now; stability and structure predictions will " +
        "become available as each model finishes loading successfully."
    };
  }
  if (ready) {
    return {
      heading: "Ready",
      body:
        "The prediction service is responding. Check the model-specific status below for availability. Predictions run " +
        "on demand — the first one after startup may take a little longer than the rest."
    };
  }
  return {
    heading: "Not running",
    body:
      "The local prediction service could not be reached on the last check. Local predictions " +
      "may be unavailable; cloud availability is listed below. Re-check the service status, " +
      "and check the connection settings if it remains unavailable."
  };
}

/**
 * The sidecar's health endpoint answers from the moment its web server binds, up to about 180 s before
 * its model weights are usable. That window is its own state: amber, not counted online, and named.
 */
export function sidecarCard(ctx: ServiceCardContext): ServiceStatusCard {
  const { diagnostics, capabilities } = ctx;
  const health = diagnostics?.serviceHealth?.sidecar;
  const warming =
    diagnostics?.modelServerState === "warming_up" ||
    health?.state === "warming_up" ||
    capabilities?.engines?.some(e => (e.id === "thermompnn" || e.id === "stabilityoracle") && e.status === "warming_up") === true;
  const ready = !warming && Boolean(diagnostics?.modelServerReady || health?.healthy);
  const japanFoldReady = capabilities?.engines?.find(e => e.id === "japanfold")?.status === "ready";
  // Without any record, "not running" would be a claim about a probe that never reported.
  const reported = Boolean(health) || typeof diagnostics?.modelServerReady === "boolean" || diagnostics?.modelServerState !== undefined;
  const state: ProviderState = ctx.isChecking
    ? "checking"
    : warming
    ? "degraded"
    : ready
    ? "connected"
    : japanFoldReady
    ? "degraded"
    : reported || ctx.noReadout
    ? "unreachable"
    : "not-configured";
  return {
    id: "sidecar",
    name: "AI prediction models / JapanFold",
    category: "compute",
    description: state === "checking"
      ? "Protein language & stability models"
      : warming
      ? "Starting up — some models are loading; check individual availability"
      : state === "degraded"
      ? "Local models unavailable · JapanFold cloud serving"
      : state === "connected"
      ? "Protein language & stability models · predictions ready"
      : "Protein language & stability models",
    state,
    emphasis: warming ? "warming" : state === "degraded" ? "covered" : undefined,
    latency: formatLatency(health?.latencyMs ?? capabilities?.system?.sidecarLatencyMs),
    explain: sidecarExplain(state, warming, ready),
    detailRows: sidecarDetailRows(ctx)
  };
}
