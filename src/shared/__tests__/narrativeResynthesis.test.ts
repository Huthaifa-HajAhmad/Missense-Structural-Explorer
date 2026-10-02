import { beforeEach, describe, expect, it } from "vitest";
import {
  NARRATIVE_OWNED_RESULT_FIELDS,
  acquireNarrativeFlight,
  beginNarrativeActivity,
  endNarrativeActivity,
  mergeNarrativeFields,
  mergeNarrativeInsights,
  narrativeActivityOutstanding,
  narrativeFieldsFromResponse,
  narrativeFieldsFromTransportFailure,
  narrativeFlightKey,
  narrativeFlightsInFlight,
  resetNarrativeActivity,
  resetNarrativeFlights,
  withNarrativeStageOutcome,
} from "../narrativeResynthesis";
import {
  buildNarrativeEvidenceContract,
  narrativeEvidenceRevision,
  narrativeEvidenceSourceFromResult,
  readNarrativeEvidenceStamp,
  type NarrativeEvidenceStamp,
} from "../narrativeEvidence";

/**
 * The shared half of re-synthesis: one flight per identity+evidence, one owner for the loading flag,
 * and one merge — so two mounted surfaces cannot run two syntheses, an older request cannot clear a
 * newer spinner, and the pipeline and the explicit retry cannot render one synthesis two ways.
 */

const STAMP: NarrativeEvidenceStamp = {
  contractVersion: 1,
  revision: "nev1:0123456789abcdef0123456789abcdef",
  synthesizedAt: 1_700_000_000_000,
  pipelineRunId: "1:1700",
  deepEvidenceIntegrated: false,
};

const PREVIOUS: any = {
  analysis: "previous AI narrative",
  isFallback: false,
  insights: {
    biochemicalShift: "old shift",
    structuralImpact: "old impact",
    plausibility: "AI said this was plausible.",
    model: "gemini-3.7-flash",
    source: "ai_inference",
    pathogenicity: "(Clinician Assigned)",
    acmgCriteria: [{ code: "PP3", reason: "old reasons" }],
  },
  ruleBasedInsights: { acmgVerdict: "Variant of Uncertain Significance (VUS)", acmgCriteria: [{ code: "PM2", reason: "rare" }] },
  foldingDdG: 1.4,
  clinvar: { classification: "Pathogenic" },
  metadata: { pipelineRunId: "1:1700", sequence: "MSTAVL" },
};

const HEALTHY = {
  analysis: "### Molecular and Chemical Shift\n\nFresh narrative.",
  isFallback: false,
  insights: {
    biochemicalShift: "fresh shift",
    structuralImpact: "fresh impact",
    plausibility: "fresh plausibility",
    model: "gemini-3.5-flash-lite",
    source: "ai_inference",
    acmgVerdict: "Likely Pathogenic",
    acmgCriteria: [{ code: "PS3", reason: "fresh" }],
  },
};

const DEGRADED = {
  analysis: "### Rule-Based Clinical Summary\n\nLive AI synthesis was not applied.",
  isFallback: true,
  fallbackReason: "PROVIDER_OVERLOADED",
  fallbackMessage: "Gemini reported that the requested models are overloaded.",
  fallbackRetryable: true,
  providerDetail: "high demand",
  insights: { biochemicalShift: "Not synthesized", structuralImpact: "Not synthesized", acmgCriteria: [] },
};

describe("narrative flights — one synthesis, whoever asks", () => {
  beforeEach(() => {
    resetNarrativeFlights();
    resetNarrativeActivity();
  });

  it("coalesces the same identity and evidence into one request", async () => {
    let runs = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = acquireNarrativeFlight("PAH|p.arg408trp|P00439|nev1:a", async () => {
      runs++;
      await gate;
    });
    const second = acquireNarrativeFlight("PAH|p.arg408trp|P00439|nev1:a", async () => {
      runs++;
    });

    expect(first.owner).toBe(true);
    expect(second.owner).toBe(false);
    expect(runs).toBe(1);

    release();
    await Promise.all([first.promise, second.promise]);
    expect(runs).toBe(1);
    expect(narrativeFlightsInFlight()).toBe(0);
  });

  it("does not coalesce different identities or different evidence", async () => {
    let runs = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = async () => {
      runs++;
      await gate;
    };

    const a = acquireNarrativeFlight("PAH|p.arg408trp|P00439|nev1:a", work);
    const b = acquireNarrativeFlight("GZF1|p.arg408trp|Q9H116|nev1:a", work);
    const c = acquireNarrativeFlight("PAH|p.arg408trp|P00439|nev1:b", work);

    expect(runs).toBe(3);
    release();
    await Promise.all([a.promise, b.promise, c.promise]);
  });

  it("aborts only when the last waiting surface detaches", async () => {
    let signal: AbortSignal | undefined;
    const first = acquireNarrativeFlight("k", async (flightSignal) => {
      signal = flightSignal;
      await new Promise<void>((resolve) => flightSignal.addEventListener("abort", () => resolve()));
    });
    const second = acquireNarrativeFlight("k", async () => {});

    first.release();
    expect(signal!.aborted, "one surface unmounting must not cancel another's synthesis").toBe(false);

    second.release();
    expect(signal!.aborted).toBe(true);
    await first.promise;
  });

  it("keeps the flight alive while any surface is still waiting, and releasing twice is a no-op", async () => {
    let signal: AbortSignal | undefined;
    const handle = acquireNarrativeFlight("k2", async (flightSignal) => {
      signal = flightSignal;
      await new Promise<void>((resolve) => flightSignal.addEventListener("abort", () => resolve()));
    });
    const joined = acquireNarrativeFlight("k2", async () => {});
    joined.release();
    joined.release();
    expect(signal!.aborted).toBe(false);
    handle.release();
    expect(signal!.aborted).toBe(true);
    await handle.promise;
    // Releasing after the flight settled must not throw.
    expect(() => handle.release()).not.toThrow();
  });

  it("raises exactly one activity per flight, whatever number of surfaces join", async () => {
    const handle = acquireNarrativeFlight("k3", async () => {});
    acquireNarrativeFlight("k3", async () => {});
    expect(narrativeActivityOutstanding()).toBe(true);
    await handle.promise;
    expect(narrativeActivityOutstanding(), "the shared activity ends with the shared work").toBe(false);
  });

  it("builds a case-normalized key that keeps identity, run and evidence apart", () => {
    const base = narrativeFlightKey(
      { gene: "pah", variant: "P.Arg408Trp", uniprotId: "p00439" },
      "nev1:a",
      "1:1700"
    );
    expect(base).toBe(
      narrativeFlightKey({ gene: "PAH", variant: "p.arg408trp", uniprotId: "P00439" }, "nev1:a", "1:1700")
    );
    expect(base).not.toBe(
      narrativeFlightKey({ gene: "GZF1", variant: "p.arg408trp", uniprotId: "P00439" }, "nev1:a", "1:1700")
    );
    expect(base).not.toBe(
      narrativeFlightKey({ gene: "PAH", variant: "p.arg408trp", uniprotId: "P00439" }, "nev1:b", "1:1700")
    );
    // The run is part of the identity: a re-analysis with byte-identical evidence is still another run.
    expect(base).not.toBe(
      narrativeFlightKey({ gene: "PAH", variant: "p.arg408trp", uniprotId: "P00439" }, "nev1:a", "2:1800")
    );
  });

  it("keeps two declared runs of one variant apart, and coalesces within one run", async () => {
    /*
     * The regression this segment exists for: run A and run B of the same variant can produce identical
     * evidence, so identity+revision alone made them ONE flight. A owned it, B joined, and A's install
     * refused B (its identity guard compares `pipelineRunId`) — B was left with no narrative at all.
     * Two runs must be two flights, while two asks within one run still share one.
     */
    let runs = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const work = async () => {
      runs++;
      await gate;
    };
    const identity = { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" };

    const a1 = acquireNarrativeFlight(narrativeFlightKey(identity, "nev1:a", "1:1700"), work);
    const a2 = acquireNarrativeFlight(narrativeFlightKey(identity, "nev1:a", "1:1700"), work);
    const b = acquireNarrativeFlight(narrativeFlightKey(identity, "nev1:a", "2:1800"), work);

    // Same run: one synthesis. Different run with the same evidence: its own.
    expect(runs).toBe(2);
    expect(a1.owner).toBe(true);
    expect(a2.owner).toBe(false);
    expect(b.owner).toBe(true);

    release();
    await Promise.all([a1.promise, a2.promise, b.promise]);
    expect(narrativeFlightsInFlight()).toBe(0);
  });

  it("coalesces two payloads that declare no run id, as a legacy result does", async () => {
    let runs = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const work = async () => {
      runs++;
      await gate;
    };
    const identity = { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" };

    const first = acquireNarrativeFlight(narrativeFlightKey(identity, "nev1:a"), work);
    const second = acquireNarrativeFlight(narrativeFlightKey(identity, "nev1:a", null), work);

    // Neither declares a run, so the segment is empty for both and they are the same flight.
    expect(runs).toBe(1);
    release();
    await Promise.all([first.promise, second.promise]);
  });
});

describe("narrative activity — the loading flag's ownership", () => {
  beforeEach(() => {
    resetNarrativeActivity();
  });

  it("stays not-idle while any request is outstanding", () => {
    const older = beginNarrativeActivity();
    const newer = beginNarrativeActivity();
    expect(endNarrativeActivity(older), "an older request must not clear a newer one's flag").toBe(false);
    expect(narrativeActivityOutstanding()).toBe(true);
    expect(endNarrativeActivity(newer)).toBe(true);
    expect(narrativeActivityOutstanding()).toBe(false);
  });

  it("is idle after the only request releases", () => {
    const token = beginNarrativeActivity();
    expect(endNarrativeActivity(token)).toBe(true);
  });
});

describe("narrative install — one merge for both paths", () => {
  it("replaces only the fields a narrative owns", () => {
    const merged = mergeNarrativeFields(PREVIOUS, narrativeFieldsFromResponse(HEALTHY, false), STAMP);

    for (const key of NARRATIVE_OWNED_RESULT_FIELDS) {
      expect(merged[key], `${key} is owned by the narrative`).toEqual(
        (narrativeFieldsFromResponse(HEALTHY, false) as any)[key]
      );
    }
    // Everything the run produced — including evidence that arrived while the synthesis was in
    // flight — is copied forward from the latest result, not from the request's snapshot.
    expect(merged.foldingDdG).toBe(1.4);
    expect(merged.clinvar).toBe(PREVIOUS.clinvar);
    expect(merged.ruleBasedInsights).toBe(PREVIOUS.ruleBasedInsights);
    expect(merged.metadata.pipelineRunId).toBe("1:1700");
    expect(merged.metadata.sequence).toBe("MSTAVL");
  });

  it("records the evidence revision the prose was written from", () => {
    const merged = mergeNarrativeFields(PREVIOUS, narrativeFieldsFromResponse(HEALTHY, false), STAMP);
    expect(readNarrativeEvidenceStamp(merged)).toEqual(STAMP);
    expect(readNarrativeEvidenceStamp(PREVIOUS)).toBeNull();
  });

  it("carries the AI provenance of a healthy synthesis and the run's own fields", () => {
    const merged = mergeNarrativeFields(PREVIOUS, narrativeFieldsFromResponse(HEALTHY, false), STAMP);
    expect(merged.analysis).toContain("Fresh narrative");
    expect(merged.isFallback).toBe(false);
    expect(merged.fallbackReason).toBeUndefined();
    expect(merged.insights.biochemicalShift).toBe("fresh shift");
    expect(merged.insights.model).toBe("gemini-3.5-flash-lite");
    expect(merged.insights.source).toBe("ai_inference");
    expect(merged.insights.acmgVerdict).toBe("Likely Pathogenic");
    expect(merged.insights.acmgCriteria).toEqual([{ code: "PS3", reason: "fresh" }]);
    // The clinician's own assignment is not the model's, so it survives.
    expect(merged.insights.pathogenicity).toBe("(Clinician Assigned)");
  });

  it("never inherits AI provenance into a degraded install", () => {
    const merged = mergeNarrativeFields(PREVIOUS, narrativeFieldsFromResponse(DEGRADED, true), STAMP);
    expect(merged.isFallback).toBe(true);
    expect(merged.fallbackReason).toBe("PROVIDER_OVERLOADED");
    expect(merged.insights.source).toBe("rule_based");
    expect(merged.insights.model).toBeUndefined();
    expect(merged.insights.plausibility).toBe("");
    expect(merged.insights.biochemicalShift).toBe("Not synthesized");
    // The verdict and the criteria the route reconciled against the rule engine stay.
    expect(merged.insights.acmgVerdict).toBe("Variant of Uncertain Significance (VUS)");
  });

  it("clears provenance even when a degraded payload carries no insights at all", () => {
    // The route `delete`s `model` and stamps `source` only when insights is truthy, and its response
    // always has an insights object — so this shape has to be handled here rather than assumed away.
    const payload = { analysis: "### Rule-Based Clinical Summary", isFallback: true, fallbackReason: "DEADLINE_EXCEEDED" };
    const merged = mergeNarrativeFields(PREVIOUS, narrativeFieldsFromResponse(payload, true), STAMP);
    expect(merged.insights.source).toBe("rule_based");
    expect(merged.insights.model).toBeUndefined();
    expect(merged.insights.plausibility).toBe("");
  });

  it("does not print one synthesis's prose beside another synthesis's body", () => {
    /*
     * A response whose structured fields failed validation arrives as prose plus reconciled criteria
     * and nothing else. Inheriting the previous pass's `biochemicalShift`/`structuralImpact`/
     * `plausibility` would mix the two — the defect the wholesale spread used to produce.
     */
    const payload = {
      analysis: "### Molecular and Chemical Shift\n\nFresh prose, unparsed fields.",
      isFallback: false,
      insights: { acmgVerdict: "VUS", acmgCriteria: [{ code: "PM2", reason: "rare" }] },
    };
    const merged = mergeNarrativeFields(PREVIOUS, narrativeFieldsFromResponse(payload, false), STAMP);
    expect(merged.analysis).toContain("Fresh prose");
    expect(merged.insights.biochemicalShift).toBe("");
    expect(merged.insights.structuralImpact).toBe("");
    expect(merged.insights.plausibility).toBe("");
    expect(merged.insights.model).toBeUndefined();
    expect(merged.insights.source).toBeUndefined();
    // The run's own record of what the engine ruled is still the fallback when the payload omits it.
    expect(merged.insights.acmgVerdict).toBe("VUS");
    expect(merged.insights.pathogenicity).toBe("(Clinician Assigned)");
  });

  it("never empties the report when a payload carries no prose", () => {
    const merged = mergeNarrativeFields(PREVIOUS, narrativeFieldsFromResponse({ isFallback: false }, false), STAMP);
    expect(merged.analysis).toBe(PREVIOUS.analysis);
  });

  it("describes a transport failure in structured fields, not in clinical prose", () => {
    const fields = narrativeFieldsFromTransportFailure("Rate limit exceeded");
    const merged = mergeNarrativeFields(PREVIOUS, fields, STAMP);
    expect(merged.analysis).toContain("Clinical Narrative Unavailable");
    expect(merged.analysis).not.toContain("Rate limit exceeded");
    expect(merged.providerDetail).toBe("Rate limit exceeded");
    expect(merged.isFallback).toBe(true);
    expect(merged.fallbackReason).toBe("SERVICE_UNAVAILABLE");
    expect(merged.fallbackRetryable).toBe(true);
    expect(merged.insights.plausibility).toBe("");
    expect(merged.insights.model).toBeUndefined();
    expect(merged.insights.source).toBe("rule_based");
  });

  it("takes the verdict from the rule engine when the payload omits it", () => {
    const insights = mergeNarrativeInsights({
      previousInsights: PREVIOUS.insights,
      payloadInsights: null,
      degraded: true,
      ruleBasedInsights: PREVIOUS.ruleBasedInsights,
    });
    expect(insights.acmgVerdict).toBe("Variant of Uncertain Significance (VUS)");
    expect(insights.acmgCriteria).toEqual([]);
    expect(insights.partialEvidence).toBeUndefined();
  });
});

/**
 * `metadata.pipelineStages.narrative` — the stage outcome no synthesis recorded before: the automatic
 * pass and the explicit control both left the stage at whatever they found, so a run that had finished a
 * narrative looked identical to one that never asked for it.
 */
describe("narrative stage outcome", () => {
  /** The shape a core-only cache retention leaves behind (`variantCache.withoutDegradedNarrative`). */
  const RETAINED_CORE: any = {
    analysis: "",
    insights: null,
    isFallback: true,
    ruleBasedInsights: {
      acmgVerdict: "Variant of Uncertain Significance (VUS)",
      acmgCriteria: [{ code: "PM2", reason: "rare" }],
    },
    clinvar: { classification: "Pathogenic" },
    metadata: {
      pipelineRunId: "1:1700",
      pipelineStages: { core: "complete", landscape: "complete", structural: "degraded", narrative: "degraded" },
    },
  };

  it("records a terminal outcome without disturbing sibling stages or the evidence stamp", () => {
    const merged = mergeNarrativeFields(RETAINED_CORE, narrativeFieldsFromResponse(HEALTHY, false), STAMP);

    // The successful synthesis replaces the `degraded` a core-only retention wrote...
    expect(merged.metadata.pipelineStages.narrative).toBe("complete");
    // ...and every other stage, and every other metadata field, survives.
    expect(merged.metadata.pipelineStages).toMatchObject({
      core: "complete",
      landscape: "complete",
      structural: "degraded",
    });
    expect(merged.metadata.pipelineRunId).toBe("1:1700");
    expect(readNarrativeEvidenceStamp(merged)).toEqual(STAMP);
    // A real install: the retention's empty prose is replaced, not preserved.
    expect(merged.analysis).toContain("Fresh narrative");
    expect(merged.isFallback).toBe(false);
  });

  it("separates a provider's rule-based report from a request that never arrived", () => {
    // A provider fallback (overloaded, quota, a rejected key) still produced a report: degraded.
    const providerFallback = mergeNarrativeFields(PREVIOUS, narrativeFieldsFromResponse(DEGRADED, true), STAMP);
    expect(providerFallback.metadata.pipelineStages.narrative).toBe("degraded");

    // A transport failure produced nothing at all: the step itself failed.
    const transportFailure = mergeNarrativeFields(
      PREVIOUS,
      narrativeFieldsFromTransportFailure("socket hang up"),
      STAMP
    );
    expect(transportFailure.metadata.pipelineStages.narrative).toBe("error");
  });

  it("creates the stage map when the result has none, and never mutates the input", () => {
    const bare: any = { analysis: "base", metadata: { gene: "PAH" } };
    expect(withNarrativeStageOutcome(bare, "running").metadata.pipelineStages).toEqual({ narrative: "running" });
    expect(bare.metadata.pipelineStages).toBeUndefined();
    expect(bare.metadata.gene).toBe("PAH");
  });

  it("is not part of the evidence revision, so recording it cannot invalidate the narrative", () => {
    /*
     * The evidence contract describes what a synthesis was GIVEN; the stage outcome describes how it
     * went. If the outcome were hashed, the install would change the revision the install itself
     * recorded — a narrative that reported itself outdated the moment it landed.
     */
    const revisionOf = (result: any): string =>
      narrativeEvidenceRevision(buildNarrativeEvidenceContract(narrativeEvidenceSourceFromResult(result)));

    const before = revisionOf(PREVIOUS);
    const installed = mergeNarrativeFields(PREVIOUS, narrativeFieldsFromResponse(HEALTHY, false), STAMP);
    expect(installed.metadata.pipelineStages.narrative).toBe("complete");
    expect(revisionOf(installed)).toBe(before);

    // ...and the same holds for the transient `running` write that precedes it.
    const running = withNarrativeStageOutcome(installed, "running");
    expect(running.metadata.pipelineStages.narrative).toBe("running");
    expect(revisionOf(running)).toBe(before);
  });
});
