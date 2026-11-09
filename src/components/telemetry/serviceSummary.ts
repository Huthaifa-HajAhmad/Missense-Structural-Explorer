import { DIAGNOSTICS_POLL_MS } from "../../stores/diagnosticsStore";
import { alphagenomeCard, foldxCard, geminiCard, p2rankCard } from "./computeCards";
import { ensemblCard, myvariantCard, probeCard } from "./dataSourceCards";
import { sidecarCard } from "./sidecarCard";
import { OUT_OF_DATE_EXPLAIN, type ServiceCardContext, type ServiceStatusCard } from "./serviceCardModel";

/** The one-line health reading of the rail, for a parent that wants it elsewhere (a tab badge). */
export interface ServiceSummary {
  online: number;
  total: number;
  tone: "checking" | "danger" | "warn" | "ok";
  /**
   * The reading could not be renewed, so the count is not a statement about the services now.
   * A badge must show that rather than a fraction, which would read as "everything is down".
   */
  stale: boolean;
}

/** A reading this many polls old has missed its checks, for example after the computer slept. */
const STALE_AFTER_MS = DIAGNOSTICS_POLL_MS * 3;

export function isReadingStale(lastCheckFailed: boolean, checkedAt: number | null | undefined, now: number): boolean {
  return Boolean(lastCheckFailed) || (typeof checkedAt === "number" && now - checkedAt > STALE_AFTER_MS);
}

/**
 * A reading that could not be renewed cannot be quoted as a current one. A local-state row (Gemini) is
 * exempt while it reports something the browser knows for certain — a live session, a stored key — but
 * `unreachable` on such a row only ever comes from having no reading at all, so that one is marked.
 */
function markOutOfDate(card: ServiceStatusCard): ServiceStatusCard {
  if (!["connected", "degraded", "unreachable"].includes(card.state)) return card;
  if (card.localState && card.state !== "unreachable") return card;
  return { ...card, state: "stale", emphasis: undefined, explain: OUT_OF_DATE_EXPLAIN };
}

export function buildServiceCards(ctx: ServiceCardContext, stale: boolean): ServiceStatusCard[] {
  const cards = [
    ensemblCard(ctx),
    alphagenomeCard(ctx),
    myvariantCard(ctx),
    probeCard(ctx, "clinvar"),
    probeCard(ctx, "europepmc"),
    geminiCard(ctx),
    foldxCard(ctx),
    p2rankCard(ctx),
    sidecarCard(ctx),
    probeCard(ctx, "uniprot")
  ];
  return stale ? cards.map(markOutOfDate) : cards;
}

/** A row is available when something answered, or when it is set up and nothing says otherwise. */
const isAvailable = (card: ServiceStatusCard) => card.state === "connected" || card.state === "configured";

/** The header's count and tone, both read from the rows' states so they cannot disagree with them. */
export function summarizeServices(cards: ServiceStatusCard[], isLoaded: boolean, isChecking: boolean, stale: boolean): ServiceSummary {
  const online = isLoaded ? cards.filter(isAvailable).length : 0;
  const total = cards.length;
  const tone = isChecking
    ? "checking"
    : cards.some(card => card.state === "unreachable")
    ? "danger"
    : online < total
    ? "warn"
    : "ok";
  return { online, total, tone, stale };
}

export function ageLabel(checkedAt: number | null | undefined, now: number): string {
  if (typeof checkedAt !== "number") return "";
  const minutes = Math.floor((now - checkedAt) / 60_000);
  return minutes < 1 ? "less than a minute ago" : `${minutes} min ago`;
}

/** The tooltip on the header: what the number means, and how current it is. */
export function summaryTitle(cards: ServiceStatusCard[], summary: ServiceSummary, stale: boolean, age: string): string {
  if (summary.tone === "checking") return "Checking service reachability and engines…";
  if (stale) return `Could not re-check the services${age ? ` · last reading ${age}` : ""}`;
  const notes = [
    ...cards.filter(c => c.emphasis === "covered").map(c => `${c.name} primary did not answer — ${c.description}`),
    ...cards.filter(c => c.emphasis === "outage").map(c => `${c.name} and its fallback are both unreachable`),
    ...cards.filter(c => c.emphasis === "unknown").map(c => `${c.name} primary did not answer and its fallback could not be verified`),
    ...cards.filter(c => c.emphasis === "warming").map(c => `${c.name} is still starting up`),
    ...cards.filter(c => c.state === "configured").map(c => `${c.name} is set up in this browser but has not been checked`)
  ];
  const head = notes.length > 0
    ? `${summary.online} of ${summary.total} services online — ${notes.join(" — ")}`
    : `${summary.online} of ${summary.total} services online and responsive`;
  return age ? `${head} · checked ${age}` : head;
}

export function summaryLabel(cards: ServiceStatusCard[], summary: ServiceSummary, stale: boolean, age: string): string {
  if (summary.tone === "checking") return "Checking services…";
  if (stale) return age ? `Could not re-check · last reading ${age}` : "Could not re-check";
  if (summary.tone === "ok") return `All ${summary.total} services online`;
  const covered = cards.filter(c => c.emphasis === "covered").length;
  return covered > 0 ? `${summary.online}/${summary.total} online · ${covered} on fallback` : `${summary.online}/${summary.total} online`;
}
