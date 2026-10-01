import { describe, it, expect } from "vitest";
import {
  isFallbackLocus,
  isRetryableFallbackLocus,
  fallbackLocusSentence,
  fallbackLocusShortLabel,
  type LocusResolution,
} from "../locusResolution";
import { isBuildDegradedResult, predictorDataSchema } from "../contracts";
import {
  buildFrequencyEvidence,
  classifyAcmgFrequency,
  frequencyEvidenceInputFromResult,
  summariseReadings,
  aouAbsenceReason,
  type FrequencyObservation,
} from "../frequencyEvidence";
import { resolveSourceAvailability } from "../evidenceAvailability";
import { getWorkflowStageStatus } from "../workflowStatus";

/**
 * The fallback-locus chain, end to end on the client side (NAE1 p.Asp116Gly re-run from Recents during
 * an Ensembl outage). Each block pins one claim the Population tab used to make falsely.
 */

const FALLBACK_TRAIL: LocusResolution = {
  route: "fallback",
  canonicalBy: null,
  retryable: true,
  steps: [
    { step: "vep-hgvs", outcome: "failed", detail: "Status 503" },
    { step: "myvariant", outcome: "ok" },
    { step: "ensembl-lift", outcome: "skipped" },
    { step: "dbnsfp-grch38", outcome: "failed", detail: "reference check unavailable" },
  ],
};

/** The shape of the reported run: protein input (a `not-needed` lift record), hg19 fallback locus. */
const degradedRun = (trail: LocusResolution | null = FALLBACK_TRAIL) => ({
  coordinateLift: { status: "not-needed" as const, fromAssembly: "GRCh38" as const, toAssembly: "GRCh38" as const },
  predictorData: {
    amPathogenicity: null,
    amClass: null,
    caddPhred: null,
    gnomadVariantId: "16-66857184-T-C",
    gnomadVariantAssembly: "GRCh37" as const,
    ...(trail ? { locusResolution: trail } : {}),
  },
  serviceStatus: { gnomadFrequency: "unsupported-build" },
  gnomadFrequency: null,
  aouFrequency: null,
});

describe("isFallbackLocus", () => {
  it("reads the server's trail", () => {
    expect(isFallbackLocus(degradedRun())).toBe(true);
    expect(isFallbackLocus({ predictorData: { gnomadVariantId: "16-1-A-G", gnomadVariantAssembly: "GRCh38", locusResolution: { ...FALLBACK_TRAIL, canonicalBy: "dbnsfp-grch38" } } })).toBe(false);
  });

  it("covers a fallback that found no locus at all", () => {
    expect(isFallbackLocus({ predictorData: { gnomadVariantId: null, gnomadVariantAssembly: null, locusResolution: FALLBACK_TRAIL } })).toBe(true);
  });

  it("infers a fallback on legacy payloads submitted on GRCh38 or as protein notation", () => {
    expect(isFallbackLocus(degradedRun(null))).toBe(true);
  });

  it("does NOT call a user-submitted GRCh37 coordinate a fallback", () => {
    const userGrch37 = { ...degradedRun(null), coordinateLift: { status: "unavailable" as const, fromAssembly: "GRCh37" as const, toAssembly: "GRCh37" as const } };
    expect(isFallbackLocus(userGrch37)).toBe(false);
  });

  it("is retryable only when the trail says another attempt could change it", () => {
    expect(isRetryableFallbackLocus(degradedRun())).toBe(true);
    expect(isRetryableFallbackLocus(degradedRun({ ...FALLBACK_TRAIL, retryable: false }))).toBe(false);
  });

  it("states a lookup failure, never a property of the variant", () => {
    const sentence = fallbackLocusSentence("gnomAD r4", "GRCh37");
    expect(sentence).toMatch(/lookup failure, not a property of the variant/);
    expect(sentence).toMatch(/re-run the analysis to retry/);
    expect(sentence).not.toMatch(/this coordinate is GRCh37/);
    expect(fallbackLocusSentence("gnomAD r4", null)).toMatch(/no genomic locus could be established/);
    expect(fallbackLocusShortLabel("GRCh37")).toBe("hg19 fallback");
  });

  it("is part of the predictor contract, so the client parse keeps it", () => {
    const parsed = predictorDataSchema.parse(degradedRun().predictorData);
    expect(parsed.locusResolution?.route).toBe("fallback");
  });
});

describe("cache guard — a fallback run is never served as finished", () => {
  it("declines a protein-input run whose locus fell back (the Recents defect)", () => {
    // The `not-needed` lift record used to short-circuit this to "settled".
    expect(isBuildDegradedResult(degradedRun())).toBe(true);
    expect(isBuildDegradedResult(degradedRun(null))).toBe(true);
  });

  it("serves a fallback whose failure was definitive", () => {
    expect(isBuildDegradedResult(degradedRun({ ...FALLBACK_TRAIL, retryable: false }))).toBe(false);
  });

  it("serves a run whose locus was recovered on GRCh38", () => {
    const recovered = degradedRun({ ...FALLBACK_TRAIL, canonicalBy: "dbnsfp-grch38", retryable: false });
    recovered.predictorData.gnomadVariantAssembly = "GRCh38" as any;
    expect(isBuildDegradedResult(recovered)).toBe(false);
  });
});

describe("Population evidence on a fallback run", () => {
  const evidence = buildFrequencyEvidence(frequencyEvidenceInputFromResult(degradedRun()));

  it("classifies gnomAD as a retryable fault, not 'Not covered'", () => {
    const gnomad = evidence.observations.filter(o => o.id.startsWith("gnomad"));
    expect(gnomad.length).toBeGreaterThan(0);
    for (const row of gnomad) {
      expect(row.availability.state).toBe("upstream-error");
      expect(row.availability.action).toBe("retry");
      expect(row.availability.reason).toMatch(/lookup failure/);
    }
    expect(evidence.retryable).toBe(true);
    expect(evidence.hasProviderFault).toBe(true);
  });

  it("still withholds the criterion, and says why truthfully", () => {
    const c = classifyAcmgFrequency(frequencyEvidenceInputFromResult(degradedRun()));
    expect(c.code).toBe("withheld");
    expect(c.statement).toMatch(/lookup failure, not a property of the variant/);
    expect(c.statement).not.toMatch(/this coordinate is GRCh37/);
  });

  it("keeps the build wording for a user who submitted GRCh37", () => {
    const user = { ...degradedRun(null), coordinateLift: { status: "unavailable" as const, fromAssembly: "GRCh37" as const, toAssembly: "GRCh37" as const } };
    const c = classifyAcmgFrequency(frequencyEvidenceInputFromResult(user));
    expect(c.code).toBe("withheld");
    expect(c.statement).not.toMatch(/lookup failure/);
  });

  it("does not claim 'No source reported this allele' when gnomAD was never asked", () => {
    const summary = summariseReadings(evidence.observations);
    expect(summary?.kind).not.toBe("none-observed");
    expect(summary?.text).not.toBe("No source reported this allele.");
  });
});

describe("summariseReadings", () => {
  const obs = (state: FrequencyObservation["availability"]["state"], hasValue = false) =>
    ({ availability: { state, hasValue } }) as FrequencyObservation;

  it("only says 'reported nothing' when every source answered", () => {
    expect(summariseReadings([obs("no-result"), obs("no-result")])?.text).toBe("No source reported this allele.");
  });
  it("says nothing was queried when no source answered", () => {
    expect(summariseReadings([obs("upstream-error"), obs("not-covered")])?.kind).toBe("none-queried");
  });
  it("counts the sources that were not read", () => {
    expect(summariseReadings([obs("no-result"), obs("upstream-error"), obs("upstream-error")])?.text)
      .toBe("No queried source reported this allele; 2 sources were not read.");
  });
  it("waits while sources are in flight", () => {
    expect(summariseReadings([obs("pending"), obs("upstream-error")])?.kind).toBe("pending");
  });
  it("steps aside when any source has a value", () => {
    expect(summariseReadings([obs("available", true), obs("no-result")])).toBeNull();
  });
});

describe("aouAbsenceReason — the All of Us row names its absence", () => {
  it("claims a table lookup only when one happened", () => {
    expect(aouAbsenceReason({ localTable: "absent", remoteDbnsfp: "not-reported" }).reason).toMatch(/local All of Us frequency table holds no entry/);
    expect(aouAbsenceReason({ localTable: "not-installed", remoteDbnsfp: "not-reported" }).reason).toMatch(/no local All of Us table is installed/);
    expect(aouAbsenceReason(null).reason).toBe("No All of Us frequency was returned for this variant.");
  });
  it("treats a lookup that did not finish as a fault with a remedy", () => {
    expect(aouAbsenceReason({ localTable: "timed-out", remoteDbnsfp: "not-reported" }).fault).toBe(true);
    expect(aouAbsenceReason({ localTable: "failed", remoteDbnsfp: "not-reported" }).fault).toBe(true);
    expect(aouAbsenceReason({ localTable: "absent", remoteDbnsfp: "not-reported" }).fault).toBe(false);
  });
});

describe("retryable assembly refusals", () => {
  it("resolve to upstream-error with a retry action, not 'Not covered'", () => {
    const a = resolveSourceAvailability({
      refusals: [{ source: "alphagenome", reason: "alphagenome was not queried: the GRCh38 lookup …", retryable: true }],
      source: "alphagenome",
    });
    expect(a.state).toBe("upstream-error");
    expect(a.action).toBe("retry");
    expect(a.reason).toMatch(/^AlphaGenome Atlas was not queried/);
  });
  it("leave a user-chosen build refusal as a coverage fact", () => {
    const a = resolveSourceAvailability({
      refusals: [{ source: "alphagenome", reason: "alphagenome covers GRCh38 / hg38; this coordinate is GRCh37 / hg19 and was not scored." }],
      source: "alphagenome",
    });
    expect(a.state).toBe("not-covered");
  });
});

describe("workflow status", () => {
  it("shows a fallback run as degraded, not complete", () => {
    const s = getWorkflowStageStatus({ view: "evidence", result: degradedRun() as any });
    expect(s.status).toBe("degraded");
    expect(s.desc).toMatch(/re-run/);
  });
  it("shows a gnomAD timeout as degraded", () => {
    const run = { ...degradedRun(), predictorData: { ...degradedRun().predictorData, gnomadVariantAssembly: "GRCh38" as const, locusResolution: { ...FALLBACK_TRAIL, canonicalBy: "vep" as const } }, serviceStatus: { gnomadFrequency: "timeout" } };
    expect(getWorkflowStageStatus({ view: "evidence", result: run as any }).status).toBe("degraded");
  });
});

describe("frequencyEvidenceInputFromResult", () => {
  it("reads the narrative's criteria when the rule engine's are absent, and lets callers override", () => {
    const r = { insights: { acmgCriteria: [{ code: "PM2" }] } };
    expect(frequencyEvidenceInputFromResult(r).engineCriteria).toEqual([{ code: "PM2" }]);
    expect(frequencyEvidenceInputFromResult(r, { engineCriteria: null }).engineCriteria).toBeNull();
  });
});
