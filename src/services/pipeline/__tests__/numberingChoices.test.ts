import { describe, it, expect } from "vitest";

import { refusalAttachmentsFromError } from "../workflowOrchestrator";
import {
  createBiophysicalErrorAnalysisState,
  createTopLevelErrorAnalysisState,
} from "../pipelineStateFactory";

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

  it("carries the labelled choices into the error state's result", () => {
    const extra = refusalAttachmentsFromError(error, "p.Asp85Phe");
    expect(extra.numberingChoices).toHaveLength(2);

    const state: any = createTopLevelErrorAnalysisState("ambiguous", {
      gene: "ACOT9",
      variant: "p.Asp85Phe",
      uniprotId: "Q9Y305",
      residueIndex: "85",
      wildType: "Asp",
      mutant: "Phe",
    } as any, extra);

    expect(state.result.numberingChoices).toHaveLength(2);
    expect(state.result.numberingNotation).toBe("p.Asp85Phe");
    // The refusal is still an error — the prompt supplements the message, it does not replace it.
    expect(state.error).toContain("ambiguous");
  });

  it("reaches the state through the BIOPHYSICAL catch, which is where the refusal actually lands", () => {
    // `fetchBiophysicalAnalysis` rejects and is consumed by a `.catch`, so an enclosing try/catch never
    // sees it. The first version wired the extras only into the top-level factory: the prompt could not
    // render in production while both factories passed their own isolated tests.
    const extra = refusalAttachmentsFromError(error, "p.Asp85Phe");

    const state: any = createBiophysicalErrorAnalysisState(
      "ambiguous",
      {
        gene: "ACOT9",
        variant: "p.Asp85Phe",
        uniprotId: "Q9Y305",
        residueIndex: "85",
        wildType: "Asp",
        mutant: "Phe",
      } as any,
      extra
    );

    expect(state.result.numberingChoices).toHaveLength(2);
    expect(state.result.numberingNotation).toBe("p.Asp85Phe");
  });

  it("ignores every other error, and a malformed payload", () => {
    expect(refusalAttachmentsFromError(new Error("boom"), "p.Ala1Val")).toEqual({});
    expect(refusalAttachmentsFromError({ code: "UNPROCESSABLE_ENTITY" }, "p.Ala1Val")).toEqual({});
    expect(
      refusalAttachmentsFromError({ code: "AMBIGUOUS_PROTEIN_NUMBERING", details: { candidates: "nope" } }, "p.Ala1Val")
    ).toEqual({});
  });
});
