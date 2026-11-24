import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  dbnsfpOrg: vi.fn(),
  alphagenome: vi.fn(),
}));
vi.mock("./dbnsfp-query.ts", () => ({ queryDbnsfpOrg: mocks.dbnsfpOrg }));
vi.mock("../dbnsfp_local.ts", () => ({
  isLocalDbnsfpAvailable: () => true,
  queryLocalDbnsfpVariant: vi.fn(async () => ({ revel: 0.9, gerp: 5, phylop: 7, popeve: null })),
  readLocalDbnsfpVersion: () => "dbNSFP 5.3a",
}));
vi.mock("../../external-api/alphagenome-bridge.ts", () => ({ fetchAlphaGenome: mocks.alphagenome }));

import { fetchConservationData, fetchConservationDataProgressive, conservationSnapshot } from "./conservation-orchestrator.ts";
import { clearAllCaches } from "../../infra/cache.ts";

/**
 * REVEL, BayesDel, MetaRNN and the rest are scores of a NUCLEOTIDE change, and one protein change
 * can be encoded by several. The remote tiers answer a `GENE:p.…` query with whichever row comes
 * first, so when the analysed allele is known (and on the build those services index) it is what
 * they must be asked about.
 */
describe("conservation scores are keyed to the analysed allele", () => {
  const noScores = {
    revel: null, gerp: null, phylop: null, bayesdel: null, metarnn: null, metarnnPred: null,
    clinpred: null, clinpredPred: null, esm1b: null, esm1bPred: null, popeve: null,
    aouFrequency: null, spliceai: null,
  };
  beforeEach(() => {
    clearAllCaches(true);
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    mocks.dbnsfpOrg.mockResolvedValue(null);
    mocks.alphagenome.mockResolvedValue({ status: "unavailable" });
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
    });

  it("asks query.dbnsfp.org by GRCh38 coordinate when the local store is absent", async () => {
    const local = await import("../dbnsfp_local.ts");
    vi.spyOn(local, "isLocalDbnsfpAvailable").mockReturnValue(false);
    mocks.dbnsfpOrg.mockResolvedValue({ ...noScores, revel: 0.77, gerp: 5 });

    const result = await run({ gnomadVariantId: "17-7673802-C-T", gnomadVariantAssembly: "GRCh38" });

    expect(mocks.dbnsfpOrg).toHaveBeenCalledWith("TP53", "p.Arg273His", "17-7673802-C-T");
    expect(result.revel).toBe(0.77);
    expect(result.revelProvenance).toBe("query.dbnsfp.org (release not stated)");
  });

  it("keeps the protein query when the coordinate is not GRCh38 (those services index GRCh38 only)", async () => {
    const local = await import("../dbnsfp_local.ts");
    vi.spyOn(local, "isLocalDbnsfpAvailable").mockReturnValue(false);
    await run({ gnomadVariantId: "17-7577120-C-T", gnomadVariantAssembly: "GRCh37" });

    // No hg19 position reaches an hg38 index.
    expect(mocks.dbnsfpOrg).toHaveBeenCalledWith("TP53", "p.Arg273His", null);
  });

  it("does not repeat the caller's coordinate enrichment inside the base fetch", async () => {
    await run({ gnomadVariantId: "17-7673802-C-T", gnomadVariantAssembly: "GRCh38" });
    // Once each, from the progressive enrichment — not a second time from the local-store branch.
    expect(mocks.alphagenome).toHaveBeenCalledTimes(1);
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
    await fetchConservationData("TP53", "p.Arg273His", null, null, 273, "17-7673802-C-T", null, null, null, "GRCh38");
    expect(mocks.alphagenome).toHaveBeenCalledTimes(1);
  });

  it("omits aouFrequency when local dbNSFP record has only null AoU fields", async () => {
    const local = await import("../dbnsfp_local.ts");
    vi.mocked(local.queryLocalDbnsfpVariant).mockResolvedValueOnce({
      revel: 0.85,
      gerp: 4.5,
      phylop: 6.2,
      popeve: null,
      aou_ac: null,
      aou_an: null,
      aou_het: null,
      aou_hom: null,
    } as any);
    const result = await fetchConservationData("TP53", "p.Arg273His", null, null, 273);
    expect(result.available).toBe(true);
    expect(result.aouFrequency).toBeNull();
  });

  it("unwraps array-valued clinpred fields from MyVariant, ignores the retired Eigen, and rejects unmatched codon neighbors", async () => {
    const local = await import("../dbnsfp_local.ts");
    vi.spyOn(local, "isLocalDbnsfpAvailable").mockReturnValue(false);

    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const s = String(url);
      if (s.includes("myvariant.info")) {
        return new Response(JSON.stringify({
          hits: [{
            dbnsfp: {
              hgvsp: ["p.Arg273His"],
              clinpred: [{ score: ["0.91", "0.88"], pred: ["D"] }],
              eigen: { phred_coding: ["12.34"], raw_coding: ["0.78"] },
            },
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new TypeError("offline");
    }));

    const exact = await fetchConservationData("TP53", "p.Arg273His", null, null, 273);
    expect(exact.available).toBe(true);
    expect(exact).not.toHaveProperty("clinpred");
    expect(exact).not.toHaveProperty("clinpredPred");
    expect(exact).not.toHaveProperty("eigenPhred");
    expect(exact).not.toHaveProperty("eigenRaw");

    clearAllCaches(true);
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const s = String(url);
      if (s.includes("myvariant.info")) {
        return new Response(JSON.stringify({
          hits: [{
            dbnsfp: {
              hgvsp: ["p.Arg273Cys"],
              revel: { score: 0.99 },
            },
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new TypeError("offline");
    }));

    const unmatched = await fetchConservationData("TP53", "p.Arg273His", null, null, 273);
    expect(unmatched.available).toBe(false);
    expect(unmatched.revel).toBeNull();
  });

  it("never writes an EVE score into popEVE: the two scores use different scales", async () => {
    const local = await import("../dbnsfp_local.ts");
    vi.spyOn(local, "isLocalDbnsfpAvailable").mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("myvariant.info")) {
        return new Response(JSON.stringify({
          hits: [{ dbnsfp: { hgvsp: ["p.Arg273His"], revel: { score: 0.9 }, eve: { score: [0.85] } } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new TypeError("offline");
    }));

    const result = await fetchConservationData("TP53", "p.Arg273His", null, null, 273);
    expect(result.revel).toBe(0.9);
    expect(result.popeve).toBeNull();
  });

  it("withholds non-GRCh38 coordinates from dbNSFP.org on direct calls and reads ProtVar conservation by accession and residue", async () => {
    const local = await import("../dbnsfp_local.ts");
    vi.spyOn(local, "isLocalDbnsfpAvailable").mockReturnValue(false);

    const seenUrls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const s = String(url);
      seenUrls.push(s);
      if (s.includes("/ProtVar/api/score/")) {
        return new Response(JSON.stringify([{ type: "CONSERV", score: 0.957 }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (s.includes("myvariant.info")) {
        return new Response(JSON.stringify({
          hits: [{ dbnsfp: { hgvsp: ["p.Arg273His"], revel: { score: 0.91 } } }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new TypeError("offline");
    }));

    const result = await fetchConservationData("TP53", "p.Arg273His", "1TUP", "A", null, "17-7577120-C-T", "P04637", null, null, "GRCh37");
    expect(mocks.dbnsfpOrg).toHaveBeenCalledWith("TP53", "p.Arg273His", null);
    // The residue comes from the variant string; no PDB chain is needed.
    expect(seenUrls).toContain("https://www.ebi.ac.uk/ProtVar/api/score/P04637/273?type=CONSERV");
    expect(result.scorecons).toBe(0.957);
  });

  it("keeps ProtVar conservation on a direct call when no dbNSFP source has the variant", async () => {
    const local = await import("../dbnsfp_local.ts");
    vi.spyOn(local, "isLocalDbnsfpAvailable").mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const s = String(url);
      if (s.includes("/ProtVar/api/score/")) {
        return new Response(JSON.stringify([{ type: "CONSERV", score: 0.5 }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (s.includes("myvariant.info")) {
        return new Response(JSON.stringify({ hits: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new TypeError("offline");
    }));

    const result = await fetchConservationData("TP53", "p.Arg273His", null, null, 273, null, "P04637");

    expect(result.available).toBe(false);
    expect(result.revel).toBeNull();
    expect(result.scorecons).toBe(0.5);
  });

  it("asks AlphaGenome on a direct call only when some dbNSFP source knows the variant", async () => {
    const local = await import("../dbnsfp_local.ts");
    vi.spyOn(local, "isLocalDbnsfpAvailable").mockReturnValue(false);

    await fetchConservationData("TP53", "p.Arg273His", null, null, 273, "17-7673802-C-T", null, null, null, "GRCh38");
    expect(mocks.alphagenome).not.toHaveBeenCalled();

    clearAllCaches(true);
    mocks.dbnsfpOrg.mockResolvedValue({ ...noScores, revel: 0.8 });
    await fetchConservationData("TP53", "p.Arg273His", null, null, 273, "17-7673802-C-T", null, null, null, "GRCh38");
    expect(mocks.alphagenome).toHaveBeenCalledTimes(1);
  });

  it("streams ProtVar conservation as its own model, before and without a PDB mapping", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/ProtVar/api/score/P04637/273")) {
        return new Response(JSON.stringify([{ type: "CONSERV", score: 0.957 }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new TypeError("offline");
    }));
    const result = await fetchConservationDataProgressive({
      gene: "TP53",
      variant: "p.Arg273His",
      pos: 273,
      uniprotId: "P04637",
      predictorPromise: Promise.resolve({ gnomadVariantId: "17-7673802-C-T", gnomadVariantAssembly: "GRCh38" }) as any,
    });
    expect(result.scorecons).toBe(0.957);
    // A snapshot shows the score only once ProtVar has answered.
    expect(conservationSnapshot({}).modelStatus?.scorecons).toBe("pending");
    expect(conservationSnapshot({}).scorecons).toBeNull();
    expect(conservationSnapshot({ scorecons: 0.957 }).modelStatus?.scorecons).toBe("settled");
  });
});
