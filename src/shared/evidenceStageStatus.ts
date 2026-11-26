import type { AnalysisResult } from "./contracts.ts";
import { serviceStatusOf } from "./serviceStatus.ts";
import { everyCandidateRead } from "./candidateFrequency.ts";
import { isFallbackLocus, fallbackCause, locusFailureKind, locusRecoveryAction } from "./locusResolution.ts";

type StageStatus = { status: "complete" | "progress" | "degraded"; desc: string };

const failed = (status: unknown) => status === "error" || status === "timeout";

/**
 * What the run learned from ClinVar. A failed or timed-out query delivered nothing, so it is never
 * worded as annotated evidence; an answered query with no record says so plainly. "Annotated" is kept
 * only for stored results from before the per-source status was recorded.
 */
function clinvarSummary(result: AnalysisResult, status: unknown): { text: string; failed: boolean } {
  if (failed(status)) return { text: "ClinVar did not answer on this run", failed: true };
  if (result.clinvar?.classification) return { text: `ClinVar: ${result.clinvar.classification}`, failed: false };
  if (status === "not_found") return { text: "ClinVar: No record", failed: false };
  return { text: "ClinVar: Annotated", failed: false };
}

/**
 * Population limits that leave the stage partial. The local stand-in (gnomAD did not answer, so the
 * local copy was read) carries only the combined frequency: no ancestry groups and no FAF95, so the
 * frequency rules ran on less than a live gnomAD record gives them.
 */
function populationIssue(result: AnalysisResult, status: unknown): string | null {
  if (failed(status)) return "gnomAD did not answer on this run · population evidence incomplete — re-run to retry";
  if (status === "stand-in" || result.gnomadFrequency?.standIn) {
    return "gnomAD from the local combined copy — no ancestry groups or FAF95";
  }
  return null;
}

/**
 * The Evidence row of the run monitor. Every missing source is named, and one problem never hides
 * another: the row lists them all, joined by "·".
 */
export function evidenceStageStatus(result: AnalysisResult, loading: boolean, tabsLoading: readonly string[]): StageStatus {
  if (loading) {
    return {
      status: "progress",
      // Evidence that ARRIVED: a source that failed or timed out has delivered nothing to be "available".
      desc: Object.values(serviceStatusOf(result) ?? {}).some(status => status === "ok")
        ? "Partial evidence available · Remaining sources loading"
        : "Querying ClinVar, gnomAD, and predictors..."
    };
  }
  // A protein change with several candidate alleles has no single locus, but gnomAD is still read
  // once per candidate. Only when every candidate was answered (found, or confirmed absent) was
  // the population evidence assessed; a failed or skipped query leaves no frequency criterion.
  const candidatesRead = locusFailureKind(result) === "multiple-candidates"
    && everyCandidateRead(result.gnomadFrequency?.candidates ?? []);
  const unassessed = isFallbackLocus(result) && !candidatesRead;
  const services = serviceStatusOf(result);
  const clinvar = clinvarSummary(result, services?.clinvar);
  const population = unassessed
    ? `Population evidence not assessed: ${fallbackCause(
        result.predictorData?.gnomadVariantAssembly ?? null,
        locusRecoveryAction(result) === "retry",
        locusFailureKind(result) ?? undefined
      )}`
    : populationIssue(result, services?.gnomadFrequency);
  if (clinvar.failed || population) {
    // A fallback locus states its own cause; ClinVar is named beside it only when it failed too.
    const issues = [unassessed && !clinvar.failed ? null : clinvar.text, population].filter(Boolean);
    // A lone ClinVar failure still tells the reader what to do.
    if (!population) issues.push("re-run to retry");
    return { status: "degraded", desc: issues.join(" · ") };
  }
  /**
   * Usable is not settled. Core evidence and the ACMG rules are in, so every tab can be opened,
   * but a tab still loading its own source (AlphaGenome, Expression, Interfaces…) is named here
   * rather than hidden behind a "complete" the reader would take as final.
   */
  if (tabsLoading.length > 0) {
    const named = tabsLoading.length <= 3
      ? tabsLoading.join(", ")
      : `${tabsLoading.slice(0, 2).join(", ")} and ${tabsLoading.length - 2} more`;
    return { status: "progress", desc: `Usable now · Still loading: ${named}` };
  }
  return { status: "complete", desc: `${clinvar.text} · ACMG rules evaluated` };
}
