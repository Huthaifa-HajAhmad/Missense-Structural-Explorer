import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Guardrail: the narrative prompt carries ClinVar's ABSENCE as evidence.
 *
 * WHY THIS EXISTS
 * ---------------
 * `clinvarEvidence` was built inside `if (clinvar && clinvar.classification !== "Not found in
 * ClinVar")`, so for a variant ClinVar does not hold, the prompt contained no mention of ClinVar at
 * all — not even that it had been queried. The model filled the vacuum from its own priors. For
 * CNNM2 p.Ser489Cys the Insights card printed, under "AI-Generated Plausibility Reasoning":
 *
 *     "...and the variant is listed as a variant of uncertain significance in ClinVar without
 *      definitive functional validation."
 *
 * while the Population Data tab in the same viewport printed:
 *
 *     "ClinVar holds no classification for this variant. Absence from ClinVar is not evidence of
 *      benignity — it means no submitter has classified it."
 *
 * One run, one card, two contradictory statements about the same database — and the invented one
 * was attributed to ClinVar, which is the claim a curator is least able to check and most likely to
 * trust. A fabricated VUS is also the *safe-looking* fabrication: it reads as diligence rather than
 * as an error, which is why it survived review.
 *
 * WHAT THIS CHECKS
 * ----------------
 * Drives the real `performGeminiAnalysis` against a mocked provider and reads the prompt the engine
 * actually sent. A prompt is a claim-making artefact and this suite treats it as one:
 *
 *   1. every case emits a `[CLINVAR DATABASE EVIDENCE]` block, present or absent;
 *   2. the absence case forbids asserting a classification, in those words;
 *   3. the presence case still reports the record, so the fix cannot pass by suppressing ClinVar;
 *   4. the grounding rule rides every prompt;
 *   5. the model's own `likely_benign` token is humanised before it reaches clinical prose.
 */

const mockGenerateContent = vi.fn();
const mockSelectSummaryCitations = vi.fn().mockResolvedValue([]);

vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: class {
      models = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 10 }),
        generateContent: (...args: any[]) => mockGenerateContent(...args)
      };
    },
    Type: { OBJECT: "OBJECT", STRING: "STRING", ARRAY: "ARRAY" }
  };
});

vi.mock("./literature-summary.ts", () => {
  return {
    selectSummaryCitations: async (...args: any[]) => ({ citations: await mockSelectSummaryCitations(...args), scopes: { gene: "complete", variant: "complete", curated: "unavailable" }, withoutEmbeddings: 0 })
  };
});

/** The object `clinvar.ts` returns when esearch finds nothing. */
const CLINVAR_NOT_FOUND = {
  classification: "Not found in ClinVar",
  lastEvaluated: "",
  reviewStatus: "",
  alleleFrequencies: [],
  trait: "",
  uid: null,
  hasOtherPathogenicVariantSameAA: false
};

/** A real submission. */
const CLINVAR_HELD = {
  classification: "Pathogenic",
  lastEvaluated: "2024-01-01",
  reviewStatus: "criteria provided, multiple submitters, no conflicts",
  alleleFrequencies: [{ source: "ExAC", value: 0.00001 }],
  trait: "Hypomagnesemia 1, intestinal",
  uid: "123456",
  hasOtherPathogenicVariantSameAA: false
};

const MODEL_JSON = JSON.stringify({
  analysis: "narrative",
  biochemicalShift: "shift",
  structuralImpact: "impact",
  plausibility: "Plausibly uncertain in pathogenicity.",
  acmgCriteria: []
});

async function promptFor(clinvar: any, predictorData: any = null, serviceStatus: any = null): Promise<string> {
  const geminiService = await import("./gemini.ts");
  geminiService.resetModelHealth();

  await geminiService.performGeminiAnalysis(
    "CNNM2",
    "p.Ser489Cys",
    "Q9H4Z3",
    "489",
    "S",
    "C",
    undefined,
    clinvar,
    "standard",
    "dummy-key",
    AbortSignal.timeout(5000),
    predictorData,
    null,
    null,
    serviceStatus
  );

  const call = mockGenerateContent.mock.calls.at(-1);
  expect(call, "the provider must have been called").toBeTruthy();
  return String(call![0].contents);
}

describe("narrative prompt — ClinVar grounding", () => {
  const oldModel = process.env.GEMINI_MODEL;
  const oldFallbacks = process.env.GEMINI_MODEL_FALLBACKS;

  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockSelectSummaryCitations.mockReset();
    mockSelectSummaryCitations.mockResolvedValue([]);
    mockGenerateContent.mockResolvedValue({ text: MODEL_JSON });
    // One candidate, so the captured call is the only call.
    process.env.GEMINI_MODEL = "primary";
    process.env.GEMINI_MODEL_FALLBACKS = "primary";
  });

  afterEach(() => {
    if (oldModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = oldModel;
    if (oldFallbacks === undefined) delete process.env.GEMINI_MODEL_FALLBACKS;
    else process.env.GEMINI_MODEL_FALLBACKS = oldFallbacks;
    vi.restoreAllMocks();
  });

  it("states the absence when the variant is not held, and forbids inventing a classification", async () => {
    // A completed query that returned nothing is the only absence that may be called one.
    const prompt = await promptFor(CLINVAR_NOT_FOUND, null, { clinvar: "not_found" });

    // The block must EXIST. This is the assertion the old code fails: it sent no block at all.
    expect(prompt).toContain("[CLINVAR DATABASE EVIDENCE]");
    expect(prompt).toMatch(/holds no submission for this variant/i);
    expect(prompt).toMatch(/recorded absence, not an assertion of uncertain significance/i);

    // The explicit prohibition, in the terms the observed hallucination used.
    expect(prompt).toMatch(/Do NOT state, imply or paraphrase that ClinVar classifies this variant/i);
    expect(prompt).toMatch(/not as a variant of\s+uncertain significance/i);

    // And the positive claim must be absent, or the model could read both.
    expect(prompt).not.toContain("The variant is registered in ClinVar with");
  });

  it("distinguishes a FAILED query from an empty one and from an unqueried run", async () => {
    /*
     * The defect this test was blind to. `clinvar === null` has three causes — never queried, timed
     * out, errored — and the first version of the absence block reported all three as "ClinVar was not
     * queried for this run", a statement about the RUN that the run contradicts. On a timeout the
     * Population rail says "The ClinVar query timed out, so this variant's classification could not be
     * read." The prompt must not claim an absence of a RECORD where the record was never obtained.
     */
    const notQueried = await promptFor(null, null, null);
    const queriedEmpty = await promptFor(CLINVAR_NOT_FOUND, null, { clinvar: "not_found" });
    const timedOut = await promptFor(null, null, { clinvar: "timeout" });
    const errored = await promptFor(null, null, { clinvar: "error" });

    // Never queried: nothing is known either way.
    expect(notQueried).toMatch(/ClinVar was not queried for this run/i);
    expect(notQueried).not.toMatch(/holds no submission/i);

    // Queried and empty: a real negative.
    expect(queriedEmpty).toMatch(/holds no submission for this variant/i);

    // Failed: neither of the above, and explicitly non-conclusive.
    for (const prompt of [timedOut, errored]) {
      expect(prompt).toMatch(/query did not complete for this run/i);
      expect(prompt).toMatch(/do not conclude that ClinVar holds nothing/i);
      // The two false statements this state used to make.
      expect(prompt).not.toMatch(/ClinVar was not queried for this run/i);
      expect(prompt).not.toMatch(/holds no submission for this variant/i);
    }
  });

  it("does not quote a classification for a record that records none", async () => {
    // clinvar.ts:229 yields `classification: "Unknown"` with a real uid when a matched entry carries
    // no germline_classification. The presence block must not present that as database grounding.
    const prompt = await promptFor({ ...CLINVAR_HELD, classification: "Unknown" }, null, { clinvar: "ok" });

    expect(prompt).toMatch(/records no classification value/i);
    expect(prompt).not.toContain("The variant is registered in ClinVar with:");
    expect(prompt).not.toContain("- Classification: Unknown");
  });

  it("still reports a real submission, so the fix cannot pass by suppressing ClinVar", async () => {
    const prompt = await promptFor(CLINVAR_HELD, null, { clinvar: "ok" });

    expect(prompt).toContain("The variant is registered in ClinVar with:");
    expect(prompt).toContain("- Classification: Pathogenic");
    expect(prompt).toContain("- Review Status: criteria provided, multiple submitters, no conflicts");
    expect(prompt).toContain("Hypomagnesemia 1, intestinal");
    expect(prompt).not.toMatch(/holds no submission for it/i);
    expect(prompt).not.toMatch(/query did not complete/i);
  });

  it("reads the sentinel case-insensitively, so a differently-cased record is not quoted", async () => {
    /*
     * `reportStatus.test.ts` exercises "NOT FOUND" and "  Not Found  ", and the population module
     * matches /not found/i. The prompt's original exact-string comparison would have emitted
     * "- Classification: NOT FOUND" as database grounding for those payloads.
     */
    for (const sentinel of ["NOT FOUND", "  Not Found  ", "not found in clinvar"]) {
      const prompt = await promptFor({ ...CLINVAR_HELD, classification: sentinel }, null, { clinvar: "not_found" });
      expect(prompt, `${sentinel} must not be quoted as a classification`).not.toContain(
        "The variant is registered in ClinVar with:"
      );
      expect(prompt).toMatch(/holds no submission for this variant/i);
    }
  });

  it("carries the evidence-grounding rule on every prompt", async () => {
    for (const clinvar of [null, CLINVAR_NOT_FOUND, CLINVAR_HELD]) {
      const prompt = await promptFor(clinvar, null, { clinvar: clinvar ? "ok" : "timeout" });
      expect(prompt).toContain("[EVIDENCE GROUNDING RULE");
      expect(prompt).toMatch(/do not supply a plausible value from memory/i);
    }
  });

  it("humanises the model's own class token before it reaches clinical prose", async () => {
    const prompt = await promptFor(CLINVAR_NOT_FOUND, {
      available: true,
      amPathogenicity: 0.42,
      amClass: "likely_benign",
      caddPhred: 27.7
    }, { clinvar: "not_found" });

    expect(prompt).toContain("AlphaMissense Predicted Class: likely benign");
    expect(prompt, "the raw token must not survive into the prompt").not.toContain("likely_benign");
  });
});
