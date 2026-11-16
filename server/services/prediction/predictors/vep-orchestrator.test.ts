import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PredictorData } from "../../../../src/shared/contracts.ts";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), transcripts: vi.fn(), lift: vi.fn(), recover: vi.fn(), local: vi.fn(), localGenomic: vi.fn(),
  l2: new Map<string, unknown>(), save: vi.fn(),
}));
vi.mock("../../infra/http-client.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../infra/http-client.ts")>(), fetchWithRetry: mocks.fetch,
}));
vi.mock("./transcript-resolver.ts", () => ({ getTranscriptsForProtein: mocks.transcripts }));
vi.mock("../dbnsfp_local.ts", () => ({
  queryLocalDbnsfpVariant: mocks.local,
  queryLocalDbnsfpByGenomic: mocks.localGenomic,
  // The real reading pairs the same row with its gene's numbering basis; a row may state it as `__basis`.
  queryLocalDbnsfpCoordinateReading: async (...args: unknown[]) => {
    const record = await mocks.localGenomic(...args);
    return record ? { record, basis: record.__basis ?? "unknown" } : null;
  },
  // The real format (`dbnsfp_local.readLocalDbnsfpVersion`), so a label that repeats it is caught.
  readLocalDbnsfpVersion: vi.fn(() => "dbNSFP 5.3a (local)"),
}));
vi.mock("../../translation/liftover.ts", () => ({ liftCoordinateToCanonical: mocks.lift }));
vi.mock("./locus-resolver.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("./locus-resolver.ts")>(), recoverCanonicalLocus: mocks.recover,
}));
vi.mock("../../infra/analysis-db.ts", () => ({ AnalysisDatabase: {
  getInstance: () => ({
    getExternalCacheAsync: async (key: string) => mocks.l2.has(key) ? { data: mocks.l2.get(key) } : null,
    saveExternalCacheAsync: mocks.save,
  }),
} }));

import { fetchPredictorData, fetchPredictorsFallback, isUsablePredictorResult, isIntrinsicallyAmbiguousProteinChange } from "./vep-orchestrator.ts";
import { predictorCache } from "../../infra/cache.ts";
import { buildPredictorsKey } from "../../infra/cache-keys.ts";
import { LOCUS_POLICY_VERSION } from "../../../../src/shared/locusResolution.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const hit = (alt = "A") => ({
  _id: `chr1:g.100C>${alt}`,
  dbnsfp: { hgvsp: ["p.D116G", "p.Asp116Gly"], alphamissense: { am_pathogenicity: 0.8 }, cadd: { phred: 24 } },
});
const healthy = () => [{
  seq_region_name: "1", start: 200, allele_string: "C/A", strand: 1,
  transcript_consequences: [{ gene_symbol: "TEST", transcript_id: "ENST1", canonical: 1, amino_acids: "D/G", protein_start: 116,
    alphamissense: { am_pathogenicity: 0.8 }, cadd_phred: 24 }],
}];
const healthyData: PredictorData = {
  available: true, amPathogenicity: 0.8, amClass: null, caddPhred: 24,
  gnomadVariantId: "1-200-C-A", gnomadVariantAssembly: "GRCh38", source: "Ensembl VEP API",
  locusResolution: { route: "vep-hgvs", canonicalBy: "vep", retryable: false, steps: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  predictorCache.clear();
  mocks.l2.clear();
  mocks.save.mockImplementation(async (key: string, data: unknown) => { mocks.l2.set(key, data); });
  mocks.transcripts.mockResolvedValue({ refseqId: "NM_1.1", ensemblId: "ENST1.1", canonicalEnsemblId: "ENST2.1" });
  mocks.lift.mockResolvedValue(null);
  mocks.localGenomic.mockResolvedValue(null);
  mocks.local.mockResolvedValue(null);
  mocks.recover.mockImplementation(async (id: string) => ({
    id: id.replace("-100-", "-200-"), assembly: "GRCh38", canonicalBy: "dbnsfp-grch38", retryable: false, steps: [],
  }));
  mocks.fetch.mockImplementation(async (url: string) => url.includes("myvariant") ? json({ hits: [] }) : json({}, 503));
});

describe("predictor locus outcome reconciliation", () => {
  it.each(["Q867H", "p.Gln867His", "K272N", "p.Lys272Asn", "W1C"])("proves intrinsic Table1 ambiguity generically for %s", variant => {
    expect(isIntrinsicallyAmbiguousProteinChange(variant)).toBe(true);
  });
  it.each(["D116G", "p.Asp116Gly", "K272E", "R408W", "L1F", "Q1Q", "bad"])("does not claim intrinsic ambiguity or uniqueness for %s", variant => {
    expect(isIntrinsicallyAmbiguousProteinChange(variant)).toBe(false);
  });

  it("keeps Q867H intrinsically ambiguous during a complete VEP outage despite one catalogue hit", async () => {
    const qh = hit(); qh.dbnsfp.hgvsp = ["p.Q867H", "p.Gln867His"];
    mocks.fetch.mockImplementation(async (url: string) => url.includes("myvariant") ? json({ total: 1, hits: [qh] }) : json({}, 503));
    const result = await fetchPredictorData("TEST", "Q867H", "P1");
    expect(result.gnomadVariantId).toBeNull();
    expect(result.caddPhred).toBeNull();
    expect(result.amPathogenicity).toBe(0.8);
    expect(result.locusResolution).toMatchObject({ failureKind: "ambiguous-allele", retryable: false });
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it("preserves healthy VEP protein AlphaMissense without selecting a Q867H allele/CADD", async () => {
    mocks.fetch.mockImplementation(async () => json(healthy()));
    const result = await fetchPredictorData("TEST", "Q867H", "P1");
    expect(result.gnomadVariantId).toBeNull();
    expect(result.caddPhred).toBeNull();
    expect(result.amPathogenicity).toBe(0.8);
    expect(result.amProvenance).toBe("VEP AlphaMissense plugin");
    expect(result.locusResolution).toMatchObject({ failureKind: "ambiguous-allele", retryable: false });
    expect(isUsablePredictorResult(result, "Q867H")).toBe(true);
  });

  it.each(["L1", "L2"])("rejects an old allele-bearing healthy VEP Q867H cache in %s", async tier => {
    const key = buildPredictorsKey("TEST", "Q867H", "P1");
    if (tier === "L1") predictorCache.set(key, healthyData); else mocks.l2.set(key, healthyData);
    mocks.fetch.mockImplementation(async () => json(healthy()));
    const result = await fetchPredictorData("TEST", "Q867H", "P1");
    expect(result.gnomadVariantId).toBeNull();
    expect(result.locusResolution?.failureKind).toBe("ambiguous-allele");
    expect(mocks.fetch).toHaveBeenCalled();
  });

  it("does not apply the standard nuclear-code proof to known mitochondrial genes", () => {
    expect(isIntrinsicallyAmbiguousProteinChange("Q867H", "MT-ND1")).toBe(false);
  });

  it("preserves an explicitly bound Q867H coordinate despite protein-only intrinsic ambiguity", async () => {
    const coordinate = { chrom: "1", pos: 200, ref: "C", alt: "A", assembly: "GRCh38" as const };
    mocks.lift.mockResolvedValue(coordinate);
    const data = healthy();
    data[0].transcript_consequences[0].amino_acids = "Q/H";
    data[0].transcript_consequences[0].protein_start = 867;
    mocks.fetch.mockImplementation(async () => json(data));
    const result = await fetchPredictorData("TEST", "Q867H", "P1", coordinate);
    expect(result.gnomadVariantId).toBe("1-200-C-A");
    expect(result.caddPhred).toBe(24);
    expect(result.locusResolution).toMatchObject({ route: "vep-coordinate", canonicalBy: "vep" });
    expect(isUsablePredictorResult(result, "Q867H", coordinate)).toBe(true);
  });

  it("does not let unrelated MANE ambiguity veto the canonical numbering target", async () => {
    mocks.fetch.mockImplementation(async (url: string) => url.includes("ENST2") ? json(healthy()) : json({ error: "Could not uniquely determine nucleotide change" }, 400));
    const result = await fetchPredictorData("TEST", "D116G", "P1");
    expect(result.gnomadVariantId).toBe("1-200-C-A");
    expect(result.locusResolution).toMatchObject({ canonicalBy: "vep", retryable: false });
    expect(result.locusResolution?.failureKind).toBeUndefined();
  });

  it("does not let an unrelated MANE success select a different allele before canonical", async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      const data = healthy();
      if (!url.includes("ENST2")) data[0].start = 999;
      return json(data);
    });
    const result = await fetchPredictorData("TEST", "D116G", "P1");
    expect(result.gnomadVariantId).toBe("1-200-C-A");
  });

  it("retains RefSeq MANE authority when its Ensembl transcript equals canonical", async () => {
    mocks.transcripts.mockResolvedValue({ refseqId: "NM_1.1", ensemblId: "ENST2.1", canonicalEnsemblId: "ENST2.1" });
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.includes("NM_1")) return json({ error: "Could not uniquely determine nucleotide change" }, 400);
      if (url.includes("myvariant")) return json({ hits: [hit()] });
      throw new Error("timeout");
    });
    const result = await fetchPredictorData("TEST", "D116G", "P1");
    expect(result.gnomadVariantId).toBeNull();
    expect(result.locusResolution).toMatchObject({ failureKind: "ambiguous-allele", retryable: false });
  });

  it("does not inherit protein-row local CADD from a different allele", async () => {
    mocks.local.mockResolvedValue({ alphamissense: 0.9, cadd: 99, ref: "C", alt: "G" });
    mocks.fetch.mockResolvedValue(json({ total: 1, hits: [hit()] }));
    const result = await fetchPredictorsFallback("TEST", "D116G");
    expect(result.amPathogenicity).toBe(0.9);
    expect(result.caddPhred).toBe(24);
    expect(result.gnomadVariantId).toBe("1-200-C-A");
  });

  it("withholds local protein-row CADD when no catalogue allele is resolved", async () => {
    mocks.local.mockResolvedValue({ alphamissense: 0.9, cadd: 99 });
    mocks.fetch.mockResolvedValue(json({ hits: [] }));
    const result = await fetchPredictorsFallback("TEST", "D116G");
    expect(result.amPathogenicity).toBe(0.9);
    expect(result.caddPhred).toBeNull();
  });
  it("does not write transient null-id results to L1 or L2, then recovers and caches normally", async () => {
    const first = await fetchPredictorData("TEST", "D116G", "P1");
    const key = buildPredictorsKey("TEST", "D116G", "P1");
    expect(first.gnomadVariantId).toBeNull();
    expect(first.locusResolution).toMatchObject({ retryable: true, failureKind: "transient-provider" });
    expect(predictorCache.has(key)).toBe(false);
    expect(mocks.l2.has(key)).toBe(false);
    mocks.fetch.mockImplementation(async () => json(healthy()));
    const second = await fetchPredictorData("TEST", "D116G", "P1");
    expect(second.gnomadVariantId).toBe("1-200-C-A");
    expect(predictorCache.get(key)).toEqual(second);
    expect(mocks.l2.get(key)).toEqual(second);
    predictorCache.clear();
    mocks.fetch.mockClear();
    expect(await fetchPredictorData("TEST", "D116G", "P1")).toEqual(second);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(["L1", "L2"])("rejects stale retryable null-id and unsafe canonical fallback reads in %s", async (tier) => {
    const key = buildPredictorsKey("TEST", "D116G", "P1");
    for (const stale of [
      { ...healthyData, gnomadVariantId: null, gnomadVariantAssembly: null, locusResolution: { route: "fallback", canonicalBy: null, retryable: true, steps: [] } },
      { ...healthyData, source: "MyVariant.info & dbNSFP (VEP Fallback)", locusResolution: { route: "fallback", canonicalBy: "dbnsfp-grch38", retryable: false, steps: [] } },
    ]) {
      predictorCache.clear(); mocks.l2.clear(); mocks.fetch.mockClear();
      if (tier === "L1") predictorCache.set(key, stale as PredictorData);
      else mocks.l2.set(key, stale);
      mocks.fetch.mockImplementation(async () => json(healthy()));
      const result = await fetchPredictorData("TEST", "D116G", "P1");
      expect(result.source).toBe("Ensembl VEP API");
      expect(mocks.fetch).toHaveBeenCalled();
    }
  });

  it.each(["L1", "L2"])("preserves legacy healthy VEP data in %s", async (tier) => {
    const key = buildPredictorsKey("TEST", "D116G", "P1");
    if (tier === "L1") predictorCache.set(key, healthyData);
    else mocks.l2.set(key, healthyData);
    expect(await fetchPredictorData("TEST", "D116G", "P1")).toEqual(healthyData);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([0, 1])("canonical VEP ambiguity dominates unrelated timeouts and %s database hits", async (count) => {
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.includes("myvariant")) return json({ hits: count ? [hit()] : [] });
      if (url.includes("ENST2")) return json({ error: "Could not uniquely determine nucleotide change" }, 400);
      throw new Error("timeout");
    });
    const result = await fetchPredictorData("TEST", "D116G", "P1");
    expect(result.gnomadVariantId).toBeNull();
    expect(result.caddPhred).toBeNull();
    expect(result.locusResolution).toMatchObject({ failureKind: "ambiguous-allele", retryable: false });
    expect(result.locusResolution!.steps.some(s => s.detail?.includes("ENST2") && s.detail.includes("uniquely"))).toBe(true);
    expect(result.locusResolution!.steps.some(s => s.detail?.includes("timeout"))).toBe(true);
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it("does not treat a generic gene-symbol ambiguity error as authoritative", async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.includes("myvariant")) return json({ hits: [hit()] });
      return json({ error: "Could not uniquely determine nucleotide change" }, 400);
    });
    const result = await fetchPredictorData("TEST", "D116G");
    expect(result.gnomadVariantId).toBe("1-200-C-A");
    expect(result.locusResolution?.failureKind).toBeUndefined();
  });

  it("collects earlier transient failures rather than classifying just the last target", async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.includes("myvariant")) return json({ hits: [] });
      if (url.includes("NM_1.1")) throw new Error("timeout");
      return json({ error: "not found" }, 400);
    });
    const result = await fetchPredictorData("TEST", "D116G", "P1");
    expect(result.locusResolution).toMatchObject({ retryable: true, failureKind: "transient-provider" });
  });

  it.each([
    { total: 51 }, { total: 0 }, { total: -1 }, { total: 1.5 }, { total: "invalid" }, { total: true },
    { truncated: true }, { has_more: true }, { next: "page2" },
  ])("refuses a single hit from incomplete MyVariant results: %j", async (metadata) => {
    mocks.fetch.mockResolvedValue(json({ hits: [hit()], ...metadata }));
    const result = await fetchPredictorsFallback("TEST", "D116G");
    expect(result.gnomadVariantId).toBeNull();
    expect(result.caddPhred).toBeNull();
    expect(result.amPathogenicity).toBe(0.8);
    expect(result.locusResolution).toMatchObject({ failureKind: "incomplete-evidence", retryable: false });
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it("refuses a full bounded page without total metadata", async () => {
    mocks.fetch.mockResolvedValue(json({ hits: Array.from({ length: 50 }, () => hit()) }));
    const result = await fetchPredictorsFallback("TEST", "D116G");
    expect(result.gnomadVariantId).toBeNull();
    expect(result.locusResolution).toMatchObject({ failureKind: "incomplete-evidence", retryable: false });
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it("caches new complete healthy canonical fallback results", async () => {
    mocks.fetch.mockImplementation(async (url: string) => url.includes("myvariant") ? json({ total: 1, hits: [hit()] }) : json({}, 503));
    const first = await fetchPredictorData("TEST", "D116G", "P1");
    expect(first.locusResolution).toMatchObject({ canonicalBy: "dbnsfp-grch38", retryable: false, policyVersion: LOCUS_POLICY_VERSION });
    expect(isUsablePredictorResult(first)).toBe(true);
    mocks.fetch.mockClear();
    expect(await fetchPredictorData("TEST", "D116G", "P1")).toEqual(first);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "different-gene", "different-alt"])("retains explicit input context without publishing an unbound allele: %s", async (failure) => {
    const coordinate = { chrom: "1", pos: 300, ref: "C", alt: "G", assembly: "GRCh38" as const };
    mocks.lift.mockResolvedValue(coordinate);
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.includes("myvariant")) return json({ hits: [hit("A")] });
      if (failure === "unavailable") return json({}, 503);
      const data = healthy();
      data[0].start = 300;
      data[0].allele_string = failure === "different-alt" ? "C/A" : "C/G";
      if (failure === "different-gene") data[0].transcript_consequences[0].gene_symbol = "OTHER";
      return json(data);
    });
    const result = await fetchPredictorData("TEST", "D116G", "P1", coordinate);
    expect(result.gnomadVariantId).toBeNull();
    expect(result.gnomadVariantAssembly).toBeNull();
    expect(result.locusResolution!.steps.some(s => s.detail?.includes("1:300C>G"))).toBe(true);
    expect(result.caddPhred).toBeNull();
    expect(result.locusResolution).toMatchObject({ canonicalBy: null, retryable: true });
    expect(mocks.fetch.mock.calls.some(([url]) => String(url).includes("/hgvs/"))).toBe(false);
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it("keeps healthy coordinate-first results bound to the provided ALT", async () => {
    const coordinate = { chrom: "1", pos: 200, ref: "C", alt: "A", assembly: "GRCh38" as const };
    mocks.lift.mockResolvedValue(coordinate);
    mocks.fetch.mockImplementation(async () => json(healthy()));
    const result = await fetchPredictorData("TEST", "D116G", "P1", coordinate);
    expect(result.gnomadVariantId).toBe("1-200-C-A");
    expect(result.locusResolution).toMatchObject({ route: "vep-coordinate", canonicalBy: "vep", retryable: false });
  });

  describe("coordinate-first fallback ladder", () => {
    it("falls back to MyVariant by coordinate when Ensembl VEP is unavailable, extracting scores and verified GRCh38 locus", async () => {
      const coordinate = { chrom: "17", pos: 65168243, ref: "T", alt: "A", assembly: "GRCh38" as const };
      mocks.transcripts.mockResolvedValue({ refseqId: "NM_003835.4", ensemblId: "ENST00000262406.10", canonicalEnsemblId: "ENST00000262406.10" });
      mocks.lift.mockResolvedValue(coordinate);
      mocks.fetch.mockImplementation(async (url: string) => {
        if (url.includes("rest.ensembl.org/vep/human/region")) {
          return json({ error: "rate limit or timeout" }, 503);
        }
        if (url.includes("myvariant.info/v1/variant/") && decodeURIComponent(url).includes("chr17:g.65168243T>A")) {
          return json({
            _id: "chr17:g.65168243T>A",
            dbnsfp: {
              genename: ["RGS9"],
              aa: { ref: "C", alt: "S", pos: [182] },
              hgvsp: ["p.Cys182Ser", "p.C182S"],
              // dbNSFP lists one AlphaMissense score per transcript, aligned with the transcript ids;
              // only the canonical transcript's entry (index 3) may be read.
              ensembl: { transcriptid: ["ENST00000635833", "ENST00000443584", "ENST00000449996", "ENST00000262406"] },
              alphamissense: { score: [0.4926, 0.4835, 0.4732, 0.5136], pred: ["B", "B", "B", "A"] },
              cadd: { phred: 22.9 },
            },
          });
        }
        return json({}, 503);
      });

      const result = await fetchPredictorData("RGS9", "p.Cys182Ser", "O75916", coordinate);
      expect(result.gnomadVariantId).toBe("17-65168243-T-A");
      expect(result.gnomadVariantAssembly).toBe("GRCh38");
      expect(result.amPathogenicity).toBe(0.5136); // the canonical transcript's score, not entry [0]
      expect(result.amClass).toBe("ambiguous");
      // The tier that produced the score is named, so the Landscape rank cross-check can say
      // which table disagreed when it does.
      expect(result.amProvenance).toBe("myvariant.info dbNSFP (release not stated)");
      expect(result.caddPhred).toBe(22.9);
      expect(result.source).toBe("MyVariant.info & dbNSFP (coordinate fallback)");
      expect(result.locusResolution).toMatchObject({
        route: "vep-coordinate",
        canonicalBy: "vep",
        retryable: false,
      });
      expect(result.locusResolution!.steps.some(s => s.outcome === "ok" && s.detail?.includes("MyVariant.info & dbNSFP"))).toBe(true);
    });

    describe("local dbNSFP by exact allele", () => {
      const coordinate = { chrom: "17", pos: 65168243, ref: "T", alt: "A", assembly: "GRCh38" as const };
      const row = { gene: "RGS9", chr: "17", pos_genomic: 65168243, ref: "T", alt: "A", aaref: "C", aaalt: "S", pos: 182, alphamissense: 0.5136, cadd: 22.9 };
      const vepDownMyVariantUp = async (url: string) => {
        if (url.includes("myvariant.info/v1/variant/")) {
          return json({ _id: "chr17:g.65168243T>A", dbnsfp: { genename: ["RGS9"], aa: { ref: "C", alt: "S", pos: [182] }, alphamissense: { score: 0.1 }, cadd: { phred: 1 } } });
        }
        return json({}, 503);
      };
      beforeEach(() => {
        mocks.transcripts.mockResolvedValue({ refseqId: "NM_003835.4", ensemblId: "ENST00000262406.10", canonicalEnsemblId: "ENST00000262406.10" });
        mocks.lift.mockResolvedValue(coordinate);
        mocks.fetch.mockImplementation(vepDownMyVariantUp);
      });

      it("answers from the local store before MyVariant, naming the dbNSFP release", async () => {
        mocks.localGenomic.mockResolvedValue(row);
        const result = await fetchPredictorData("RGS9", "p.Cys182Ser", "O75916", coordinate);
        expect(mocks.localGenomic).toHaveBeenCalledWith("17", 65168243, "T", "A", "RGS9");
        expect(result).toMatchObject({
          amPathogenicity: 0.5136,
          caddPhred: 22.9, // allele-keyed, so its CADD may be reported
          amProvenance: "dbNSFP 5.3a (local)",
          gnomadVariantId: "17-65168243-T-A",
          source: "dbNSFP 5.3a (local) (coordinate fallback)",
        });
        expect(mocks.fetch.mock.calls.some(([url]) => String(url).includes("myvariant"))).toBe(false);
      });

      it("names the MANE transcript, as VEP would, when the store reads the gene in MANE numbering", async () => {
        mocks.localGenomic.mockResolvedValue({ ...row, transcript: "ENST00000262406", __basis: "mane" });
        const result = await fetchPredictorData("RGS9", "p.Cys182Ser", "O75916", coordinate);
        expect(result).toMatchObject({ transcriptId: "ENST00000262406", isManeSelect: true, canonicalEnsemblId: "ENST00000262406.10" });
        expect(result.maneRefSeqId).toBeUndefined(); // not in the store, so not guessed
      });

      it("keeps the canonical transcript when the store's numbering for the gene is not MANE", async () => {
        mocks.localGenomic.mockResolvedValue({ ...row, transcript: "ENST00000262406", __basis: "ensembl-canonical" });
        const result = await fetchPredictorData("RGS9", "p.Cys182Ser", "O75916", coordinate);
        expect(result).toMatchObject({ transcriptId: "ENST00000262406.10", isManeSelect: false });
      });

      it.each([
        ["another gene", { gene: "RGS9BP" }],
        ["another substitution", { aaalt: "R" }],
        ["a differently numbered transcript", { pos: 190 }],
      ])("falls through to MyVariant when the local row belongs to %s", async (_label, change) => {
        mocks.localGenomic.mockResolvedValue({ ...row, ...change });
        const result = await fetchPredictorData("RGS9", "p.Cys182Ser", "O75916", coordinate);
        expect(result.source).toBe("MyVariant.info & dbNSFP (coordinate fallback)");
      });

      it("falls through when the local store throws", async () => {
        mocks.localGenomic.mockRejectedValue(new Error("SQLITE_CORRUPT"));
        const result = await fetchPredictorData("RGS9", "p.Cys182Ser", "O75916", coordinate);
        expect(result.source).toBe("MyVariant.info & dbNSFP (coordinate fallback)");
      });
    });

    it("degrades to the first dbNSFP entry when the canonical transcript is not listed", async () => {
      mocks.transcripts.mockResolvedValue({ refseqId: "NM_1.1", ensemblId: "ENST1.1", canonicalEnsemblId: "ENST00000999999.1" });
      const coordinate = { chrom: "17", pos: 65168243, ref: "T", alt: "A", assembly: "GRCh38" as const };
      mocks.lift.mockResolvedValue(coordinate);
      mocks.fetch.mockImplementation(async (url: string) => {
        if (url.includes("rest.ensembl.org/vep/human/region")) return json({ error: "down" }, 503);
        if (url.includes("myvariant.info/v1/variant/")) {
          return json({
            _id: "chr17:g.65168243T>A",
            dbnsfp: {
              genename: ["RGS9"],
              aa: { ref: "C", alt: "S", pos: [182] },
              hgvsp: ["p.Cys182Ser"],
              ensembl: { transcriptid: ["ENST00000635833", "ENST00000443584"] },
              alphamissense: { score: [0.4926, 0.4835], pred: ["A", "A"] },
              cadd: { phred: 22.9 },
            },
          });
        }
        return json({}, 503);
      });

      const result = await fetchPredictorData("RGS9", "p.Cys182Ser", "O75916", coordinate);
      expect(result.gnomadVariantId).toBe("17-65168243-T-A");
      expect(result.amPathogenicity).toBe(0.4926); // no canonical match → first entry, never all of them
    });

    it("falls back to UCSC reference verification when Ensembl and MyVariant both fail, preserving GRCh38 locus", async () => {
      const coordinate = { chrom: "17", pos: 65168243, ref: "T", alt: "A", assembly: "GRCh38" as const };
      mocks.lift.mockResolvedValue(coordinate);
      mocks.fetch.mockImplementation(async (url: string) => {
        if (url.includes("rest.ensembl.org/vep/human/region")) {
          return json({ error: "Ensembl down" }, 503);
        }
        if (url.includes("myvariant.info/v1/variant/")) {
          return json({ error: "not found" }, 404);
        }
        if (url.includes("api.genome.ucsc.edu/getData/sequence")) {
          return json({ dna: "T" });
        }
        return json({}, 503);
      });

      const result = await fetchPredictorData("RGS9", "p.Cys182Ser", "O75916", coordinate);
      expect(result.gnomadVariantId).toBe("17-65168243-T-A");
      expect(result.gnomadVariantAssembly).toBe("GRCh38");
      expect(result.source).toBe("UCSC Reference Sequence (coordinate fallback)");
      expect(result.locusResolution).toMatchObject({
        route: "vep-coordinate",
        canonicalBy: "vep",
        retryable: false,
      });
      expect(result.locusResolution!.steps.some(s => s.outcome === "ok" && s.detail?.includes("UCSC Reference Sequence"))).toBe(true);
    });

    it("refuses coordinate binding when UCSC reference sequence disagrees with input reference base", async () => {
      const coordinate = { chrom: "17", pos: 65168243, ref: "T", alt: "A", assembly: "GRCh38" as const };
      mocks.lift.mockResolvedValue(coordinate);
      mocks.fetch.mockImplementation(async (url: string) => {
        if (url.includes("rest.ensembl.org/vep/human/region")) {
          return json({ error: "Ensembl down" }, 503);
        }
        if (url.includes("myvariant.info/v1/variant/")) {
          return json({ error: "not found" }, 404);
        }
        if (url.includes("api.genome.ucsc.edu/getData/sequence")) {
          return json({ dna: "G" }); // Base mismatch! Input ref is T, reference genome has G
        }
        return json({}, 503);
      });

      const result = await fetchPredictorData("RGS9", "p.Cys182Ser", "O75916", coordinate);
      expect(result.gnomadVariantId).toBeNull();
      expect(result.gnomadVariantAssembly).toBeNull();
      expect(result.locusResolution).toMatchObject({
        canonicalBy: null,
        retryable: true,
      });
    });
  });
});

describe("protein change with several candidate alleles", () => {
  /** FGFR3 p.Gly380Arg: codon GGG, so G>A and G>C at the same base both give Arg. */
  const candidate = (alt: string, pos = 100) => ({
    _id: `chr1:g.${pos}G>${alt}`,
    dbnsfp: { hgvsp: ["p.G380R", "p.Gly380Arg"], alphamissense: { am_pathogenicity: 0.9 }, cadd: { phred: 28 } },
  });
  const myvariant = (body: unknown) => mocks.fetch.mockImplementation(async (url: string) => url.includes("myvariant") ? json(body) : json({}, 503));

  it("resolves a unique candidate from a complete list as one allele", async () => {
    myvariant({ total: 1, hits: [candidate("A")] });
    const result = await fetchPredictorsFallback("TEST", "G380R");
    expect(result.gnomadVariantId).toBe("1-200-G-A");
    expect(result.locusResolution?.candidates).toBeUndefined();
  });

  it("keeps and lifts every candidate of a complete list, selecting none", async () => {
    myvariant({ total: 2, hits: [candidate("A"), candidate("C")] });
    const result = await fetchPredictorsFallback("TEST", "G380R");
    expect(result.gnomadVariantId).toBeNull();
    expect(result.caddPhred).toBeNull();
    expect(result.amPathogenicity).toBe(0.9);
    expect(mocks.recover).toHaveBeenCalledTimes(2);
    expect(result.locusResolution).toMatchObject({
      failureKind: "multiple-candidates", retryable: false, canonicalBy: null,
      candidates: [
        { grch37Id: "1-100-G-A", id: "1-200-G-A", canonicalBy: "dbnsfp-grch38", retryable: false },
        { grch37Id: "1-100-G-C", id: "1-200-G-C", canonicalBy: "dbnsfp-grch38", retryable: false },
      ],
    });
    expect(isUsablePredictorResult(result, "G380R")).toBe(true);
  });

  it("refuses candidates from an incomplete list without lifting any", async () => {
    myvariant({ total: 3, hits: [candidate("A"), candidate("C")] });
    const result = await fetchPredictorsFallback("TEST", "G380R");
    expect(result.locusResolution).toMatchObject({ failureKind: "incomplete-evidence" });
    expect(result.locusResolution?.candidates).toBeUndefined();
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it("records which candidate's lift failed, and stays retryable when that failure was transient", async () => {
    myvariant({ total: 2, hits: [candidate("A"), candidate("C")] });
    mocks.recover.mockImplementation(async (id: string) => id.endsWith("-C")
      ? { id, assembly: "GRCh37", canonicalBy: null, retryable: true, steps: [] }
      : { id: id.replace("-100-", "-200-"), assembly: "GRCh38", canonicalBy: "ensembl-lift", retryable: false, steps: [] });
    const result = await fetchPredictorsFallback("TEST", "G380R");
    expect(result.locusResolution).toMatchObject({ failureKind: "multiple-candidates", retryable: true });
    expect(result.locusResolution?.candidates?.[1]).toMatchObject({ grch37Id: "1-100-G-C", id: null, canonicalBy: null, retryable: true });
    expect(result.locusResolution?.steps.some(s => s.detail?.includes("1-100-G-C"))).toBe(true);
    expect(isUsablePredictorResult(result, "G380R")).toBe(false);
  });

  it("still refuses matches at different codons: those are other loci, not candidate alleles", async () => {
    myvariant({ total: 2, hits: [candidate("A", 100), candidate("C", 5000)] });
    const result = await fetchPredictorsFallback("TEST", "G380R");
    expect(result.locusResolution).toMatchObject({ failureKind: "ambiguous-allele" });
    expect(result.locusResolution?.candidates).toBeUndefined();
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it("turns Ensembl's 'could not uniquely determine' into candidates when the list is complete", async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.includes("myvariant")) return json({ total: 2, hits: [candidate("A"), candidate("C")] });
      return json({ error: "Could not uniquely determine nucleotide change" }, 400);
    });
    const result = await fetchPredictorData("TEST", "G380R", "P1");
    expect(result.locusResolution).toMatchObject({ failureKind: "multiple-candidates", retryable: false });
    expect(result.locusResolution?.candidates?.map(c => c.id)).toEqual(["1-200-G-A", "1-200-G-C"]);
  });
});

describe("candidate alleles cross-checked with ProtVar", () => {
  const candidate = (alt: string, pos = 100) => ({
    _id: `chr1:g.${pos}G>${alt}`,
    dbnsfp: { hgvsp: ["p.G380R", "p.Gly380Arg"], alphamissense: { am_pathogenicity: 0.9 }, cadd: { phred: alt === "A" ? 28 : 27 } },
  });
  /** ProtVar's mapping answer: GRCh38 alleles on the canonical isoform P1, each with its CADD. */
  const protvar = (alts: string[]) => ({ content: { last: true, inputs: [{ derivedGenomicVariants: alts.map(alt => ({
    chromosome: "1", position: 200, refBase: "G", altBase: alt,
    genes: [{ geneName: "TEST", caddScore: alt === "A" ? 25.7 : 24.5, isoforms: [{ accession: "P1", canonical: true, isoformPosition: 380, refAA: "Gly", variantAA: "Arg" }] }],
  })) }] } });
  const route = (myvariant: unknown, protvarBody: unknown | null) => mocks.fetch.mockImplementation(async (url: string) =>
    url.includes("myvariant") ? json(myvariant)
      : url.includes("ProtVar") ? (protvarBody ? json(protvarBody) : json({}, 503))
      : json({}, 503));

  it("takes GRCh38 candidates from ProtVar when it agrees with MyVariant, with no lift", async () => {
    route({ total: 2, hits: [candidate("A"), candidate("C")] }, protvar(["C", "A"]));
    const result = await fetchPredictorsFallback("TEST", "G380R", "P1");
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(result.locusResolution).toMatchObject({ failureKind: "multiple-candidates", retryable: false });
    expect(result.locusResolution?.candidates).toEqual([
      { grch37Id: "1-100-G-C", id: "1-200-G-C", canonicalBy: "protvar", retryable: false, caddPhred: 24.5, caddSource: "ProtVar" },
      { grch37Id: "1-100-G-A", id: "1-200-G-A", canonicalBy: "protvar", retryable: false, caddPhred: 25.7, caddSource: "ProtVar" },
    ]);
  });

  it("refuses when ProtVar and MyVariant name different alleles", async () => {
    route({ total: 2, hits: [candidate("A"), candidate("C")] }, protvar(["A", "T"]));
    const result = await fetchPredictorsFallback("TEST", "G380R", "P1");
    expect(result.locusResolution).toMatchObject({ failureKind: "incomplete-evidence", retryable: false });
    expect(result.locusResolution?.candidates).toBeUndefined();
    expect(result.locusResolution?.steps.some(s => /ProtVar/.test(s.detail ?? "") && /disagree/.test(s.detail ?? ""))).toBe(true);
  });

  it("lets ProtVar's codon-derived list stand in for an incomplete MyVariant list", async () => {
    route({ total: 60, hits: [candidate("A")] }, protvar(["A", "C"]));
    const result = await fetchPredictorsFallback("TEST", "G380R", "P1");
    expect(result.locusResolution).toMatchObject({ failureKind: "multiple-candidates" });
    expect(result.locusResolution?.candidates?.map(c => [c.id, c.grch37Id])).toEqual([["1-200-G-A", null], ["1-200-G-C", null]]);
  });

  it("falls back to MyVariant and the verified lift when ProtVar is unreachable, keeping each record's CADD", async () => {
    route({ total: 2, hits: [candidate("A"), candidate("C")] }, null);
    const result = await fetchPredictorsFallback("TEST", "G380R", "P1");
    expect(mocks.recover).toHaveBeenCalledTimes(2);
    expect(result.locusResolution?.candidates?.map(c => [c.canonicalBy, c.caddPhred, c.caddSource])).toEqual([
      ["dbnsfp-grch38", 28, "myvariant.info dbNSFP (release not stated)"],
      ["dbnsfp-grch38", 27, "myvariant.info dbNSFP (release not stated)"],
    ]);
  });

  it("prefers the local dbNSFP store's CADD for each candidate when it holds that exact allele", async () => {
    route({ total: 2, hits: [candidate("A"), candidate("C")] }, protvar(["A", "C"]));
    mocks.localGenomic.mockImplementation(async (_chrom: string, _pos: number, _ref: string, alt: string) => alt === "A" ? { cadd: 31 } : null);
    const result = await fetchPredictorsFallback("TEST", "G380R", "P1");
    expect(result.locusResolution?.candidates?.map(c => [c.id, c.caddPhred, c.caddSource])).toEqual([
      ["1-200-G-A", 31, "dbNSFP 5.3a (local)"],
      ["1-200-G-C", 24.5, "ProtVar"],
    ]);
    expect(result.caddPhred).toBeNull();
  });
});
