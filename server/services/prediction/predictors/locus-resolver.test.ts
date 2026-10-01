import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readDbnsfpGrch38 } from "./locus-resolver.ts";
import { isTransientLookupFailure } from "./vep-orchestrator.ts";

/**
 * The GRCh38 recovery ladder for the MyVariant fallback (NAE1 p.Asp116Gly, re-run from Recents during
 * an Ensembl outage, came back on its hg19 locus and every GRCh38-only source refused it).
 *
 * The ladder must reach GRCh38 WITHOUT Ensembl — dbNSFP's own GRCh38 position, verified against the
 * UCSC reference — and must refuse, with a trail, whenever that cannot be verified.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The live MyVariant answer for NAE1 p.Asp116Gly (trimmed), with dbNSFP's own GRCh38 position. */
const NAE1_HIT = {
  _id: "chr16:g.66857184T>C",
  dbnsfp: {
    chrom: "16",
    ref: "T",
    alt: "C",
    hg19: { start: 66857184, end: 66857184 },
    hg38: { start: 66823281, end: 66823281 },
    hgvsp: ["p.D116G", "p.Asp116Gly"],
    alphamissense: { am_pathogenicity: 0.4, am_class: "ambiguous" },
    cadd: { phred: 22 },
  },
};

interface Outage {
  /** What UCSC's hg38 sequence endpoint answers; `null` = unreachable. */
  ucscBase?: string | null;
  myvariantHits?: unknown[];
}

/** Ensembl down (the outage), UniProt answering, MyVariant and UCSC as configured. */
function stubOutage({ ucscBase = "T", myvariantHits = [NAE1_HIT] }: Outage = {}) {
  global.fetch = vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes("rest.ensembl.org")) return json({ error: "Service unavailable" }, 503);
    if (u.includes("uniprot.org")) {
      return json({
        uniProtKBCrossReferences: [
          { database: "RefSeq", properties: [{ key: "NucleotideSequenceId", value: "NM_003905.4" }] },
          { database: "Ensembl", id: "ENST00000290810.8" },
        ],
      });
    }
    if (u.includes("myvariant.info")) return json({ hits: myvariantHits });
    if (u.includes("api.genome.ucsc.edu")) {
      if (ucscBase === null) throw new TypeError("fetch failed");
      return json({ genome: "hg38", dna: ucscBase });
    }
    return json({}, 404);
  }) as any;
}

let origFetch: typeof fetch;
beforeEach(async () => {
  origFetch = global.fetch;
  const { resetHostStateForTests } = await import("../../infra/http-client.ts");
  const { clearAllCaches } = await import("../../cache.ts");
  const { transcriptMappingCache } = await import("./transcript-resolver.ts");
  resetHostStateForTests();
  clearAllCaches(true);
  transcriptMappingCache.clear();
});
afterEach(() => {
  global.fetch = origFetch;
});

describe("GRCh38 recovery without Ensembl", () => {
  it("recovers the GRCh38 locus from dbNSFP, verified against UCSC, when Ensembl is down", async () => {
    stubOutage();
    const { fetchPredictorData } = await import("./vep-orchestrator.ts");
    const res = await fetchPredictorData("NAE1", "p.Asp116Gly", "Q13564");

    expect(res.gnomadVariantId).toBe("16-66823281-T-C");
    expect(res.gnomadVariantAssembly).toBe("GRCh38");
    expect(res.locusResolution).toMatchObject({ route: "fallback", canonicalBy: "dbnsfp-grch38", retryable: false });
    const steps = res.locusResolution!.steps.map(s => `${s.step}:${s.outcome}`);
    expect(steps).toContain("vep-hgvs:failed");
    expect(steps).toContain("myvariant:ok");
    expect(steps).toContain("dbnsfp-grch38:ok");
    // Ensembl's own lift was attempted (or skipped behind the open breaker), never trusted blindly.
    expect(steps.some(s => s.startsWith("ensembl-lift:"))).toBe(true);
  }, 20000);

  it("keeps the GRCh37 locus, marked retryable, when the reference check cannot be made", async () => {
    stubOutage({ ucscBase: null });
    const { fetchPredictorData } = await import("./vep-orchestrator.ts");
    const res = await fetchPredictorData("NAE1", "p.Asp116Gly", "Q13564");

    expect(res.gnomadVariantId).toBe("16-66857184-T-C");
    expect(res.gnomadVariantAssembly).toBe("GRCh37");
    expect(res.locusResolution).toMatchObject({ route: "fallback", canonicalBy: null, retryable: true });
    expect(res.locusResolution!.steps.at(-1)).toMatchObject({ step: "dbnsfp-grch38", outcome: "failed" });
  }, 20000);

  it("refuses a dbNSFP position whose GRCh38 reference base is not the record's REF", async () => {
    stubOutage({ ucscBase: "G" });
    const { fetchPredictorData } = await import("./vep-orchestrator.ts");
    const res = await fetchPredictorData("NAE1", "p.Asp116Gly", "Q13564");

    expect(res.gnomadVariantAssembly).toBe("GRCh37");
    expect(res.locusResolution?.canonicalBy).toBeNull();
    expect(res.locusResolution!.steps.at(-1)?.detail).toMatch(/is G, not the record's T/);
  }, 20000);

  it("does not cache a fallback locus, so the next run tries again", async () => {
    stubOutage({ ucscBase: null });
    const { fetchPredictorData } = await import("./vep-orchestrator.ts");
    await fetchPredictorData("NAE1", "p.Asp116Gly", "Q13564");

    stubOutage(); // the reference is reachable again
    const second = await fetchPredictorData("NAE1", "p.Asp116Gly", "Q13564");
    expect(second.gnomadVariantAssembly).toBe("GRCh38");
  }, 20000);

  it("records the VEP route on a healthy run", async () => {
    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("uniprot.org")) return json({ uniProtKBCrossReferences: [] });
      if (u.includes("rest.ensembl.org/vep/human/hgvs")) {
        return json([{
          seq_region_name: "16", start: 66823281, allele_string: "T/C", strand: 1,
          transcript_consequences: [{ gene_symbol: "NAE1", transcript_id: "ENST00000290810", mane_select: "NM_003905.4" }],
        }]);
      }
      return json({}, 404);
    }) as any;
    const { fetchPredictorData } = await import("./vep-orchestrator.ts");
    const res = await fetchPredictorData("NAE1", "p.Asp116Gly");
    expect(res.locusResolution).toMatchObject({ route: "vep-hgvs", canonicalBy: "vep", retryable: false });
  }, 20000);
});

describe("readDbnsfpGrch38", () => {
  it("reads a single unambiguous GRCh38 position", () => {
    expect(readDbnsfpGrch38(NAE1_HIT)).toEqual({ chrom: "16", pos: 66823281, ref: "T", alt: "C" });
  });

  it("refuses more than one distinct GRCh38 position", () => {
    const hit = { dbnsfp: { ...NAE1_HIT.dbnsfp, hg38: [{ start: 1 }, { start: 2 }] } };
    expect(readDbnsfpGrch38(hit)).toBeNull();
  });

  it("refuses a record with no GRCh38 position or a non-SNV allele", () => {
    expect(readDbnsfpGrch38({ dbnsfp: { ...NAE1_HIT.dbnsfp, hg38: undefined } })).toBeNull();
    expect(readDbnsfpGrch38({ dbnsfp: { ...NAE1_HIT.dbnsfp, alt: "CA" } })).toBeNull();
    expect(readDbnsfpGrch38({})).toBeNull();
  });
});

describe("isTransientLookupFailure", () => {
  it("treats outages, timeouts and dropped connections as transient", () => {
    expect(isTransientLookupFailure("Status 503: Service unavailable")).toBe(true);
    expect(isTransientLookupFailure("fetch failed")).toBe(true);
    expect(isTransientLookupFailure("The operation timed out")).toBe(true);
    expect(isTransientLookupFailure("Status 429: Too many requests")).toBe(true);
  });

  it("treats Ensembl's statements about the notation as definitive", () => {
    expect(isTransientLookupFailure('Status 400: {"error":"Could not uniquely determine nucleotide change"}')).toBe(false);
  });
});
