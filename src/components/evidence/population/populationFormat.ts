/**
 * populationFormat.ts — presentation helpers shared by the Population Data tab and its inspector.
 *
 * Pure display mapping only. Nothing here decides a criterion: that is `shared/frequencyEvidence.ts`
 * (what the frequency supports) and the engine's own record (what was applied).
 */
import type { EvidenceAvailability } from "../../../shared/evidenceAvailability";

/**
 * ClinVar classification → `.ev-tier` tone, by explicit match rather than substring.
 *
 * `/pathogenic/i` matches "Conflicting interpretations of **pathogenic**ity", so a naive test paints a
 * conflicting (VUS-class) record pathogenic red. Downgraded and conflicting labels are tested first.
 */
export function classificationTone(classification: string): string {
  const lower = classification.toLowerCase();
  if (/conflicting|uncertain|not provided|no assertion/.test(lower)) return "neutral";
  if (/likely pathogenic/.test(lower)) return "warning";
  if (/\bpathogenic\b/.test(lower)) return "danger";
  if (/likely benign/.test(lower) || /\bbenign\b/.test(lower)) return "good";
  return "neutral";
}

/**
 * ClinVar review status → gold stars (0–4), as NCBI itself renders them.
 *
 * Returns `null` for a status this map does not recognise, so an unknown wording renders as text only
 * rather than as a confident "0 stars".
 */
export function reviewStars(status: string | null | undefined): number | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s.includes("practice guideline")) return 4;
  if (s.includes("expert panel")) return 3;
  if (s.includes("multiple submitters") && s.includes("no conflicts")) return 2;
  if (s.includes("conflicting")) return 1;
  if (s.includes("single submitter")) return 1;
  if (s.includes("no assertion") || s.includes("no classification") || s.includes("no interpretation")) return 0;
  return null;
}

/**
 * A ClinVar date in the day-month-year order a UK clinical reader expects ("12 Mar 2024"), and never
 * the browser's locale default, which printed 3/12/2024 on a US-locale machine.
 */
export function formatClinicalDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * What the rail's accession row should say when there is no VCV to link.
 *
 * The previous wording was "No ClinVar record read" for a CONFIRMED absence — which reads as a failed
 * request — and "Unindexed in ClinVar" for a variant that HAS a classification. Keyed on the classified
 * availability so a failure, a pending query and a recorded absence each get their own words.
 */
export function clinvarAccessionNote(availability: EvidenceAvailability): string {
  switch (availability.state) {
    case "available":
      return "Accession not returned";
    case "no-result":
      return /no outcome was recorded/i.test(availability.reason ?? "") ? "Outcome not recorded" : "Not in ClinVar";
    case "upstream-error":
      return "Query failed — not read";
    case "pending":
      return "Querying…";
    default:
      return availability.label ?? "Not read";
  }
}
