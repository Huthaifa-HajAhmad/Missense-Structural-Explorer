import { describe, it, expect } from "vitest";

import { refusalAttachmentsFromError } from "../workflowOrchestrator";
import {
  createBiophysicalErrorAnalysisState,
  createTopLevelErrorAnalysisState,
} from "../pipelineStateFactory";
import { REFUSAL_CODES } from "../../../shared/contracts";

/**
 * The ambiguity payload must survive TWO hops to reach a component: the client's error contract
 * (covered in `src/api/__tests__/apiError.test.ts`) and the pipeline state. Without the second hop the
 * refusal still arrives as a message with nothing to click.
 */
describe("numbering choices reach the analysis state", () => {
  const error = Object.assign(new Error("ambiguous"), {
    code: "AMBIGUOUS_PROTEIN_NUMBERING",
    details: {
      notation: "p.Asp85Phe",
      candidates: [
        { variant: "p.Asp85Phe", basisId: "Q9Y305", basisKind: "canonical", canonicalPosition: 85 },
        { variant: "p.Asp76Phe", basisId: "Q9Y305-4", basisKind: "isoform", canonicalPosition: 76 },
      ],
    },
  });

  it("extracts numbering choices from an error that carries them", () => {
    const extra = refusalAttachmentsFromError(error, "p.Asp85Phe");
    expect(extra.numberingChoices).toHaveLength(2);
    expect(extra.numberingNotation).toBe("p.Asp85Phe");
  });

  it("carries numbering choices through createTopLevelErrorAnalysisState", () => {
    const extra = refusalAttachmentsFromError(error, "p.Asp85Phe");
    const state: any = createTopLevelErrorAnalysisState(
      "ambiguous",
      {
        gene: "ACOT9",
        variant: "p.Asp85Phe",
        uniprotId: "Q9Y305",
        residueIndex: 85,
        wildType: "Asp",
        mutant: "Phe",
      } as any,
      extra
    );

    expect(state.result.numberingChoices).toHaveLength(2);
    expect(state.result.numberingNotation).toBe("p.Asp85Phe");
  });

  it("carries numbering choices through createBiophysicalErrorAnalysisState", () => {
    const extra = refusalAttachmentsFromError(error, "p.Asp85Phe");

    const state: any = createBiophysicalErrorAnalysisState(
      "ambiguous",
      {
        gene: "ACOT9",
        variant: "p.Asp85Phe",
        uniprotId: "Q9Y305",
        residueIndex: 85,
        wildType: "Asp",
        mutant: "Phe",
      } as any,
      extra
    );

    expect(state.result.numberingChoices).toHaveLength(2);
    expect(state.result.numberingNotation).toBe("p.Asp85Phe");
  });

  it("extracts structured non-missense refusal with intronic codon exclusion", () => {
    const nonMissenseErr = Object.assign(new Error("Protein effect unknown"), {
      code: REFUSAL_CODES.nonMissenseVariant,
      details: {
        gene: "BMI1",
        hgvsc: "NM_005180.9:c.317-21C>G",
        hgvsp: "p.?",
        consequence: ["intron_variant"],
      },
    });

    const extra = refusalAttachmentsFromError(nonMissenseErr, "Chr10:g.22327929C>G");
    expect(extra.nonMissenseRefusal).toBeDefined();
    expect(extra.nonMissenseRefusal?.gene).toBe("BMI1");
    expect(extra.nonMissenseRefusal?.hgvsc).toBe("NM_005180.9:c.317-21C>G");
    expect(extra.nonMissenseRefusal?.hasCodon).toBe(false);
    expect(extra.nonMissenseRefusal?.isCoding).toBe(false);
    expect(extra.nonMissenseRefusal?.reason).toContain("Intronic variant: does not alter a coding sequence or codon.");

    const state = createTopLevelErrorAnalysisState("Non-missense", { gene: "BMI1", variant: "p.?" } as any, extra);
    expect(state.result.nonMissenseRefusal?.hasCodon).toBe(false);
  });

  it("ignores every other error, and a malformed payload", () => {
    expect(refusalAttachmentsFromError(new Error("boom"), "p.Ala1Val")).toEqual({});
    expect(refusalAttachmentsFromError({ code: "UNPROCESSABLE_ENTITY" }, "p.Ala1Val")).toEqual({});
    expect(
      refusalAttachmentsFromError({ code: "AMBIGUOUS_PROTEIN_NUMBERING", details: { candidates: "nope" } }, "p.Ala1Val")
    ).toEqual({});
  });
});
