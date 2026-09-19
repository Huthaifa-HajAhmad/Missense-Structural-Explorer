import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { validateAndParseVariantRequest } from "./variant-parser.ts";
import { clearAllCaches } from "../../services/infra/cache.ts";
import { resetHostStateForTests } from "../../services/infra/http-client.ts";
import { ACOT9_CANONICAL, ACOT9_ISOFORM_4 } from "../../services/translation/__fixtures__/acot9.ts";

/**
 * The analysis path takes protein input and resolves it BY RESIDUE INDEX against the canonical
 * sequence, so it can neither convert nor repair a notation that belongs to another protein. Two
 * review findings live here:
 *   - an accession-qualified notation was accepted and read canonically (the parser strips the
 *     accession), silently mutating a different residue;
 *   - a wild-type mismatch — the common symptom of a MANE-numbered notation — was reported with a
 *     remedy ("qualify the notation") that this route itself rejected.
 */

const ISOFORM_FASTA =
  `>sp|Q9Y305|ACOT9_HUMAN Acyl-coenzyme A thioesterase 9\n${ACOT9_CANONICAL}\n` +
  `>sp|Q9Y305-4|ACOT9_HUMAN Isoform 4\n${ACOT9_ISOFORM_4}\n`;

const fastaResponse = (text: string) =>
  ({ ok: true, status: 200, json: async () => ({}), text: async () => text }) as any;

function installFetch() {
  return vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
    const target = String(url);
    if (target.includes("/stream")) return fastaResponse(ISOFORM_FASTA);
    if (target.includes(".fasta")) return fastaResponse(`>sp|Q9Y305|ACOT9_HUMAN\n${ACOT9_CANONICAL}\n`);
    throw new Error(`unexpected fetch: ${target}`);
  });
}

async function parse(body: Record<string, unknown>) {
  let statusCode = 200;
  let payload: any = null;
  const req: any = { body, headers: {} };
  const res: any = {
    status(code: number) { statusCode = code; return this; },
    json(value: any) { payload = value; return this; },
    getHeader: () => undefined,
    setHeader: () => {},
  };
  const context = await validateAndParseVariantRequest(req, res);
  return { context, statusCode, body: payload };
}

describe("analysis path — protein notation handling", () => {
  let fetchSpy: any;

  beforeEach(() => {
    clearAllCaches(true);
    resetHostStateForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("REFUSES an accession-qualified notation instead of reading its position canonically", async () => {
    const { context, statusCode, body } = await parse({
      gene: "ACOT9",
      variant: "NP_001032248.1:p.Arg64Ala",
      uniprotId: "Q9Y305",
    });

    expect(context).toBeNull();
    expect(statusCode).toBe(422);
    // The position would otherwise be applied to CANONICAL residue 64 — a different residue.
    expect(body.error.message).toContain("must be resolved before analysis");
    expect(body.error.message).toContain("/api/v1/translate-variant");
  });

  it("names the canonical-equivalent substitution for a MANE-numbered notation", async () => {
    fetchSpy = installFetch();

    const { context, statusCode, body } = await parse({
      gene: "ACOT9",
      variant: "p.Lys281Asn",
      uniprotId: "Q9Y305",
    });

    expect(context).toBeNull();
    expect(statusCode).toBe(422);
    // Diagnosed, not just rejected: the isoform model says this is Q9Y305-4 numbering, and the
    // canonical-equivalent notation is named so the user has a working next step in THIS route.
    expect(body.error.message).toContain("numbered on Q9Y305-4");
    expect(body.error.message).toContain("p.Lys272Asn");
  });

  it("keeps the previous guidance when the numbering cannot be diagnosed", async () => {
    // The canonical sequence fetch must succeed and the ISOFORM model must fail: the answer then
    // stays actionable instead of turning a diagnosis into a provider error.
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
      const target = String(url);
      if (target.includes("/stream")) throw new Error("network down");
      if (target.includes(".fasta")) {
        return fastaResponse(`>sp|Q9Y305|ACOT9_HUMAN\n${ACOT9_CANONICAL}\n`);
      }
      throw new Error(`unexpected fetch: ${target}`);
    });

    const { context, statusCode, body } = await parse({
      gene: "ACOT9",
      variant: "p.Lys281Asn",
      uniprotId: "Q9Y305",
    });

    expect(context).toBeNull();
    expect(statusCode).toBe(422);
    expect(body.error.message).toContain("Wild-type residue mismatch");
    expect(body.error.message).toContain("NP_001032248.1:p.Lys281Asn");
  });
});
