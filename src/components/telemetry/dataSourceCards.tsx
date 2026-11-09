import React from "react";
import { RefreshCw } from "lucide-react";
import type { ProviderState } from "../../shared/providerStatus";
import type { ServiceHealthItem, FallbackVerdictKind } from "../../types/diagnostics";
import {
  CHECKING_EXPLAIN,
  NOT_REPORTED_EXPLAIN,
  formatLatency,
  probeState,
  type ServiceCardContext,
  type ServiceStatusCard
} from "./serviceCardModel";

const ENSEMBL_WORK =
  "Translates the genomic position you searched for into the matching transcript and " +
  "protein change, and checks the coordinates against the genome build. ";

/**
 * Ensembl is the first tier of a two-tier resolver, so its own health is not the whole answer: a dead
 * Ensembl does not mean coordinate translation is down. The server reports a `fallback` block only after
 * Ensembl has failed, so a down Ensembl can be covered, uncovered, unknown, or still waiting for a verdict.
 */
export function ensemblCard(ctx: ServiceCardContext): ServiceStatusCard {
  const health = ctx.diagnostics?.serviceHealth?.ensembl;
  const ready = Boolean(health?.healthy);
  // An unvalidated boundary: an older server can send `{}`, which must not read as "both tiers down".
  const fallback = health?.fallback && typeof health.fallback.healthy === "boolean" ? health.fallback : undefined;
  const verdict: FallbackVerdictKind | null = fallback ? fallback.verdict ?? (fallback.healthy ? "ready" : "unavailable") : null;
  const covered = Boolean(health && !ready && verdict === "ready");
  const uncovered = Boolean(health && !ready && verdict === "unavailable");
  // A probe that merely timed out is not an outage, and must not tell a clinician to switch notation.
  const unknown = Boolean(health && !ready && verdict === "unknown");
  const awaitingVerdict = Boolean(health && !ready && !fallback && ctx.coveragePending);

  const state: ProviderState = awaitingVerdict
    ? "checking"
    : covered || unknown
    ? "degraded"
    : probeState(ctx, ready, Boolean(health));
  const fallbackName = fallback?.name || "the fallback provider";
  const description = covered
    ? `Fallback ready — ${fallbackName} taking over`
    : uncovered
    ? "No fallback — no provider reachable; use p.Glu433Lys style notation"
    : unknown
    ? "Coverage unknown — fallback not verified; coordinate queries may still work"
    : ready
    ? "REST · VEP, coordinates & cDNA translation"
    : "VEP, coordinates & cDNA translation";
  // The age of the verdict, so an old claim is not presented as a current one.
  const detail = fallback
    ? [
        fallback.message,
        typeof fallback.ageMs === "number" && fallback.ageMs >= 0 ? `verified ${Math.round(fallback.ageMs / 1000)}s ago` : null,
        fallback.stale ? "no longer current" : null
      ].filter(Boolean).join(" — ")
    : undefined;

  const consequence = covered
    ? "The main service did not answer. A backup service responded to the health check; coverage for your specific variant still depends on that source."
    : uncovered
    ? "Searches that need this translation will not complete until it responds again. Anything already on screen is unaffected."
    : unknown
    ? "The main service did not answer and the backup could not be checked either. This is not confirmed as an outage — trying again may well succeed."
    : ready
    ? "Genomic coordinates and protein changes are resolving normally."
    : "The main service did not answer, and the server reported no backup check. Searches that need this translation may not complete until it responds again. Anything already on screen is unaffected.";

  return {
    id: "ensembl",
    name: "Ensembl VEP",
    category: "genomic",
    description,
    state,
    emphasis: covered ? "covered" : uncovered ? "outage" : unknown ? "unknown" : undefined,
    // While degraded, the latency that matters is the tier actually answering.
    latency: formatLatency(covered ? fallback?.latencyMs : health?.latencyMs),
    detail,
    actionIcon: ready ? undefined : <RefreshCw className="w-3.5 h-3.5" />,
    actionLabel: "Re-check Ensembl VEP and its fallback",
    onAction: ready ? undefined : () => ctx.refresh(),
    explain: state === "checking"
      ? CHECKING_EXPLAIN
      : state === "not-configured"
      ? NOT_REPORTED_EXPLAIN
      : {
          heading: covered
            ? "Answered by a backup service"
            : unknown
            ? "Could not be determined"
            : ready
            ? "Working normally"
            : "Not answering",
          body: ENSEMBL_WORK + consequence
        }
  };
}

export function myvariantCard(ctx: ServiceCardContext): ServiceStatusCard {
  const health = ctx.diagnostics?.serviceHealth?.myvariant;
  const local = ctx.diagnostics?.serviceHealth?.dbnsfp;
  const ready = Boolean(health?.healthy || local?.healthy);
  const state = probeState(ctx, ready, Boolean(health || local));
  const source = health?.healthy ? "REST" : local?.healthy ? "Local dbNSFP" : null;
  return {
    id: "myvariant",
    name: "MyVariant.info & dbNSFP",
    category: "genomic",
    description: source ? `${source} · REVEL, CADD, AlphaMissense, MetaRNN` : "REVEL, CADD, AlphaMissense, MetaRNN",
    state,
    latency: formatLatency(health?.latencyMs ?? local?.latencyMs),
    explain: explainProbe(state, ready, {
      working:
        "Supplies the published computational predictor scores you see in Evidence — REVEL, " +
        "CADD, AlphaMissense and others. Each score keeps its own name and citation.",
      down:
        "The published predictor scores are unavailable, so the Predictors view will be empty " +
        "for now. A search or a retry may succeed — this is usually temporary."
    })
  };
}

function explainProbe(state: ProviderState, ready: boolean, text: { working: string; down: string }) {
  if (state === "checking") return CHECKING_EXPLAIN;
  if (state === "not-configured") return NOT_REPORTED_EXPLAIN;
  return { heading: ready ? "Working normally" : "Not answering", body: ready ? text.working : text.down };
}

interface ProbeCardSpec {
  id: "clinvar" | "europepmc" | "uniprot";
  name: string;
  category: ServiceStatusCard["category"];
  transport: string;
  purpose: string;
  working: string;
  down: string;
}

const PROBE_CARDS: Record<ProbeCardSpec["id"], ProbeCardSpec> = {
  clinvar: {
    id: "clinvar",
    name: "NCBI ClinVar",
    category: "genomic",
    transport: "E-utilities",
    purpose: "Pathogenicity & VCV classifications",
    working:
      "Aggregates submitted clinical classifications of a variant. Submissions can disagree " +
      "or become outdated; review the condition, review status, dates and conflicts before " +
      "interpreting a classification. A ClinVar record does not by itself establish causality.",
    down:
      "Laboratory classifications are unavailable, so the Evidence view will not show how " +
      "this change has been classified elsewhere. Everything else still works."
  },
  europepmc: {
    id: "europepmc",
    name: "PubMed & Europe PMC",
    category: "literature",
    transport: "REST",
    purpose: "Literature search & citations",
    working:
      "Finds published papers about this gene or change, with their citations. Results are " +
      "screened for relevance before they are shown.",
    down:
      "Literature search is unavailable, so the Literature view will be empty. The evidence " +
      "from every other source is unaffected."
  },
  uniprot: {
    id: "uniprot",
    name: "UniProtKB",
    category: "genomic",
    transport: "API",
    purpose: "Sequences & functional domains",
    working:
      "Provides the protein's known functional regions and active sites, which is how the app " +
      "judges whether a change sits somewhere that matters. Domains and boundaries keep their " +
      "source and the residue numbers they were defined on.",
    down:
      "Functional regions and active sites are unavailable, so the app cannot yet say whether " +
      "this change falls inside a known functional region. Every other source of evidence is unaffected."
  }
};

/** A data source with one probe and nothing else to say. */
export function probeCard(ctx: ServiceCardContext, id: ProbeCardSpec["id"]): ServiceStatusCard {
  const spec = PROBE_CARDS[id];
  const health: ServiceHealthItem | undefined = ctx.diagnostics?.serviceHealth?.[id];
  const ready = Boolean(health?.healthy);
  const state = probeState(ctx, ready, Boolean(health));
  return {
    id,
    name: spec.name,
    category: spec.category,
    description: ready ? `${spec.transport} · ${spec.purpose}` : spec.purpose,
    state,
    latency: formatLatency(health?.latencyMs),
    explain: explainProbe(state, ready, spec)
  };
}
