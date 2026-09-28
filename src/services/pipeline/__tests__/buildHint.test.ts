import { describe, it, expect } from "vitest";

import { refusalAttachmentsFromError } from "../workflowOrchestrator";
import {
  createBiophysicalErrorAnalysisState,
  createTopLevelErrorAnalysisState,
} from "../pipelineStateFactory";

/**
 * The build hint must survive TWO hops to reach a component: the client's error contract (the route
 * puts it in `error.details.buildHint`) and the pipeline state that the panel renders from. Without
 * the second hop the refusal is a message with nothing to click — which is exactly what the numbering
 * prompt was before its own hop was wired, and why this is tested the same way.
 */
describe("build hint reaches the analysis state", () => {
  const hint = {
    assembly: "GRCh37",
    triedAssembly: "GRCh38",
    notation: "Chr1(GRCh37):g.1256452C>A",
    reason: "the reference allele matched no reference base on GRCh38 at that position",
  };
  const error = Object.assign(new Error("reference mismatch"), {
    code: "COORDINATE_REFERENCE_MISMATCH",
    details: { buildHint: hint },
  });

  const baseParams = {
    gene: "",
    variant: "chr1:g.1256452C>A",
    uniprotId: "",
  } as any;

  it("carries the hint into the error state's result", () => {
    const extra = refusalAttachmentsFromError(error, "chr1:g.1256452C>A");
    expect(extra.buildHint).toEqual(hint);
    // A COPY, not the same object: the attachments are validated field by field, so an unexpected key
    // on the wire must not travel through to the UI untouched. Without this the pass-through assertions
    // above would also pass for an implementation that forwarded `details.buildHint` verbatim.
    expect(extra.buildHint).not.toBe(hint);
    // A build hint is not a numbering choice: nothing may be inferred into the other channel.
    expect(extra.numberingChoices).toBeUndefined();

    const state: any = createTopLevelErrorAnalysisState("reference mismatch", baseParams, extra);
    expect(state.result.buildHint).toEqual(hint);
    // The refusal is still an error — the prompt supplements the message, it does not replace it.
    expect(state.error).toContain("reference mismatch");
  });

  /**
   * The build trail reaches the state too.
   *
   * The prompt has to say whether the build it names was STATED or merely defaulted, and that fact
   * lives on `coordinateLift.buildDeclared` — which the first version extracted nowhere, so the copy
   * asserted a build nobody had stated. `error: null` on the cache path is the other half of this hop.
   */
  it("carries the build trail into the error state's result", () => {
    const withTrail = Object.assign(new Error("reference mismatch"), {
      code: "COORDINATE_REFERENCE_MISMATCH",
      details: {
        buildHint: hint,
        assembly: "GRCh38",
        resolvedAssembly: "GRCh38",
        assemblyNote: "Notation annotated \"(GRCh38)\" — resolved against the GRCh38 reference assembly.",
        coordinateLift: {
          status: "not-needed",
          fromAssembly: "GRCh38",
          toAssembly: "GRCh38",
          buildDeclared: false,
        },
      },
    });

    const extra = refusalAttachmentsFromError(withTrail, "chr1:g.1256452C>A");
    expect(extra.buildTrail).toEqual({
      assembly: "GRCh38",
      resolvedAssembly: "GRCh38",
      assemblyNote: expect.stringContaining("GRCh38"),
      coordinateLift: expect.objectContaining({ buildDeclared: false }),
    });

    const state: any = createTopLevelErrorAnalysisState("reference mismatch", baseParams, extra);
    expect(state.result.coordinateLift.buildDeclared).toBe(false);
    expect(state.result.assembly).toBe("GRCh38");
    // …and it reaches the biophysical error state too: which one renders depends on where the refusal
    // landed, and wiring only one is how the numbering prompt became invisible in production.
    const bio: any = createBiophysicalErrorAnalysisState("reference mismatch", baseParams, extra);
    expect(bio.result.coordinateLift.buildDeclared).toBe(false);
  });

  it("reaches the state through the BIOPHYSICAL catch too", () => {
    // Both factories take the same attachments, and which one renders depends on WHERE the refusal
    // landed (the notation stage's top-level catch, or a later predictor rejection). Wiring only one
    // is how the numbering prompt could not render in production while each factory passed its own
    // isolated test.
    const extra = refusalAttachmentsFromError(error, "chr1:g.1256452C>A");
    const state: any = createBiophysicalErrorAnalysisState("reference mismatch", baseParams, extra);
    expect(state.result.buildHint).toEqual(hint);
  });

  it("ignores every other error, and a malformed hint", () => {
    expect(refusalAttachmentsFromError(new Error("boom"), "chr1:g.1A>G")).toEqual({});
    expect(refusalAttachmentsFromError({ code: "TRANSLATION_FAILED" }, "chr1:g.1A>G")).toEqual({});

    /**
     * The hint is re-validated rather than trusted: a button that submits a coordinate nobody composed
     * is worse than no button. Each of these was parsed by nothing before it was rendered.
     */
    for (const buildHint of [
      undefined,
      null,
      "Chr1(GRCh37):g.1256452C>A",
      { assembly: "hg19", notation: "Chr1(GRCh37):g.1256452C>A" },
      { assembly: "GRCh37", notation: "" },
      // The instruction the prompt gives is "the spelling below states the build", so a notation that
      // states the OTHER build — or none at all — must not render at all.
      { assembly: "GRCh37", notation: "Chr1(GRCh38):g.1256452C>A" },
      { assembly: "GRCh37", notation: "chr1:g.1256452C>A" },
      { assembly: "GRCh37", notation: "p.Gly380Arg" },
      { assembly: "GRCh37", notation: `Chr1(GRCh37):g.${"1".repeat(300)}C>A` },
    ]) {
      expect(
        refusalAttachmentsFromError(
          { code: "COORDINATE_REFERENCE_MISMATCH", details: { buildHint } },
          "chr1:g.1256452C>A"
        )
      ).toEqual({});
    }
  });
});
