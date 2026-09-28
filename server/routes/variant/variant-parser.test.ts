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

/**
 * Three records, like the real entry (Q9Y305 has 4): canonical, MANE (`-4`), and an unrelated
 * isoform (`-2`) that exists only to prove the ambiguity check is SCOPED. A two-record fixture
 * cannot exercise that scoping at all — it skips the MANE lookup entirely — which is how an
 * earlier version of this test asserted a call that never happened.
 */
const UNRELATED_ISOFORM = `${ACOT9_CANONICAL.slice(0, 20)}A${ACOT9_CANONICAL.slice(20)}`;

const ISOFORM_FASTA =
  `>sp|Q9Y305|ACOT9_HUMAN Acyl-coenzyme A thioesterase 9\n${ACOT9_CANONICAL}\n` +
  `>sp|Q9Y305-2|ACOT9_HUMAN Isoform 2\n${UNRELATED_ISOFORM}\n` +
  `>sp|Q9Y305-4|ACOT9_HUMAN Isoform 4\n${ACOT9_ISOFORM_4}\n`;

const fastaResponse = (text: string) =>
  ({ ok: true, status: 200, json: async () => ({}), text: async () => text }) as any;

/**
 * The MANE-Select cross-reference for the fixture entry: ACOT9's MANE protein is `NP_001032248.1`,
 * which the RefSeq xref maps to isoform `Q9Y305-4` (= `ACOT9_ISOFORM_4`). A bare notation is checked
 * against exactly this pair (canonical vs MANE), not against every isoform of the gene.
 */
const maneResponse = () =>
  ({
    ok: true,
    status: 200,
    text: async () => "",
    // Mirrors the live entry: the MANE-Select cross-reference states the isoform itself and also
    // carries `RefSeqProteinId`, which is the fallback path.
    json: async () => ({
      uniProtKBCrossReferences: [
        {
          database: "MANE-Select",
          id: "ENST00000379303.10",
          isoformId: "Q9Y305-4",
          properties: [
            { key: "RefSeqNucleotideId", value: "NM_001037171.2" },
            { key: "RefSeqProteinId", value: "NP_001032248.1" },
          ],
        },
        { database: "RefSeq", id: "NP_001032248.1", isoformId: "Q9Y305-4" },
      ],
    }),
  }) as any;

function installFetch() {
  return vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
    const target = String(url);
    if (target.includes("/uniprotkb/Q9Y305.json")) return maneResponse();
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

  it("REFUSES a notation two numberings can explain, even when it matches canonical", async () => {
    // `p.Asp85Phe` MATCHES the canonical ACOT9 sequence at 85 — and also matches the MANE protein at
    // 85, which is canonical 76. Modelling either one silently would be a coin flip, so the request
    // is refused with both candidates named.
    fetchSpy = installFetch();

    const { context, statusCode, body } = await parse({
      gene: "ACOT9",
      variant: "p.Asp85Phe",
      uniprotId: "Q9Y305",
    });

    expect(context).toBeNull();
    expect(statusCode).toBe(422);
    expect(body.error.code).toBe("AMBIGUOUS_PROTEIN_NUMBERING");
    expect(String(body.error.message)).toContain("p.Asp85Phe");
    expect(body.error.details?.candidates?.length).toBeGreaterThan(1);
  });

  it("accepts an unambiguous match and marks the numbering verified", async () => {
    fetchSpy = installFetch();

    const { context, statusCode } = await parse({
      gene: "ACOT9",
      variant: "p.Arg55Ala",
      uniprotId: "Q9Y305",
    });

    expect(statusCode).toBe(200);
    expect(context?.numberingVerified).toBe(true);
    expect(context?.numberingWarning).toBeUndefined();

    // The MANE lookup must use the FULL entry: `fields=xref_mane_select` is rejected with HTTP 400,
    // which silently degraded the check to comparing every isoform (14.8% of positions refused for
    // ACOT9 instead of 3.4%).
    const maneCall = fetchSpy.mock.calls.find((c: any[]) => String(c[0]).includes("uniprotkb/Q9Y305.json"));
    expect(maneCall).toBeDefined();
    expect(String(maneCall![0])).not.toContain("xref_mane_select");
  });

  it("accepts a forwarded coordinate ONLY with a declared, parseable build (unmapping reviews H-2/L-3/L-10)", async () => {
    fetchSpy = installFetch();

    // Coordinate without a stated build: the schema DEFAULTS assembly to GRCh38, and a defaulted
    // build beside a GRCh37 position is the wrong-locus hazard — so the coordinate is dropped.
    const withoutBuild = await parse({
      gene: "ACOT9", variant: "p.Arg55Ala", uniprotId: "Q9Y305",
      genomicCoordinates: "X-23723975-C-A",
    });
    expect(withoutBuild.statusCode).toBe(200);
    expect(withoutBuild.context?.genomicCoordinates).toBeUndefined();

    // Coordinate + declared build: forwarded verbatim for the predictor's coordinate-first query.
    const withBuild = await parse({
      gene: "ACOT9", variant: "p.Arg55Ala", uniprotId: "Q9Y305",
      genomicCoordinates: "X-23723975-C-A", assembly: "GRCh37",
    });
    expect(withBuild.statusCode).toBe(200);
    expect(withBuild.context?.genomicCoordinates).toBe("X-23723975-C-A");
    expect(withBuild.context?.assembly).toBe("GRCh37");

    // Malformed coordinate (trailing components): the strict parser refuses it despite the build.
    const malformed = await parse({
      gene: "ACOT9", variant: "p.Arg55Ala", uniprotId: "Q9Y305",
      genomicCoordinates: "X-23723975-C-A-junk", assembly: "GRCh37",
    });
    expect(malformed.context?.genomicCoordinates).toBeUndefined();
  });

  /**
   * The canonical pair the translation step verified travels BESIDE the submitted pair.
   *
   * The predictor queries VEP by coordinate, so a GRCh37 pair would be lifted a second time there
   * (or refused by every GRCh38-only source). Both pairs stay intact: the submitted one is what a
   * report cites, the canonical one is where the annotation came from — and pairing either with the
   * wrong build is the wrong-locus hazard this route exists to refuse.
   */
  it("accepts the verified canonical pair alongside the submitted pair, and drops an unpaired one", async () => {
    fetchSpy = installFetch();

    const both = await parse({
      gene: "ACOT9", variant: "p.Arg55Ala", uniprotId: "Q9Y305",
      genomicCoordinates: "X-23723975-C-A", assembly: "GRCh37",
      liftedGenomicCoordinates: "X-23705858-C-A", resolvedAssembly: "GRCh38",
      coordinateLift: {
        status: "lifted",
        fromAssembly: "GRCh37",
        toAssembly: "GRCh38",
        fromCoordinates: "X-23723975-C-A",
        toCoordinates: "X-23705858-C-A",
        reverseVerified: true,
      },
    });

    expect(both.statusCode).toBe(200);
    // Submitted pair unchanged — this is what the caller entered.
    expect(both.context?.genomicCoordinates).toBe("X-23723975-C-A");
    expect(both.context?.assembly).toBe("GRCh37");
    // Verified canonical pair, carried for the predictor.
    expect(both.context?.liftedGenomicCoordinates).toBe("X-23705858-C-A");
    expect(both.context?.resolvedAssembly).toBe("GRCh38");
    expect(both.context?.coordinateLift?.status).toBe("lifted");

    // A canonical coordinate with NO stated build is dropped rather than assumed canonical: the
    // pairing is the point, and a coordinate's build is never ours to assume.
    const unpaired = await parse({
      gene: "ACOT9", variant: "p.Arg55Ala", uniprotId: "Q9Y305",
      genomicCoordinates: "X-23723975-C-A", assembly: "GRCh37",
      liftedGenomicCoordinates: "X-23705858-C-A",
    });
    expect(unpaired.statusCode).toBe(200);
    expect(unpaired.context?.liftedGenomicCoordinates).toBeUndefined();
    expect(unpaired.context?.resolvedAssembly).toBeUndefined();

    // Malformed canonical coordinate: refused even with a build beside it.
    const malformedLift = await parse({
      gene: "ACOT9", variant: "p.Arg55Ala", uniprotId: "Q9Y305",
      liftedGenomicCoordinates: "X-23705858-C-A-junk", resolvedAssembly: "GRCh38",
    });
    expect(malformedLift.context?.liftedGenomicCoordinates).toBeUndefined();
  });

  it("discloses an unverifiable numbering instead of silently trusting canonical", async () => {
    // Sequence fetch succeeds, isoform model fails: the analysis proceeds (an outage must not break
    // a valid query) but it is labelled unverified rather than presented as a clean canonical match.
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
      const target = String(url);
      if (target.includes("/stream")) throw new Error("network down");
      if (target.includes(".fasta")) {
        return fastaResponse(`>sp|Q9Y305|ACOT9_HUMAN\n${ACOT9_CANONICAL}\n`);
      }
      throw new Error(`unexpected fetch: ${target}`);
    });

    const { context, statusCode } = await parse({
      gene: "ACOT9",
      variant: "p.Arg55Ala",
      uniprotId: "Q9Y305",
    });

    expect(statusCode).toBe(200);
    expect(context?.numberingVerified).toBe(false);
    expect(context?.numberingWarning).toContain("Numbering not verified");
  });

  it("ACCEPTS the canonical reading when the reader confirms it, instead of looping", async () => {
    // The refusal is a question, and `numberingBasis: "canonical"` is the answer. Without it the
    // canonical candidate's variant is byte-identical to the input, so re-submitting it was refused
    // identically — the canonical reading was unselectable and the prompt looped forever.
    fetchSpy = installFetch();

    const { context, statusCode } = await parse({
      gene: "ACOT9",
      variant: "p.Asp85Phe",
      uniprotId: "Q9Y305",
      numberingBasis: "canonical",
    });

    expect(statusCode).toBe(200);
    expect(context?.numberingVerified).toBe(true);
    expect(context?.numberingDisambiguated).toBe(true);
    expect(context?.numberingWarning).toBeUndefined();
  });

  it("still refuses the same notation when nothing was confirmed", async () => {
    fetchSpy = installFetch();

    const { statusCode } = await parse({
      gene: "ACOT9",
      variant: "p.Asp85Phe",
      uniprotId: "Q9Y305",
    });

    expect(statusCode).toBe(422);
  });

  it("does not let a confirmation settle a WILD-TYPE MISMATCH", async () => {
    // At the mismatch site the canonical reading is not consistent with the sequence at all, so
    // confirming canonical numbering must not turn a wrong residue into an accepted one.
    fetchSpy = installFetch();

    const { statusCode } = await parse({
      gene: "ACOT9",
      variant: "p.Lys281Asn",
      uniprotId: "Q9Y305",
      numberingBasis: "canonical",
    });

    expect(statusCode).toBe(422);
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
