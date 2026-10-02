import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PredictorData } from "../../../../src/shared/contracts.ts";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), transcripts: vi.fn(), lift: vi.fn(), recover: vi.fn(), local: vi.fn(),
  l2: new Map<string, unknown>(), save: vi.fn(),
}));
vi.mock("../../infra/http-client.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../infra/http-client.ts")>(), fetchWithRetry: mocks.fetch,
}));
vi.mock("./transcript-resolver.ts", () => ({ getTranscriptsForProtein: mocks.transcripts }));
vi.mock("../dbnsfp_local.ts", () => ({ queryLocalDbnsfpVariant: mocks.local }));
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

  it("treats two alternate alleles at the same position as ambiguity, preserving protein AlphaMissense only", async () => {
    mocks.fetch.mockResolvedValue(json({ hits: [hit("A"), hit("G")] }));
    const result = await fetchPredictorsFallback("TEST", "D116G");
    expect(result.gnomadVariantId).toBeNull();
    expect(result.caddPhred).toBeNull();
    expect(result.amPathogenicity).toBe(0.8);
    expect(result.locusResolution).toMatchObject({ retryable: false, failureKind: "ambiguous-allele", policyVersion: 2 });
    expect(mocks.recover).not.toHaveBeenCalled();
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
    expect(result.locusResolution).toMatchObject({ retryable: false, failureKind: "ambiguous-allele" });
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
    expect(first.locusResolution).toMatchObject({ canonicalBy: "dbnsfp-grch38", retryable: false, policyVersion: 2 });
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
});
