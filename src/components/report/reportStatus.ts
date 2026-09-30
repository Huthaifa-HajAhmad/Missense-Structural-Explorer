/**
 * reportStatus.ts — Pure derivation of the Clinical Report's status and provenance model.
 *
 * Kept free of React and of any fetch so it can be unit-tested directly. The Report UI renders
 * this model; it must never re-derive degradation state from prose.
 */
import {
  describeFallbackReason,
  isNarrativeFallbackReason,
  type NarrativeFallbackReason,
} from "../../shared/narrativeFallback";
import type { EnergeticsData } from "../../shared/contracts";
// One definition of "is there a frequency", shared with the Population Frequencies screen and the
// ACMG classifier's own input.
import { buildFrequencyEvidence } from "../../shared/frequencyEvidence";
import { energeticsAgreementText } from "../../shared/energeticsEvidence";
import { toCanonicalDdg } from "../../shared/engineStatus";

export type AiStatusState = "live" | "degraded" | "unconfigured" | "idle";

export interface AiStatusModel {
  state: AiStatusState;
  /** Short status label for the badge. */
  label: string;
  /** One sentence explaining the state in clinician-facing language. */
  detail: string;
  tone: "good" | "warn" | "neutral" | "bad";
  /** Whether re-running synthesis is worth offering. */
  retryable: boolean;
  /** Whether the Synthesize action should be enabled at all. */
  canSynthesize: boolean;
  /** Present only when degraded and the server supplied diagnostics. */
  diagnostics?: {
    providerDetail?: string;
    attemptedModels?: string[];
    reason?: NarrativeFallbackReason;
  };
}

export interface DeriveAiStatusInput {
  isFallback: boolean;
  fallbackReason?: string | null;
  fallbackMessage?: string | null;
  fallbackRetryable?: boolean | null;
  providerDetail?: string | null;
  attemptedModels?: string[] | null;
  /** Whether a Gemini credential is configured at all (BYOK or server-side). */
  isKeyActive: boolean;
  /** Whether any narrative text is present. */
  hasNarrative: boolean;
  isNarrativeLoading: boolean;
}

/**
 * Produce the single source of truth for "what is the AI's state right now".
 *
 * The defect this replaces: the old banner branched on `isKeyActive` alone, so a report that had
 * just failed showed "AI SESSION TOKEN READY — Synthesize Live Report" directly above
 * "AI Explanation Service Offline (Fallback Report Loaded)". Two contradictory claims at once.
 * Here a degraded report can never render a "ready" status.
 */
export function deriveAiStatus(input: DeriveAiStatusInput): AiStatusModel {
  const {
    isFallback,
    fallbackReason,
    fallbackMessage,
    fallbackRetryable,
    providerDetail,
    attemptedModels,
    isKeyActive,
    hasNarrative,
    isNarrativeLoading,
  } = input;

  if (isNarrativeLoading) {
    return {
      state: "idle",
      label: "Synthesizing…",
      detail: "Sending curated variant evidence to the language model for integrated interpretation.",
      tone: "neutral",
      retryable: false,
      canSynthesize: false,
    };
  }

  if (isFallback) {
    const presentation = describeFallbackReason(fallbackReason);

    // "No key configured" is a setup state, not a failure — but it still must not read as ready.
    const isUnconfigured = fallbackReason === "API_KEY_MISSING" && !isKeyActive;

    return {
      state: isUnconfigured ? "unconfigured" : "degraded",
      label: presentation.label,
      detail: fallbackMessage?.trim() || presentation.detail,
      tone: isUnconfigured ? "neutral" : presentation.tone,
      // Server-declared retryability wins; otherwise fall back to the reason's default.
      retryable: typeof fallbackRetryable === "boolean" ? fallbackRetryable : presentation.retryable,
      canSynthesize: isKeyActive,
      diagnostics: providerDetail || attemptedModels?.length
        ? {
            providerDetail: providerDetail || undefined,
            attemptedModels: attemptedModels?.length ? attemptedModels : undefined,
            reason: isNarrativeFallbackReason(fallbackReason) ? fallbackReason : undefined,
          }
        : undefined,
    };
  }

  if (hasNarrative) {
    return {
      state: "live",
      label: "AI synthesis complete",
      detail: "This narrative was written by the language model. Its criteria list is merged with the rule engine's; the prose itself is not checked against them.",
      tone: "good",
      retryable: false,
      canSynthesize: isKeyActive,
    };
  }

  if (!isKeyActive) {
    return {
      state: "unconfigured",
      label: "AI not configured",
      detail: "Connect a Gemini API key in Settings to generate a narrative interpretation of this variant.",
      tone: "neutral",
      retryable: false,
      canSynthesize: false,
    };
  }

  return {
    state: "idle",
    label: "Narrative not generated",
    detail: "Evidence is loaded and ready. Run AI synthesis to generate the integrated clinical narrative.",
    tone: "neutral",
    retryable: true,
    canSynthesize: true,
  };
}

// ---------------------------------------------------------------------------
// Evidence provenance
// ---------------------------------------------------------------------------

export type EvidenceStatus = "present" | "absent";

export interface EvidenceSource {
  id: string;
  label: string;
  status: EvidenceStatus;
  /** Short value summary when present, or why it is missing. */
  detail: string;
  /** Report section this source feeds, so the UI can point at the right place. */
  feeds: "acmg" | "energetics" | "structure" | "summary";
}

function hasNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Build an honest inventory of which evidence actually backs this report.
 *
 * A clinical report is only as strong as its stated evidence base, and the previous design gave
 * the reader no way to tell "absent from gnomAD" from "gnomAD was never queried".
 */
export function buildEvidenceInventory(
  result: any,
  energetics?: EnergeticsData | null,
  foldingDdG?: number | null
): EvidenceSource[] {
  const clinvar = result?.clinvar;
  const predictors = result?.predictorData;
  const conservation = result?.conservationData;
  const gnomadFrequency = result?.gnomadFrequency;
  const gnomadConstraint = result?.gnomadConstraint;
  const uniprotFeatures = result?.uniprotFeatures;
  const metadata = result?.metadata;

  const clinvarClass = clinvar?.classification ? String(clinvar.classification).trim() : "";
  const hasClinVar = Boolean(
    clinvarClass && !clinvarClass.toLowerCase().includes("not found")
  );

  const predictorValues = [
    hasNumber(predictors?.amPathogenicity) ? "AlphaMissense" : null,
    hasNumber(predictors?.caddPhred) ? "CADD" : null,
    hasNumber(conservation?.revel) ? "REVEL" : null,
  ].filter(Boolean) as string[];

  /**
   * Whether a population frequency is present at all.
   *
   * Read through the shared module rather than off `exomeAF`/`genomeAF`, which is what this did: a
   * variant present only through `groupMaxAF`/`maxAF` — the values the ACMG classifier actually uses,
   * and the only ones a local-dbNSFP payload carries — reported as having NO frequency, so the report
   * marked the source missing while the classifier had classified on it.
   */
  const hasFrequency = buildFrequencyEvidence({
    gnomadFrequency: gnomadFrequency ?? null,
    aouFrequency: result?.aouFrequency ?? null,
    serviceStatus: result?.serviceStatus ?? metadata?.serviceStatus ?? null,
    clinvar: clinvar
      ? { classification: clinvar.classification, alleleFrequencies: clinvar.alleleFrequencies }
      : null,
    assembly: predictors?.gnomadVariantAssembly ?? null,
    pli: gnomadConstraint?.pli ?? null,
  }).criterion.af !== null;

  const hasStructure = Boolean(metadata?.pdbId || metadata?.pdbSource);

  // Read stability engines from store's EnergeticsData and foldingDdG, with backward
  // compatibility fallback to legacy flat keys on result.
  const foldxVal = energetics?.foldx ?? energetics?.foldxMean ?? foldingDdG ?? result?.foldingDdG;
  const dynamut2Val = energetics?.dynamut2 ?? result?.dynamut2;
  const ddmutVal = energetics?.ddmut ?? result?.ddmut;
  const thermompnnVal = energetics?.thermompnn ?? result?.thermompnn;
  const raspVal = energetics?.rasp ?? result?.rasp;
  const stabilityoracleVal = energetics?.stabilityoracle ?? result?.stabilityoracle;

  const energeticsLabels = [
    hasNumber(foldxVal) ? "FoldX" : null,
    hasNumber(dynamut2Val) ? "DynaMut2" : null,
    hasNumber(ddmutVal) ? "DDMut" : null,
    hasNumber(thermompnnVal) ? "ThermoMPNN" : null,
    hasNumber(raspVal) ? "RaSP" : null,
    hasNumber(stabilityoracleVal) ? "StabilityOracle" : null,
  ].filter(Boolean) as string[];

  let energeticsStatus: EvidenceStatus = energeticsLabels.length > 0 ? "present" : "absent";
  let energeticsDetail = "";

  if (energeticsLabels.length > 0) {
    energeticsDetail = energeticsLabels.join(" · ");
    if (energetics?.pendingTools && energetics.pendingTools.length > 0) {
      energeticsDetail += ` (${energetics.pendingTools.length} pending)`;
    }
  } else if (energetics?.pendingTools && energetics.pendingTools.length > 0) {
    energeticsDetail = `Calculations pending (${energetics.pendingTools.join(", ")})`;
  } else if (energetics?.foldxBinaryMissing) {
    energeticsDetail = "FoldX binary not installed";
  } else if (energetics?.foldxRepairFailed) {
    energeticsDetail = "FoldX structure repair failed";
  } else if (energetics?.foldxError) {
    energeticsDetail = energetics.foldxError;
  } else if (energetics?.raspReason) {
    energeticsDetail = energetics.raspReason;
  } else {
    energeticsDetail = "Run FoldX or DynaMut2 from the 3D Structure tab";
  }

  return [
    {
      id: "clinvar",
      label: "ClinVar",
      status: hasClinVar ? "present" : "absent",
      detail: hasClinVar ? String(clinvarClass) : "No submission for this variant",
      feeds: "acmg",
    },
    {
      id: "gnomad-frequency",
      label: "gnomAD frequency",
      status: hasFrequency ? "present" : "absent",
      detail: hasFrequency ? "Allele frequency retrieved" : "Not retrieved for this variant",
      feeds: "acmg",
    },
    {
      id: "gnomad-constraint",
      label: "gnomAD constraint",
      status: gnomadConstraint ? "present" : "absent",
      detail: gnomadConstraint ? "Gene-level constraint retrieved" : "Not retrieved",
      feeds: "acmg",
    },
    {
      id: "in-silico",
      label: "In-silico predictors",
      status: predictorValues.length > 0 ? "present" : "absent",
      detail: predictorValues.length > 0 ? predictorValues.join(" · ") : "No predictor scores retrieved",
      feeds: "summary",
    },
    {
      id: "structure",
      label: "3D structure",
      status: hasStructure ? "present" : "absent",
      detail: hasStructure
        ? [metadata?.pdbId, metadata?.pdbSource].filter(Boolean).join(" · ")
        : "No experimental or predicted model loaded",
      feeds: "structure",
    },
    {
      id: "energetics",
      label: "Free-energy calculations",
      status: energeticsStatus,
      detail: energeticsDetail,
      feeds: "energetics",
    },
    {
      id: "uniprot",
      label: "UniProt features",
      status: uniprotFeatures ? "present" : "absent",
      detail: uniprotFeatures ? "Domain and topology annotations retrieved" : "Not retrieved",
      feeds: "summary",
    },
  ];
}

export function summarizeEvidence(sources: EvidenceSource[]): { present: number; total: number } {
  return {
    present: sources.filter((source) => source.status === "present").length,
    total: sources.length,
  };
}

/** Format a ΔΔG value with its sign preserved, for both prose and screen readers. */
export function formatDeltaG(value: number | null | undefined): string {
  if (!hasNumber(value)) return "—";
  const sign = (value as number) > 0 ? "+" : "";
  return `${sign}${(value as number).toFixed(2)} kcal/mol`;
}

/**
 * Recursively canonicalize JSON by sorting object keys, guaranteeing identical
 * serialized byte sequences regardless of key insertion order.
 */
function canonicalizeForFingerprint(val: unknown): string {
  if (val === null || typeof val !== "object") {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return "[" + val.map(canonicalizeForFingerprint).join(",") + "]";
  }
  const obj = val as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalizeForFingerprint(obj[k])}`);
  return "{" + pairs.join(",") + "}";
}

/**
 * Compute a SHA-256 cryptographic audit digest over a canonicalized report payload.
 *
 * Returns null in non-secure contexts (e.g. unencrypted HTTP without crypto.subtle)
 * so calling surfaces can report "unavailable" rather than fabricating an audit hash.
 */
export async function computeReportFingerprint(
  payload: unknown
): Promise<{ algorithm: string; digest: string } | null> {
  if (typeof crypto === "undefined" || !crypto.subtle || typeof crypto.subtle.digest !== "function") {
    return null;
  }
  try {
    const canonical = canonicalizeForFingerprint(payload);
    const data = new TextEncoder().encode(canonical);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const digest = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    return { algorithm: "SHA-256", digest };
  } catch {
    return null;
  }
}

export interface GenerateStructuredEhrReportParams {
  gene?: string | null;
  variant?: string | null;
  reportedVariant?: string | null;
  modelledVariant?: string | null;
  uniprotId?: string | null;
  reportedTranscriptId?: string | null;
  basisNote?: string | null;
  assessmentDate?: string;
  headlineVerdict?: string | null;
  plausibility?: string | null;
  acmgCriteria?: Array<{ code: string; reason?: string; source?: string }> | null;
  energetics?: EnergeticsData | null;
  foldingDdG?: number | null;
  result?: any;
  narrative?: string | null;
  evidenceSummary?: { present: number; total: number };
  sections?: Record<string, boolean>;
}

/**
 * Generate a standardized, EHR-ready structured clinical assessment report.
 *
 * Formatted for medical record text pasting with verified section dividers,
 * genomic & biophysical provenance, and algorithmic integrity notes.
 */
export function generateStructuredEhrReport(params: GenerateStructuredEhrReportParams): string {
  const {
    gene,
    variant,
    reportedVariant,
    modelledVariant,
    uniprotId,
    reportedTranscriptId,
    basisNote,
    assessmentDate = new Date().toISOString().split("T")[0],
    headlineVerdict,
    plausibility,
    acmgCriteria = [],
    energetics,
    foldingDdG,
    result,
    narrative,
    evidenceSummary,
    sections,
  } = params;

  const resolvedGene = gene || result?.metadata?.gene || "Unknown";
  const resolvedReported = reportedVariant || variant || result?.metadata?.variant || "Unknown";
  const resolvedModelled = modelledVariant || variant || result?.metadata?.variant || "Unknown";
  const resolvedUniProt = uniprotId || result?.metadata?.uniprotId || "N/A";
  const resolvedTranscript = reportedTranscriptId || (result?.metadata as any)?.transcriptId;
  const resolvedVerdict = headlineVerdict || "No classification available";

  const showAcmg = sections ? sections.acmg !== false : true;
  const showEnergetics = sections ? sections.energetics !== false : true;
  const showNarrative = sections ? sections.summary !== false : true;

  const lines: (string | null)[] = [
    "=======================================================",
    "CLINICAL GENOMICS & BIOPHYSICAL ASSESSMENT REPORT",
    "=======================================================",
    `Gene:               ${resolvedGene}`,
    `Reported Variant:   ${resolvedReported}`,
    `Modelled Variant:   ${resolvedModelled}`,
    `Canonical UniProt:  ${resolvedUniProt}`,
    resolvedTranscript ? `Transcript:         ${resolvedTranscript}` : null,
    basisNote ? `Numbering Note:     ${basisNote}` : null,
    `Assessment Date:    ${assessmentDate}`,
    `Headline Verdict:   ${resolvedVerdict}`,
    plausibility ? `Plausibility:       ${plausibility}` : null,
  ];

  if (showAcmg) {
    lines.push(
      "-------------------------------------------------------",
      "ACMG / AMP EVIDENCE CRITERIA",
      "-------------------------------------------------------",
      acmgCriteria && acmgCriteria.length > 0
        ? acmgCriteria.map((c) => `[${c.code}] ${c.reason || "Applied"}${c.source === "ai_suggested" ? " (Model-proposed, not counted)" : c.source ? " (Rule engine)" : ""}`).join("\n")
        : "No ACMG/AMP criteria recorded."
    );
  }

  if (showEnergetics) {
    lines.push(
      "-------------------------------------------------------",
      "BIOPHYSICAL STABILITY & FREE-ENERGY ESTIMATES",
      "-------------------------------------------------------",
      `FoldX ΔΔG:          ${formatDeltaG(energetics?.foldx ?? energetics?.foldxMean ?? foldingDdG ?? result?.foldingDdG)}`,
      // Engine agreement in words; the old line printed an uncalibrated "P" and a "95% CI" in kcal/mol.
      energeticsAgreementText(energetics ?? null)
        ? `Engine agreement: ${energeticsAgreementText(energetics ?? null)} (not an ACMG input)`
        : null,
      (energetics?.dynamut2 ?? result?.dynamut2) != null
        // Canonical sign (positive = destabilizing); DynaMut2 and DDMut report the opposite natively.
        ? `DynaMut2 ΔΔG:       ${formatDeltaG(toCanonicalDdg("dynamut2", energetics?.dynamut2 ?? result?.dynamut2))}`
        : null,
      (energetics?.ddmut ?? result?.ddmut) != null
        ? `DDMut ΔΔG:          ${formatDeltaG(toCanonicalDdg("ddmut", energetics?.ddmut ?? result?.ddmut))}`
        : null,
      (energetics?.thermompnn ?? result?.thermompnn) != null
        ? `ThermoMPNN ΔΔG:     ${formatDeltaG(energetics?.thermompnn ?? result?.thermompnn)}`
        : null,
      (energetics?.rasp ?? result?.rasp) != null
        ? `RaSP ΔΔG:           ${formatDeltaG(energetics?.rasp ?? result?.rasp)}`
        : null,
      (energetics?.stabilityoracle ?? result?.stabilityoracle) != null
        ? `StabilityOracle ΔΔG: ${formatDeltaG(energetics?.stabilityoracle ?? result?.stabilityoracle)}`
        : null
    );
  }

  if (showNarrative) {
    lines.push(
      "-------------------------------------------------------",
      "CLINICAL NARRATIVE & SYNTHESIS",
      "-------------------------------------------------------",
      narrative || "No narrative generated. Rule-based databases and structural metrics recorded above."
    );
  }

  lines.push(
    "=======================================================",
    evidenceSummary
      ? `Evidence Completeness: ${evidenceSummary.present} of ${evidenceSummary.total} sources retrieved.`
      : null,
    "Generated by Missense Structural Explorer (Validated Biomolecular Protocol)"
  );

  return lines.filter(Boolean).join("\n");
}

