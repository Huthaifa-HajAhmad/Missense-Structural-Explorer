import { describe, it, expect } from "vitest";

import { ApiError, extractApiError } from "../authSession";

/**
 * `extractErrorMessage` returns a string, so every call site threw `new Error(message)` and the
 * machine-readable parts of a failure were destroyed there. That is what turned the ambiguous-numbering
 * refusal — which names the two readings of a notation — into a dead end the UI could not act on.
 */
describe("extractApiError", () => {
  const jsonResponse = (body: unknown, status = 422) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  it("keeps the code, the details and the message together", async () => {
    const choices = [
      { variant: "p.Asp85Phe", basisId: "Q9Y305", basisKind: "canonical", canonicalPosition: 85 },
      { variant: "p.Asp76Phe", basisId: "Q9Y305-4", basisKind: "isoform", canonicalPosition: 76 },
    ];

    const error = await extractApiError(
      jsonResponse({
        error: {
          code: "AMBIGUOUS_PROTEIN_NUMBERING",
          message: "cannot be resolved by residue number alone",
          details: { notation: "p.Asp85Phe", candidates: choices },
        },
      }),
      "Failed"
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("AMBIGUOUS_PROTEIN_NUMBERING");
    expect(error.status).toBe(422);
    expect(error.message).toContain("residue number alone");
    expect((error.details as any).candidates).toHaveLength(2);
    expect((error.details as any).notation).toBe("p.Asp85Phe");
  });

  it("survives BOTH biophysics paths, including the streaming one the pipeline prefers", async () => {
    // The pipeline always takes the streaming method when it exists, and that method used to flatten
    // the error to a string — so the ambiguity payload never arrived even though this helper existed.
    const { createBiophysicsApi } = await import("../biophysicsApi");
    const refusal = new Response(
      JSON.stringify({
        error: {
          code: "AMBIGUOUS_PROTEIN_NUMBERING",
          message: "cannot be resolved by residue number alone",
          details: { notation: "p.Asp85Phe", candidates: [{ variant: "p.Asp85Phe", basisId: "Q9Y305", basisKind: "canonical", canonicalPosition: 85 }] },
        },
      }),
      { status: 422, headers: { "content-type": "application/json" } }
    );
    const api = createBiophysicsApi((async () => refusal.clone()) as any);

    const fromStream: any = await api
      .streamBiophysicalAnalysis({ gene: "ACOT9", uniprotId: "Q9Y305", variant: "p.Asp85Phe" }, () => {})
      .catch((e) => e);
    expect(fromStream).toBeInstanceOf(ApiError);
    expect(fromStream.code).toBe("AMBIGUOUS_PROTEIN_NUMBERING");
    expect(fromStream.details.candidates).toHaveLength(1);

    const fromPlain: any = await api
      .getBiophysicalAnalysis({ gene: "ACOT9", uniprotId: "Q9Y305", variant: "p.Asp85Phe" })
      .catch((e) => e);
    expect(fromPlain).toBeInstanceOf(ApiError);
    expect(fromPlain.code).toBe("AMBIGUOUS_PROTEIN_NUMBERING");
  });

  it("still reports a plain-body failure with its status, and never throws on an unreadable body", async () => {
    const plain = await extractApiError(
      new Response("upstream exploded", { status: 502 }),
      "Failed to analyze"
    );
    expect(plain.code).toBeUndefined();
    expect(plain.status).toBe(502);
    expect(plain.message).toContain("upstream exploded");

    const empty = await extractApiError(
      new Response("", { status: 503, headers: { "content-type": "application/json" } }),
      "Service unavailable"
    );
    expect(empty.status).toBe(503);
    expect(empty.message).toContain("503");
  });
});
