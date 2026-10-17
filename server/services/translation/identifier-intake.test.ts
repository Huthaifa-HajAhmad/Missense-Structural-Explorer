import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../infra/http-client.ts", () => ({ fetchWithRetry: vi.fn() }));

import { fetchWithRetry } from "../infra/http-client.ts";
import {
  clearIdentifierIntakeCache,
  currentEnsemblTranscriptNotation,
  resolveIdentifierIntake,
} from "./identifier-intake.ts";

const json = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as any;

/** Shapes taken from live responses (Ensembl Variation, ClinVar esummary, Ensembl lookup). */
const ensemblVariation = (allele_string: string, strand = 1) => ({
  name: "rs113488022",
  mappings: [
    {
      coord_system: "chromosome",
      assembly_name: "GRCh38",
      seq_region_name: "7",
      start: 140753336,
      end: 140753336,
      strand,
      allele_string,
    },
    // Patch/alt-haplotype placements are not chromosome coordinates the pipeline can use.
    { coord_system: "chromosome", assembly_name: "GRCh38", seq_region_name: "HG2_PATCH", start: 1, end: 1, strand: 1, allele_string: "A/T" },
  ],
});

const clinvarSummary = (spdis: string[]) => ({
  result: {
    uids: ["13961"],
    "13961": { variation_set: spdis.map((canonical_spdi) => ({ canonical_spdi })) },
  },
});

const nae1Lookup = {
  display_name: "NAE1",
  biotype: "protein_coding",
  canonical_transcript: "ENST00000290810.8",
};

describe("resolveIdentifierIntake", () => {
  beforeEach(() => {
    clearIdentifierIntakeCache();
    vi.mocked(fetchWithRetry).mockReset();
  });

  it('explains a mixed ClinVar record without claiming it contains only one variant', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(json(clinvarSummary(['NC_000007.14:140753335:A:T', 'NC_000007.14:140753335:AC:A'])));
    const outcome = await resolveIdentifierIntake('VCV000013961');
    expect(outcome).toMatchObject({ status: 'refused', code: 'AMBIGUOUS_IDENTIFIER', httpStatus: 422, candidates: ['7-140753336-A-T'] });
    if (outcome.status !== 'refused') throw new Error('Expected a refusal');
    expect(outcome.message).toContain('both single-nucleotide and non-single-nucleotide');
    expect(outcome.message).toContain('exact genomic coordinate');
    expect(outcome.message).not.toContain('1 different variants');
    // Mixed responses are not cached as though they were a unique SNV.
    expect((await resolveIdentifierIntake('VCV000013961')).status).toBe('refused');
    expect(fetchWithRetry).toHaveBeenCalledTimes(2);
  });

  it("refuses a multi-allelic rsID and lists every allele instead of picking one", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(json(ensemblVariation("A/C/G/T")));
    const outcome = await resolveIdentifierIntake("rs113488022");
    expect(outcome).toMatchObject({ status: "refused", code: "AMBIGUOUS_IDENTIFIER", httpStatus: 422 });
    expect(outcome.status === "refused" && outcome.candidates).toEqual([
      "7-140753336-A-C",
      "7-140753336-A-G",
      "7-140753336-A-T",
    ]);
  });

  it("rewrites a single-allele rsID to its GRCh38 coordinate and says so", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(json(ensemblVariation("A/T")));
    const outcome = await resolveIdentifierIntake("RS113488022");
    expect(outcome).toMatchObject({
      status: "rewritten",
      notation: "7-140753336-A-T",
      resolution: { method: "dbsnp-rsid", submitted: "RS113488022", resolvedNotation: "7-140753336-A-T" },
    });
  });

  it("writes reverse-strand alleles on the forward strand", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(json(ensemblVariation("T/A", -1)));
    const outcome = await resolveIdentifierIntake("rs113488022");
    expect(outcome).toMatchObject({ status: "rewritten", notation: "7-140753336-A-T" });
  });

  it("answers 404 for an unknown rsID rather than an outage", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(json({ error: "not found" }, 400));
    const outcome = await resolveIdentifierIntake("rs1");
    expect(outcome).toMatchObject({ status: "refused", code: "IDENTIFIER_NOT_FOUND", httpStatus: 404 });
  });

  it("reports an unreachable identifier service as an upstream failure, not as 'not found'", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(json({}, 503));
    await expect(resolveIdentifierIntake("rs113488022")).rejects.toMatchObject({
      name: "CoordinateResolutionError",
      kind: "upstream_unavailable",
    });
  });

  it("converts a ClinVar canonical SPDI (0-based) to a 1-based coordinate", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(json(clinvarSummary(["NC_000007.14:140753335:A:T"])));
    const outcome = await resolveIdentifierIntake("VCV000013961");
    expect(outcome).toMatchObject({ status: "rewritten", notation: "7-140753336-A-T" });
    expect(vi.mocked(fetchWithRetry).mock.calls[0][0]).toContain("id=13961");
  });

  it("refuses a ClinVar record that is not a single-nucleotide variant", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(json(clinvarSummary(["NC_000007.14:140753335:AC:A"])));
    const outcome = await resolveIdentifierIntake("VCV000013961");
    expect(outcome).toMatchObject({ status: "refused", code: "NON_MISSENSE_VARIANT" });
  });

  it("pins a gene-qualified cDNA to the gene's canonical (MANE Select) transcript before any provider sees it", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(json(nae1Lookup));
    const outcome = await resolveIdentifierIntake("NAE1:c.347A>G");
    expect(outcome).toMatchObject({
      status: "rewritten",
      notation: "ENST00000290810.8:c.347A>G",
      resolution: { method: "gene-canonical-transcript" },
    });
    // The light lookup, not the expanded transcript list that timed out under load.
    expect(String(vi.mocked(fetchWithRetry).mock.calls[0][0])).not.toContain("expand=1");
  });

  it.each(["HLA-A", "NKX2-1"])("pins hyphenated gene symbols too (%s)", async (gene) => {
    vi.mocked(fetchWithRetry).mockResolvedValue(json({ biotype: "protein_coding", canonical_transcript: "ENST00000376809.10" }));
    const outcome = await resolveIdentifierIntake(`${gene}:c.123A>G`);
    expect(outcome).toMatchObject({ status: "rewritten", notation: "ENST00000376809.10:c.123A>G" });
  });

  it("refuses a non-coding or unknown gene instead of letting VEP spread the c. across transcripts", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(json({ display_name: "FAKE1", biotype: "lncRNA", canonical_transcript: "ENST1.1" }));
    expect(await resolveIdentifierIntake("FAKE1:c.10A>G")).toMatchObject({ status: "refused", code: "IDENTIFIER_NOT_FOUND" });
    vi.mocked(fetchWithRetry).mockResolvedValue(json({ error: "not found" }, 400));
    expect(await resolveIdentifierIntake("NOPE1:c.10A>G")).toMatchObject({ status: "refused", code: "IDENTIFIER_NOT_FOUND" });
  });

  it("tells a known indel rsID apart from an unknown one", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(
      json({ mappings: [{ coord_system: "chromosome", assembly_name: "GRCh38", seq_region_name: "17", start: 43057062, end: 43057063, strand: 1, allele_string: "-/G" }] })
    );
    expect(await resolveIdentifierIntake("rs80357906")).toMatchObject({ status: "refused", code: "NON_MISSENSE_VARIANT" });
  });

  it.each([
    "NM_004333.6:c.1799T>A",
    "ENST00000288602.11:c.1799T>A",
    "LRG_299t1:c.1799T>A",
    "chr7:g.140753336A>T",
    "7-140753336-A-T",
    "p.Val600Glu",
    "c.1799T>A",
  ])("leaves %j untouched and makes no request", async (input) => {
    const outcome = await resolveIdentifierIntake(input);
    expect(outcome).toEqual({ status: "unchanged", notation: input });
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });
});

describe("currentEnsemblTranscriptNotation", () => {
  beforeEach(() => vi.mocked(fetchWithRetry).mockReset());
  // Cleared after each test as well: a spy left holding a THROWN result failed the test after its
  // assertions had passed (observed with vitest 4; the code under test returned null as expected).
  afterEach(() => vi.mocked(fetchWithRetry).mockReset());

  it("offers the current version of a retired Ensembl transcript, body unchanged", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(json({ id: "ENST00000646891", version: 2 }));
    expect(await currentEnsemblTranscriptNotation("ENST00000646891.1:c.1799T>A")).toBe("ENST00000646891.2:c.1799T>A");
    expect(String(vi.mocked(fetchWithRetry).mock.calls[0][0])).toContain("/lookup/id/ENST00000646891?");
  });

  it("offers nothing when the stated version is current", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(json({ id: "ENST00000646891", version: 2 }));
    expect(await currentEnsemblTranscriptNotation("ENST00000646891.2:c.1799T>A")).toBeNull();
  });

  it("offers nothing for unversioned, RefSeq or protein notations, without asking Ensembl", async () => {
    for (const notation of ["ENST00000646891:c.1799T>A", "NM_004333.4:c.1799T>A", "ENSP00000493543.1:p.Val600Glu"]) {
      expect(await currentEnsemblTranscriptNotation(notation)).toBeNull();
    }
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it("offers nothing when Ensembl cannot be asked", async () => {
    vi.mocked(fetchWithRetry).mockImplementation(() => {
      throw new TypeError("fetch failed");
    });
    expect(await currentEnsemblTranscriptNotation("ENST00000646891.1:c.1799T>A")).toBeNull();
  });
});
