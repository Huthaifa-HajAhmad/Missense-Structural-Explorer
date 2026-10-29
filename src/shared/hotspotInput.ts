import type { AnalysisResult } from "./contracts.ts";
import { isBroadAnnotation, type FunctionEvidence } from "./functionEvidence.ts";
import type { HotspotContext, HotspotInput } from "./hotspotEvidence.ts";
import { nativeInterfaceSupport } from "./interfacesEvidence.ts";

/** The store's slot for a read, as the view and the rail see it. */
export type HotspotLoad = { status: "loading" | "ready" | "error"; data: unknown; error?: string } | undefined;

/**
 * The one reading of an analysis result and its hot-spot slot into `buildHotspotEvidence`'s input, shared by the
 * tab and the rail so both see the same load state, engine record and added columns (the way
 * `functionEvidenceInputFrom` serves the Functional domains model).
 *
 * The extra columns come from what the analysis already holds, so nothing is fetched for them:
 *   - UniProt sites and modifications, from the Functional domains model, with the same evidence label and the
 *     same "a span a third of the chain wide is context, not a site" rule it applies at the queried residue;
 *   - native PDBe-KB interface support, from the assembly the pipeline stored (a payload that predates
 *     per-residue support reads as not read, never as no interface).
 */
export function hotspotInputFrom(result: AnalysisResult, fn: FunctionEvidence, load: HotspotLoad, engineCriteria: HotspotInput["engineCriteria"]): HotspotInput {
  const annotations = fn.availability.state === "ok"
    ? fn.rows
      .filter((r) => (r.group === "sites" || r.group === "modifications") && !isBroadAnnotation(r, fn.length))
      .map((r) => ({ start: r.start, end: r.end, isPair: r.isPair, name: r.name, evidence: r.evidenceLabel }))
    : null;
  return {
    context: load?.status === "ready" ? (load.data as HotspotContext) : null,
    loadState: load?.status === "error" ? "error" : load?.status === "ready" ? "ready" : "loading",
    loadError: load?.error ?? null,
    residue: fn.residue,
    residueLabel: fn.residueLabel,
    engineCriteria,
    annotations,
    interfaces: nativeInterfaceSupport((result as { multimerData?: Parameters<typeof nativeInterfaceSupport>[0] }).multimerData ?? null, result.metadata?.gene ?? fn.gene ?? "This protein"),
  };
}
