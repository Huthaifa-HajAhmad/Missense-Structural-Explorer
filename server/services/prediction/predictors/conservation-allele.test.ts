import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  genos: vi.fn(),
  dbnsfpOrg: vi.fn(),
  alphagenome: vi.fn(),
  gpnByCoordinate: vi.fn(),
}));
vi.mock("../../external-api/genos_web.ts", () => ({ queryGenosWebservice: mocks.genos }));
vi.mock("./dbnsfp-query.ts", () => ({ queryDbnsfpOrg: mocks.dbnsfpOrg }));
vi.mock("../dbnsfp_local.ts", () => ({
  isLocalDbnsfpAvailable: () => true,
  queryLocalDbnsfpVariant: vi.fn(async () => ({ revel: 0.9, gerp: 5, phylop: 7, popeve: null })),
  readLocalDbnsfpVersion: () => "dbNSFP 5.3a",
}));
vi.mock("../../external-api/alphagenome-bridge.ts", () => ({ fetchAlphaGenome: mocks.alphagenome }));
vi.mock("../../external-api/gpn.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../external-api/gpn.ts")>()),
  fetchGpnStarByCoordinate: mocks.gpnByCoordinate,
  fetchGpnStarScore: vi.fn(async () => ({ score: null, status: "unavailable" })),
}));

import { fetchConservationData, fetchConservationDataProgressive } from "./conservation-orchestrator.ts";
import { clearAllCaches } from "../../infra/cache.ts";

/**
 * REVEL, BayesDel, MetaRNN and the rest are scores of a NUCLEOTIDE change, and one protein change
 * can be encoded by several. The remote tiers answer a `GENE:p.…` query with whichever row comes
 * first, so when the analysed allele is known (and on the build those services index) it is what
 * they must be asked about.
 */
describe("conservation scores are keyed to the analysed allele", () => {
  const proteinGenosRecord = { revel: 0.11, gerp: 1, phylop: 1, popeve: null };

  beforeEach(() => {
    clearAllCaches(true);
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    mocks.genos.mockResolvedValue(null);
    mocks.dbnsfpOrg.mockResolvedValue(null);
    mocks.alphagenome.mockResolvedValue({ status: "unavailable" });
    mocks.gpnByCoordinate.mockResolvedValue({ score: null, status: "unavailable" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const run = (pred: { gnomadVariantId: string; gnomadVariantAssembly?: string }) =>
    fetchConservationDataProgressive({
      gene: "TP53",
      variant: "p.Arg273His",
      pos: 273,
      predictorPromise: Promise.resolve(pred) as any,
      genosPromise: Promise.resolve(proteinGenosRecord),
    });

  it("asks Genos by GRCh38 coordinate instead of reusing the protein-keyed record", async () => {
    // Local store off for this case: the remote tiers are what is under test.
    const local = await import("../dbnsfp_local.ts");
    vi.spyOn(local, "isLocalDbnsfpAvailable").mockReturnValue(false);
    mocks.genos.mockResolvedValue({ revel: 0.77, gerp: 5, phylop: 7, popeve: null });

    const result = await run({ gnomadVariantId: "17-7673802-C-T", gnomadVariantAssembly: "GRCh38" });

    expect(mocks.genos).toHaveBeenCalledWith("TP53", "p.Arg273His", "17-7673802-C-T");
    expect(result.revel).toBe(0.77);
  });

  it("falls to query.dbnsfp.org with the same coordinate", async () => {
    const local = await import("../dbnsfp_local.ts");
    vi.spyOn(local, "isLocalDbnsfpAvailable").mockReturnValue(false);
    await run({ gnomadVariantId: "17-7673802-C-T", gnomadVariantAssembly: "GRCh38" });
    expect(mocks.dbnsfpOrg).toHaveBeenCalledWith("TP53", "p.Arg273His", "17-7673802-C-T");
  });

  it("keeps the protein query when the coordinate is not GRCh38 (those services index GRCh38 only)", async () => {
    const local = await import("../dbnsfp_local.ts");
    vi.spyOn(local, "isLocalDbnsfpAvailable").mockReturnValue(false);
    const result = await run({ gnomadVariantId: "17-7577120-C-T", gnomadVariantAssembly: "GRCh37" });

    // The early protein-keyed record is used as before; no hg19 position reaches an hg38 index.
    expect(result.revel).toBe(0.11);
    expect(mocks.genos).not.toHaveBeenCalled();
  });

  it("does not repeat the caller's coordinate enrichment inside the base fetch", async () => {
    await run({ gnomadVariantId: "17-7673802-C-T", gnomadVariantAssembly: "GRCh38" });
    // Once each, from the progressive enrichment — not a second time from the local-store branch.
    expect(mocks.alphagenome).toHaveBeenCalledTimes(1);
    expect(mocks.gpnByCoordinate).toHaveBeenCalledTimes(1);
  });

  it("asks the local store for the GRCh38 allele, so a protein change with two alleles still resolves", async () => {
    const local = await import("../dbnsfp_local.ts");
    await run({ gnomadVariantId: "17-7673802-C-T", gnomadVariantAssembly: "GRCh38" });
    expect(vi.mocked(local.queryLocalDbnsfpVariant)).toHaveBeenCalledWith(
      "TP53", 273, null, null, "p.Arg273His",
      { chrom: "17", pos: 7673802, ref: "C", alt: "T", assembly: "GRCh38" }
    );
  });

  it("keeps the protein-only local match for a non-GRCh38 coordinate", async () => {
    const local = await import("../dbnsfp_local.ts");
    await run({ gnomadVariantId: "17-7577120-C-T", gnomadVariantAssembly: "GRCh37" });
    expect(vi.mocked(local.queryLocalDbnsfpVariant)).toHaveBeenCalledWith("TP53", 273, null, null, "p.Arg273His", null);
  });

  it("still enriches by coordinate when called directly (no caller to do it)", async () => {
    await fetchConservationData("TP53", "p.Arg273His", null, null, 273, "17-7673802-C-T", null, null, null, null, "GRCh38");
    expect(mocks.alphagenome).toHaveBeenCalledTimes(1);
    expect(mocks.gpnByCoordinate).toHaveBeenCalledTimes(1);
  });
});
