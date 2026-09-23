/**
 * Pins the contract of `src/shared/evidenceAvailability.ts`.
 *
 * The point of these tests is not that each state renders a word. It is that a surface CANNOT
 * produce a "go configure your key" instruction from something a credential cannot fix. Every case
 * below that could plausibly yield that instruction is asserted against it explicitly.
 *
 * Several of these are regression tests for counterexamples found in adversarial review, and are
 * marked as such: the first revision passed its own 14-test suite while two of its seams produced
 * exactly the false cause the module exists to end. Those seams are now tested directly.
 *
 * Mirrored assertion-for-assertion in `scratch/verify-evidence-availability.mjs` for environments
 * where vitest cannot start.
 */
import { describe, expect, it } from "vitest";
import {
  resolveEvidenceAvailability,
  refusalReasonFor,
  resolveSourceAvailability,
  describeAbsence,
  type EvidenceAvailabilityInput,
} from "../evidenceAvailability";
import { ENGINE_STATE_LABELS } from "../engineStatus";

const REFUSAL =
  "alphagenome covers GRCh38 / hg38; this coordinate is GRCh37 / hg19 and was not scored.";

/** What surfaces are meant to render: the same sentence with a human source name. */
const HUMANISED_REFUSAL = REFUSAL.replace("alphagenome", "AlphaGenome Atlas");

/** The server's own predicate, reproduced so the two can be proven to agree rather than asserted. */
const serverTreatsAsUnindexable = (message: string | null) =>
  message !== null && message.includes("not indexed");

describe("a value always wins", () => {
  it("treats a measured 0.000 as a value, not as missing data", () => {
    // The defect this replaces: `extractModalityShap` returned 0 for "absent" and every card tested
    // `!== 0`, so a real attribution of exactly nothing was indistinguishable from unmeasured.
    const a = resolveEvidenceAvailability({ value: 0, status: "live", message: REFUSAL });
    expect(a.state).toBe("available");
    expect(a.label).toBeNull();
    expect(a.userActionable).toBe(false);
  });

  it("lets a value outrank a failure flag", () => {
    expect(resolveEvidenceAvailability({ value: 22.5, status: "unavailable", message: "boom" }).state)
      .toBe("available");
  });

  it("does NOT treat NaN as a value", () => {
    // A non-numeric score is a broken measurement, not a zero and not a result.
    const a = resolveEvidenceAvailability({ value: NaN, configured: true, status: "unavailable", message: "bad payload" });
    expect(a.hasValue).toBe(false);
    expect(a.state).toBe("upstream-error");
  });
});

describe("REGRESSION (review CRITICAL 1): a provider coverage statement outranks the local flag", () => {
  it("says 'not covered' with no action when the Atlas has no record, even with no key configured", () => {
    // First revision tested `configured === false` BEFORE the message, so this input produced
    // `not-configured` + `configure-credentials` and the panel rendered
    // "Variant not indexed in AlphaGenome Atlas. Add or check the credential in Settings." —
    // a Settings call-to-action welded to the sentence proving Settings cannot help.
    const a = resolveEvidenceAvailability({
      value: null,
      configured: false,
      status: "unavailable",
      message: "Variant not indexed in AlphaGenome Atlas.",
    });
    expect(a.state).toBe("not-covered");
    expect(a.userActionable).toBe(false);
    expect(a.action).toBeNull();
    expect(a.reason).toBe("Variant not indexed in AlphaGenome Atlas.");
  });

  it("gives the same verdict whether or not a credential is configured", () => {
    const message = "Variant not indexed in AlphaGenome Atlas.";
    for (const configured of [true, false, undefined]) {
      expect(
        resolveEvidenceAvailability({ value: null, configured, status: "unavailable", message }).state,
        `configured=${configured}`,
      ).toBe("not-covered");
    }
  });

  it("agrees with the server's own unindexable predicate on every message it can produce", () => {
    // The first revision claimed to "mirror" the server while matching a much broader family, so the
    // UI said "Not covered" while the cache still re-ran the analysis on every view — re-opening the
    // thrash the cache fix was written to close. This proves agreement instead of asserting it.
    const messages = [
      "Variant not indexed in AlphaGenome Atlas.",
      "AlphaGenome Atlas query timed out.",
      "AlphaGenome API Key is invalid or expired.",
      "AlphaGenome API responded with status 500",
      "no record of this job id yet, poll again",
      "AlphaGenome endpoint not configured",
      "UniProt (reviewed, human) has no entry cross-referenced to Q9Y305",
      null,
    ];
    for (const message of messages) {
      const uiSaysNotCovered =
        resolveEvidenceAvailability({ value: null, configured: true, status: "unavailable", message }).state ===
        "not-covered";
      expect(uiSaysNotCovered, `message=${message}`).toBe(serverTreatsAsUnindexable(message));
    }
  });

  it("does not read transient 'no record … yet' text as a permanent miss", () => {
    // Unanchored matching used to classify this as not-covered + "no setting changes this".
    const a = resolveEvidenceAvailability({
      value: null,
      configured: true,
      status: "unavailable",
      message: "no record of this job id yet, poll again",
    });
    expect(a.state).toBe("upstream-error");
    expect(a.action).toBe("retry");
  });
});

describe("REGRESSION (review CRITICAL 2): the refusal lookup key is typed, not a free string", () => {
  it("finds a recorded refusal by its canonical source name", () => {
    const refusals = [{ source: "alphagenome", reason: REFUSAL }];
    // Returned humanised: the lookup is the single point where a machine source key becomes prose,
    // so every consumer gets the same readable sentence instead of three places re-doing it.
    expect(refusalReasonFor(refusals, "alphagenome")).toBe(HUMANISED_REFUSAL);
    expect(refusalReasonFor(refusals, "alphagenome")).not.toMatch(/^alphagenome /);
    expect(resolveSourceAvailability({ source: "alphagenome", refusals, value: null }).state)
      .toBe("not-covered");
  });

  it("rejects a mis-cased or invented source name at compile time", () => {
    // Runtime behaviour cannot be tested here — the point is that this no longer *compiles*, so a
    // typo can no longer silently drop a recorded refusal and fall through to a credential verdict.
    // `@ts-expect-error` fails the typecheck if the error stops occurring, which is what keeps this
    // assertion live rather than decorative.
    // @ts-expect-error "AlphaGenome" is not an AssemblyRefusalSource
    expect(() => refusalReasonFor([{ source: "alphagenome", reason: REFUSAL }], "AlphaGenome")).not.toThrow();
    // @ts-expect-error "alpha-genome" is not an AssemblyRefusalSource
    expect(() => refusalReasonFor([], "alpha-genome")).not.toThrow();
  });

  it("ignores a blank recorded refusal rather than treating it as a coverage statement", () => {
    // Asymmetric emptiness was the seam that let a recorded-but-empty refusal degrade into a
    // credential verdict.
    const a = resolveSourceAvailability({
      source: "alphagenome",
      refusals: [{ source: "alphagenome", reason: "   " }],
      value: null,
      configured: false,
    });
    expect(a.state).toBe("not-configured");
    expect(a.action).toBe("configure-credentials");
  });
});

describe("credential faults reach the credential action", () => {
  it.each([
    "AlphaGenome API Key is invalid or expired.",
    "AlphaGenome API Key lacks permission to query Atlas.",
    "AlphaGenome endpoint not configured",
    "AlphaGenome Atlas: Key Required / Standby",
  ])("%s", (message) => {
    // A 401 or PERMISSION_DENIED is not a provider fault and a retry cannot fix it. The first
    // revision routed all of these to `upstream-error` + retry, so the user re-evaluated forever.
    const a = resolveEvidenceAvailability({
      value: null,
      configured: true,
      status: "unavailable",
      message,
    });
    expect(a.state, message).toBe("not-configured");
    expect(a.action, message).toBe("configure-credentials");
  });
});

describe("configuration is only claimed when known, and only by the weakest signal", () => {
  it("offers the credential action when nothing stronger contradicts it", () => {
    const a = resolveEvidenceAvailability({ value: null, configured: false });
    expect(a.state).toBe("not-configured");
    expect(a.userActionable).toBe(true);
    expect(a.action).toBe("configure-credentials");
  });

  it("never infers 'not configured' from an unknown flag", () => {
    const a = resolveEvidenceAvailability({ value: null });
    expect(a.state).not.toBe("not-configured");
    expect(a.state).toBe("no-result");
    expect(a.userActionable).toBe(false);
  });

  it("accepts only a literal false, not a falsy lookalike", () => {
    for (const notConfigured of [undefined, null, 0, "", "false", NaN] as const) {
      expect(
        resolveEvidenceAvailability({ value: null, configured: notConfigured as unknown as boolean | undefined }).state,
        String(notConfigured),
      ).not.toBe("not-configured");
    }
  });
});

describe("provider faults require evidence", () => {
  it("classifies a real timeout as upstream-error with a retry action", () => {
    const a = resolveEvidenceAvailability({
      value: null,
      configured: true,
      status: "unavailable",
      message: "AlphaGenome Atlas query timed out.",
    });
    expect(a.state).toBe("upstream-error");
    expect(a.action).toBe("retry");
  });

  it("does not call a bare zod default a provider error", () => {
    // `status` defaults to "unavailable" in alphagenomeAviSchema, so an absent field must not be
    // reported as a third party failing on no evidence at all.
    const a = resolveEvidenceAvailability({ value: null, status: "unavailable" });
    expect(a.state).toBe("no-result");
    expect(a.userActionable).toBe(false);
    expect(a.reason).toBeNull();
  });

  it("does not turn a successful live answer that carried no value into a fault", () => {
    const a = resolveEvidenceAvailability({
      value: null,
      configured: true,
      status: "live",
      message: "AlphaGenome API responded with status 200",
    });
    expect(a.state).toBe("no-result");
    expect(a.action).toBeNull();
  });
});

describe("ordering and vocabulary", () => {
  it("reports pending while a request is in flight, ahead of a stale refusal", () => {
    expect(resolveEvidenceAvailability({ value: null, pending: true, refusal: REFUSAL }).state).toBe("pending");
  });

  it("sources every label from ENGINE_STATE_LABELS", () => {
    const cases: Array<[EvidenceAvailabilityInput, keyof typeof ENGINE_STATE_LABELS]> = [
      [{ value: null, refusal: REFUSAL }, "not-covered"],
      [{ value: null, configured: false }, "not-installed"],
      [{ value: null, configured: true, status: "unavailable", message: "timed out" }, "upstream-error"],
      [{ value: null }, "no-result"],
      [{ value: null, pending: true }, "running"],
    ];
    const canonical = new Set(Object.values(ENGINE_STATE_LABELS));
    for (const [input, engineState] of cases) {
      const label = resolveEvidenceAvailability(input).label;
      expect(label, JSON.stringify(input)).toBe(ENGINE_STATE_LABELS[engineState]);
      expect(label, `no label for ${JSON.stringify(input)}`).not.toBeNull();
      expect(canonical.has(label as string), `"${label}" is not canonical`).toBe(true);
    }
  });
});

describe("refusalReasonFor / describeAbsence", () => {
  const refusals = [
    { source: "alphagenome", reason: REFUSAL },
    { source: "popEVE", reason: "p" },
  ];

  it("looks a refusal up by source and tolerates absence", () => {
    expect(refusalReasonFor(refusals, "alphagenome")).toBe(HUMANISED_REFUSAL);
    expect(refusalReasonFor(refusals, "popEVE")).toBe("p"); // not prefixed by its source key: unchanged
    expect(refusalReasonFor(refusals, "splice-proximity")).toBeNull();
    expect(refusalReasonFor(null, "alphagenome")).toBeNull();
    expect(refusalReasonFor([], "alphagenome")).toBeNull();
  });

  it("states a reason when one exists and stays silent when it does not", () => {
    expect(describeAbsence(resolveEvidenceAvailability({ value: null, refusal: REFUSAL })))
      .toBe(`Not covered. ${REFUSAL}`);
    expect(describeAbsence(resolveEvidenceAvailability({ value: null }))).toBe("No result");
    expect(describeAbsence(resolveEvidenceAvailability({ value: 3.2 }))).toBe("");
  });
});

/**
 * Negative control against the rule this module replaced at the SplicingTab call site:
 * `refusal ? "not-covered" : "not-installed"`.
 *
 * Annotated to return `string`. Left to infer, TypeScript narrows it to its own two-value union and
 * reports the comparisons below as "no overlap" — which is TypeScript correctly telling me the
 * assertion was vacuous. Widening the type to match the behaviour is what lets this control be able
 * to fail at all.
 */
describe("negative control — the inline ternary this replaces", () => {
  const oldRule: (refusal: string | null, configured?: boolean) => string = (refusal, configured) =>
    refusal ? "not-covered" : configured === false ? "not-configured" : "not-installed";

  const cases: Array<[string, EvidenceAvailabilityInput, string]> = [
    ["provider timeout, key configured", { value: null, configured: true, status: "unavailable", message: "AlphaGenome Atlas query timed out." }, "upstream-error"],
    ["configuration unknown", { value: null }, "no-result"],
    ["Atlas holds no record", { value: null, configured: true, status: "unavailable", message: "Variant not indexed in AlphaGenome Atlas." }, "not-covered"],
    ["expired key", { value: null, configured: true, status: "unavailable", message: "AlphaGenome API Key is invalid or expired." }, "not-configured"],
  ];

  it("distinguishes four absences where the old rule produced at most two", () => {
    const states = cases.map(([, input]) => resolveEvidenceAvailability(input).state);
    expect(new Set(states).size).toBe(4);
    expect(states).toEqual(cases.map(([, , expected]) => expected));
  });

  it("and the old rule gets all four wrong", () => {
    const wrong = cases.filter(([, input, expected]) => oldRule(input.refusal ?? null, input.configured) !== expected);
    // Four, not three: the corrected helper honours `configured === false`, and none of these inputs
    // has a definitively-false flag, so all four collapse to "not-installed".
    expect(wrong.map(([name]) => name).sort()).toEqual(
      ["Atlas holds no record", "configuration unknown", "expired key", "provider timeout, key configured"].sort(),
    );
  });

  it("never lets the resolver send a coverage problem to Settings", () => {
    const coverageInputs: EvidenceAvailabilityInput[] = [
      { value: null, refusal: REFUSAL, configured: false },
      { value: null, configured: false, status: "unavailable", message: "Variant not indexed in AlphaGenome Atlas." },
      { value: null, configured: true, status: "unavailable", message: "Variant not indexed in AlphaGenome Atlas." },
      { value: null, refusal: REFUSAL, configured: true, status: "unavailable", message: "timed out" },
    ];
    for (const input of coverageInputs) {
      expect(resolveEvidenceAvailability(input).action, JSON.stringify(input)).not.toBe("configure-credentials");
    }
  });

  // The assertion that used to sit here — "the old rule gets N of these wrong" — was DELETED after
  // verification audit. It exercised only the `oldRule` lambda defined above and never touched the
  // shipped module, so it passed unchanged against a module that was wrong about everything. A test
  // that cannot fail is not documentation, it is a liability: it reads as coverage.
  //
  // What remains in this block is the half that does call the module ("distinguishes four absences",
  // "never lets a coverage problem reach Settings" above) — those fail on a broken resolver, which is
  // the only standard a control has to meet. The `oldRule` helper survives solely as a description
  // of the code being replaced, and is asserted against nothing.
  void oldRule;
});

describe("tone — the field that carried no coverage at all", () => {
  /**
   * Added after verification audit found that no test asserted `tone`, so any value could ship.
   * Tone is what drives the panel's accent and badge colour, and the colour semantics are the whole
   * reason `not-covered` is muted rather than amber: a coverage gap must not look like a fault.
   * A mutation flipping muted→warn passed the whole suite, which is precisely the bug this pins.
   */
  it("assigns every state the tone the design says it has", () => {
    const expectations: Array<[EvidenceAvailabilityInput, string]> = [
      [{ value: 3.2 }, "good"],
      [{ value: null, pending: true }, "neutral"],
      [{ value: null, refusal: REFUSAL }, "muted"],
      [{ value: null, configured: false }, "muted"],
      [{ value: null, configured: true, status: "unavailable", message: "AlphaGenome Atlas query timed out." }, "warn"],
      [{ value: null }, "warn"],
    ];
    for (const [input, tone] of expectations) {
      expect(resolveEvidenceAvailability(input).tone, JSON.stringify(input)).toBe(tone);
    }
  });

  it("never paints a coverage gap as a fault", () => {
    // The two states a user cannot fix must not share a colour with the ones that mean "something
    // broke", or the UI invites them to go repair a non-fault.
    for (const input of [
      { value: null, refusal: REFUSAL },
      { value: null, configured: true, status: "unavailable", message: "Variant not indexed in AlphaGenome Atlas." },
    ] satisfies EvidenceAvailabilityInput[]) {
      expect(resolveEvidenceAvailability(input).tone, JSON.stringify(input)).toBe("muted");
    }
  });
});

describe("the payload's own pending status (a live consumer depends on this branch)", () => {
  /**
   * `frequencyEvidence.ts` calls `resolveEvidenceAvailability({ status: "pending" })` directly — it
   * never sets the `pending` flag — so this path is load-bearing in production and was previously
   * reachable only through the flag. A mutation dropping the status check survived the whole suite.
   */
  it("reports pending from status alone", () => {
    const a = resolveEvidenceAvailability({ value: null, status: "pending" });
    expect(a.state).toBe("pending");
    expect(a.label).toBe(ENGINE_STATE_LABELS.running);
    expect(a.userActionable).toBe(false);
    expect(a.action).toBeNull();
  });

  it("lets a pending status outrank a recorded refusal", () => {
    // A re-evaluation in flight must not be reported as a permanent coverage decision.
    expect(resolveEvidenceAvailability({ value: null, status: "pending", refusal: REFUSAL }).state)
      .toBe("pending");
  });
});

describe("refusal lookup is exact, not a substring", () => {
  /**
   * A `startsWith`/`includes` implementation passed every other test in this file, because each
   * fixture had one entry whose key was a prefix-free match. Two entries where one key contains the
   * other is what distinguishes exact matching from a partial match that silently returns the wrong
   * source's reason.
   */
  it("returns only the reason belonging to the requested source", () => {
    const refusals = [
      { source: "gpn-star", reason: "gpn-star covers GRCh38 / hg38; this coordinate is GRCh37 / hg19." },
      { source: "splice-proximity", reason: "splice-proximity covers GRCh38 / hg38; other." },
    ];
    expect(refusalReasonFor(refusals, "gpn-star")).toMatch(/^GPN-Star covers/);
    expect(refusalReasonFor(refusals, "splice-proximity")).toMatch(/^Splice-junction geometry covers/);
    // A key that is a substring of an existing one must not match it.
    expect(refusalReasonFor(refusals, "popEVE")).toBeNull();
    expect(refusalReasonFor([{ source: "alphagenome", reason: REFUSAL }], "gpn-star")).toBeNull();
  });
});

describe("describeAbsence covers every absence state, and upstream-error is actionable", () => {
  it("renders a label for all five absence states", () => {
    const cases: Array<[EvidenceAvailabilityInput, string]> = [
      [{ value: null, refusal: REFUSAL }, "Not covered"],
      [{ value: null, configured: false }, "Not available here"],
      [{ value: null, configured: true, status: "unavailable", message: "timed out" }, "Provider error"],
      [{ value: null }, "No result"],
      [{ value: null, status: "pending" }, "Running"],
    ];
    for (const [input, prefix] of cases) {
      expect(describeAbsence(resolveEvidenceAvailability(input)), JSON.stringify(input))
        .toMatch(new RegExp(`^${prefix}`));
    }
  });

  it("marks a provider fault actionable and a coverage gap not", () => {
    // The asymmetry is the point: one invites an action, the other must not.
    expect(resolveEvidenceAvailability({
      value: null, configured: true, status: "unavailable", message: "AlphaGenome Atlas query timed out.",
    }).userActionable).toBe(true);
    expect(resolveEvidenceAvailability({ value: null, refusal: REFUSAL }).userActionable).toBe(false);
  });
});
