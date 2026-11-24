import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiRouter } from "../../routes.ts";
import * as variantParser from "./variant-parser.ts";
import { verifyNumberingProof } from "../../services/translation/numbering-proof.ts";
import type { ResidueProof } from "../../../src/shared/verifiedResidue.ts";

/**
 * POST /numbering-proof runs the analysis route's own numbering check at intake, before the browser
 * starts the requests that run in parallel with the analysis. A typed protein notation then carries a
 * signed proof to every one of them, as a translated coordinate already does.
 */
function handler() {
  const route: any = apiRouter.stack.find((layer: any) => layer.route?.path === "/numbering-proof");
  if (!route) throw new Error("Route /numbering-proof not found");
  return route.route.stack[route.route.stack.length - 1].handle;
}

async function post(body: Record<string, unknown>) {
  let status = 200;
  let json: any = null;
  const res: any = {
    status(code: number) { status = code; return this; },
    json(payload: any) { json = payload; return this; },
  };
  await handler()({ body, headers: {} }, res, () => {});
  return { status, json };
}

function parsedAs(proof: ResidueProof) {
  return {
    gene: "ACOT9", variant: "p.Arg55Ala", uniprotId: "Q9Y305", pos: 55, wt1Letter: "R", mut1Letter: "A",
    numberingAudit: { inputKind: "protein", numberingBasis: "canonical", numberingVerified: proof !== "unverified", numberingProof: proof },
  } as any;
}

describe("POST /numbering-proof", () => {
  beforeEach(() => vi.stubEnv("APP_SESSION_SECRET", "intake-test-session-secret"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("signs the residue the analysis check verified, so later requests can prove its numbering", async () => {
    vi.spyOn(variantParser, "validateAndParseVariantRequest").mockResolvedValue(parsedAs("canonical-vs-mane"));

    const { status, json } = await post({ gene: "ACOT9", variant: "p.Arg55Ala" });

    expect(status).toBe(200);
    expect(json).toMatchObject({ gene: "ACOT9", variant: "p.Arg55Ala", uniprotId: "Q9Y305", residueProof: "canonical-vs-mane" });
    const identity = { accession: "Q9Y305", position: 55, wildType: "R", mutant: "A" };
    expect(verifyNumberingProof(json.numberingProof, identity)).toEqual({ status: "valid", proof: "canonical-vs-mane" });
  });

  it("issues no proof for an unverified residue, and says it is unverified", async () => {
    vi.spyOn(variantParser, "validateAndParseVariantRequest").mockResolvedValue(parsedAs("unverified"));

    const { status, json } = await post({ gene: "ACOT9", variant: "p.Arg55Ala" });

    expect(status).toBe(200);
    expect(json.residueProof).toBe("unverified");
    expect(json).not.toHaveProperty("numberingProof");
  });

  it("leaves a refusal to the analysis check (it has already answered)", async () => {
    vi.spyOn(variantParser, "validateAndParseVariantRequest").mockImplementation(async (_req: any, res: any) => {
      res.status(422).json({ error: { code: "AMBIGUOUS_PROTEIN_NUMBERING" } });
      return null;
    });

    const { status, json } = await post({ gene: "ACOT9", variant: "p.Arg55Ala" });

    expect(status).toBe(422);
    expect(json.error.code).toBe("AMBIGUOUS_PROTEIN_NUMBERING");
  });
});
