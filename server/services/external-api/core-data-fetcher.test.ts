import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchCoreVariantData } from "./core-data-fetcher.ts";
import type { ParsedVariantContext } from "../../routes/variant/variant-parser.ts";

vi.mock("./clinvar.ts", () => ({
  fetchClinVarData: vi.fn(async () => ({
    classification: "Pathogenic",
    conditions: "Phenylketonuria",
    reviewStatus: "criteria provided, multiple submitters, no conflicts",
    lastEvaluated: "2023-01-01"
  }))
}));

vi.mock("../prediction/index.ts", () => ({
  fetchPredictorData: vi.fn(async () => ({
    caddPhred: 28.5,
    revel: 0.85,
    amPathogenicity: 0.92,
    amClass: "pathogenic",
    gnomadVariantId: "12-102845012-G-A",
    // The gnomAD frequency lookup is now gated on the coordinate's build: the endpoint is
    // gnomAD r4 (GRCh38-only) and answers by numeric position, so an untagged coordinate is
    // refused rather than sent. Fixtures must declare the build they mean.
    gnomadVariantAssembly: "GRCh38"
  })),
  fetchConservationData: vi.fn(async () => ({
    revel: 0.85,
    bayesdel: 0.45,
    phylop: 7.2
  })),
  fetchConservationDataProgressive: vi.fn(async () => ({}))
}));

vi.mock("../structure/structure-fetcher.ts", () => ({
  fetchBestPdbStructure: vi.fn(async () => ({
    pdbId: "2PAH",
    chainId: "A",
    unpStart: 1,
    structStart: 1,
    resolution: 1.8
  })),
  fetchAlphafoldPdb: vi.fn(async () => "MOCK_AF_PDB"),
  fetchPdbFromRcsb: vi.fn(async () => "MOCK_RCSB_PDB")
}));

vi.mock("./string.ts", () => ({
  fetchStringInteractions: vi.fn(async () => [
    { preferredName: "QDPR", score: 0.95 }
  ])
}));

vi.mock("./gnomad.ts", () => ({
  fetchGnomadGeneConstraint: vi.fn(async () => ({
    missense_z: 1.8,
    oe_mis: 0.72,
    pli: 0.95,
    isPP2Constrained: true
  })),
  fetchGnomadVariantFrequency: vi.fn(async () => ({
    maxAF: 0.00002,
    groupMaxAF: 0.00002,
    genomeAF: 0.00001,
    exomeAF: 0.00003,
    nHomozygous: 0,
    dataset: "gnomad_v4"
  })),
  fetchLocalPopulationFrequencies: vi.fn(async () => null)
}));

vi.mock("./uniprot.ts", () => ({
  fetchUniprotFeatures: vi.fn(async () => ({
    features: [
      { type: "Active site", start: 408, end: 408, description: "Catalytic core" }
    ]
  }))
}));

vi.mock("../stability/biophysics.ts", () => ({
  predictStructuralDisruption: vi.fn(async () => ({
    level: "high",
    reason: "Disrupts active site",
    plddt: 92.5
  })),
  runEsm2Eval: vi.fn(async () => ({
    llr: -7.5,
    verdict: "deleterious"
  }))
}));

vi.mock("./genos_web.ts", () => ({
  queryGenosWebservice: vi.fn(async () => null)
}));

vi.mock("../prediction/landscape.ts", () => ({
  fetchLocalPopulationFrequencies: vi.fn(async () => null),
}));

vi.mock("../prediction/dbnsfp_local.ts", () => ({
  isLocalDbnsfpAvailable: vi.fn(() => false),
  queryLocalDbnsfpVariant: vi.fn(async () => null),
  readLocalDbnsfpVersion: vi.fn(() => null)
}));

vi.mock("../orchestration/self-healer.ts", () => ({
  healCachedAnalysisIfPossible: vi.fn()
}));

vi.mock("../infra/analysis-db.ts", () => ({
  AnalysisDatabase: {
    getInstance: vi.fn(() => ({
      getVariantAnalysisAsync: vi.fn(async () => null),
      saveVariantAnalysisAsync: vi.fn(async () => {}),
      getExternalCacheAsync: vi.fn(async () => null),
      saveExternalCacheAsync: vi.fn(async () => {})
    }))
  }
}));

describe("Core Data Fetcher Service Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseContext: ParsedVariantContext = {
    gene: "PAH",
    variant: "p.Arg408Trp",
    uniprotId: "P00439",
    originalNotation: "p.Arg408Trp",
    acmgWeighting: "standard",
    sequence: "MKVLIVGLGNCGVFSLLDKN",
    pos: 408,
    residueIndex: "408",
    wildType: "Arg",
    mutant: "Trp",
    wt1Letter: "R",
    mut1Letter: "W"
  };

  it("should successfully fetch and assemble all core data components", async () => {
    const result = await fetchCoreVariantData(baseContext, 2000);

    expect(result).toBeDefined();
    expect(result.clinvar?.classification).toBe("Pathogenic");
    expect(result.predictorData?.caddPhred).toBe(28.5);
    expect(result.gnomadConstraint?.isPP2Constrained).toBe(true);
    expect(result.gnomadFrequency?.maxAF).toBe(0.00002);
    expect(result.resolvedPdbId).toBe("2PAH");
    expect(result.resolvedPdbSource).toBe("RCSB PDB");
    expect(result.ruleBasedInsights?.acmgVerdict).toBeDefined();

    // Verify service status map
    expect(result.serviceStatus.clinvar).toBe("ok");
    expect(result.serviceStatus.predictorData).toBe("ok");
    expect(result.serviceStatus.gnomadConstraint).toBe("ok");
    expect(result.serviceStatus.gnomadFrequency).toBe("ok");
    expect(result.serviceStatus.pdbMapping).toBe("ok");
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * THE PREDICTOR'S COORDINATE, PAIRED WITH ITS BUILD
   * ─────────────────────────────────────────────────────────────────────────────
   * The predictors query Ensembl VEP BY POSITION, so a coordinate sent beside the wrong build is
   * the wrong-locus hazard `src/shared/assembly.ts` exists to prevent: a GRCh37 position handed to
   * a GRCh38 index either misses, or — where the reference base coincides — scores a DIFFERENT
   * locus and returns plausible numbers attributed to this variant.
   *
   * Two call sites used to build this pair by hand from the SUBMITTED fields
   * (`core-data-fetcher.ts` and `analysis-orchestrator.ts`), so a GRCh37 input reached the
   * predictor tagged GRCh37 and was lifted a second time downstream (or refused outright by every
   * GRCh38-only source). Both now call `predictorCoordinateFromContext`, and this test pins the
   * pair the TRANSLATION step verified — a by-hand pairing of `genomicCoordinates` + `assembly`
   * (the old behaviour, and the obvious "simplification") fails it.
   */
  it("queries the predictor with the lift-verified canonical pair, not the submitted GRCh37 pair", async () => {
    const { fetchPredictorData } = await import("../prediction/index.ts");
    /**
     * The real shape the translate route returns for `Chr1(GRCh37):g.1256452C>A`: the submitted
     * GRCh37 locus beside the verified canonical one (chr1:1,321,072, the INTS11/CPSF3L locus).
     */
    const liftedContext: ParsedVariantContext = {
      ...baseContext,
      assembly: "GRCh37",
      genomicCoordinates: "1-1256452-C-A",
      resolvedAssembly: "GRCh38",
      liftedGenomicCoordinates: "1-1321072-C-A"
    };

    await fetchCoreVariantData(liftedContext, 2000);

    expect(vi.mocked(fetchPredictorData)).toHaveBeenCalled();
    const coordinate = vi.mocked(fetchPredictorData).mock.calls[0][3];
    // Canonical position, canonical build — the pair, not one field of each.
    expect(coordinate).toEqual({ chrom: "1", pos: 1321072, ref: "C", alt: "A", assembly: "GRCh38" });
  });

  it("falls back to the submitted pair when the canonical locus arrives without its build", async () => {
    /**
     * A canonical coordinate with NO build is not ours to assume canonical (the same rule
     * `variant-parser` applies at intake): the pair is dropped and the submitted pair is used, so
     * the predictor lifts it itself exactly as it did before lift-first existed. Defaulting the
     * missing build to GRCh38 is `probably` right — which is why the guard, not the default, is
     * what the safety rests on.
     */
    const { fetchPredictorData } = await import("../prediction/index.ts");
    const unpairedContext: ParsedVariantContext = {
      ...baseContext,
      assembly: "GRCh37",
      genomicCoordinates: "1-1256452-C-A",
      liftedGenomicCoordinates: "1-1321072-C-A"
      // resolvedAssembly deliberately absent.
    };

    await fetchCoreVariantData(unpairedContext, 2000);

    const coordinate = vi.mocked(fetchPredictorData).mock.calls[0][3];
    expect(coordinate).toEqual({ chrom: "1", pos: 1256452, ref: "C", alt: "A", assembly: "GRCh37" });
  });

  it("does not query gnomAD with a coordinate whose build is unknown", async () => {
    // gnomAD r4 is GRCh38-only and answers by numeric position, so an id from another build whose
    // alleles coincide returns a DIFFERENT locus's frequency. Those frequencies drive
    // PM2/BA1/BS1/PS4, making this the highest-impact wrong number the pipeline can produce.
    // An untagged coordinate must therefore yield no frequency rather than a confident wrong one.
    // Both modules are already mocked at module scope; no dynamic import is needed.
    const { fetchPredictorData } = await import("../prediction/index.ts");
    const { fetchGnomadVariantFrequency } = await import("./gnomad.ts");
    vi.mocked(fetchGnomadVariantFrequency).mockClear();
    vi.mocked(fetchPredictorData).mockResolvedValueOnce({
      caddPhred: 28.5, revel: 0.85, amPathogenicity: 0.92, amClass: "pathogenic",
      gnomadVariantId: "12-102845012-G-A"
      // gnomadVariantAssembly deliberately absent.
    } as any);

    const result = await fetchCoreVariantData(baseContext, 2000);

    expect(fetchGnomadVariantFrequency).not.toHaveBeenCalled();
    expect(result.gnomadFrequency).toBeNull();
    /**
     * ...and the refusal must be RECORDED as one.
     *
     * This assertion is the one that matters clinically. The gate used to return `null` with no flag,
     * so the status became `not_found` — the same value a genuine confirmed absence carries — and the
     * ACMG classifier read it as one: a zero frequency and **PM2 awarded for a variant gnomAD was
     * never asked about**.
     */
    expect(result.serviceStatus.gnomadFrequency).toBe("unsupported-build");
  });

  describe("allele-bound local population evidence", () => {
    it.each(["ambiguous-allele", "incomplete-evidence", "transient-provider"])("withholds local and conservation AoU/gnomAD on %s without awarding frequency criteria", async (failureKind) => {
      const { fetchPredictorData, fetchConservationDataProgressive } = await import("../prediction/index.ts");
      const { fetchLocalPopulationFrequencies } = await import("../prediction/landscape.ts");
      const { isLocalDbnsfpAvailable } = await import("../prediction/dbnsfp_local.ts");
      const { fetchGnomadVariantFrequency } = await import("./gnomad.ts");
      vi.mocked(isLocalDbnsfpAvailable).mockReturnValueOnce(true);
      // A matching protein row exists locally, but its allele is not established by VEP.
      vi.mocked(fetchLocalPopulationFrequencies).mockResolvedValueOnce({
        gnomad: { maxAF: 0, genomeAC: 0, genomeAN: 100000 },
        aou: { aouAC: 0, aouAN: 100000, aouHet: 0, aouHom: 0 },
      });
      vi.mocked(fetchPredictorData).mockResolvedValueOnce({
        available: true, amPathogenicity: 0.8, caddPhred: null,
        gnomadVariantId: null, gnomadVariantAssembly: null,
        locusResolution: { route: "fallback", canonicalBy: null, retryable: failureKind === "transient-provider", failureKind, policyVersion: 2, steps: [] },
      } as any);
      vi.mocked(fetchConservationDataProgressive).mockResolvedValueOnce({
        revel: null, gerp: null, phylop: null,
        aouFrequency: { aouAC: 0, aouAN: 100000, aouHet: 0, aouHom: 0 },
      } as any);
      const previews: any[] = [];
      const result = await fetchCoreVariantData({ ...baseContext, variant: "p.Gln867His", pos: 867 }, 2000, undefined, partial => previews.push(partial));
      expect(fetchLocalPopulationFrequencies).not.toHaveBeenCalled();
      expect(fetchGnomadVariantFrequency).not.toHaveBeenCalled();
      expect(result.gnomadFrequency).toBeNull();
      expect(result.aouFrequency).toBeNull();
      expect(result.aouLookup).toBeNull(); // withheld is not local absence or an installation failure
      expect(result.conservationData?.aouFrequency).toBeNull();
      expect(result.serviceStatus.gnomadFrequency).toBe("unsupported-build");
      expect(result.ruleBasedInsights).not.toBeNull();
      expect(result.ruleBasedInsights!.acmgCriteria.some(c => ["PM2", "BA1", "BS1", "BS2"].includes(c.code))).toBe(false);
      expect(previews.some(p => p.data.aouFrequency || p.data.conservationData?.aouFrequency)).toBe(false);
      // The withheld lookup never consumed this queued value.
      vi.mocked(fetchLocalPopulationFrequencies).mockReset();
      vi.mocked(fetchLocalPopulationFrequencies).mockResolvedValue(null);
    });

    it("passes the canonical verified allele into the local lookup and prefers the remote gnomAD record", async () => {
      const { fetchLocalPopulationFrequencies } = await import("../prediction/landscape.ts");
      const { isLocalDbnsfpAvailable } = await import("../prediction/dbnsfp_local.ts");
      const { fetchGnomadVariantFrequency } = await import("./gnomad.ts");
      vi.mocked(isLocalDbnsfpAvailable).mockReturnValueOnce(true);
      const local = { gnomad: { maxAF: 0.01, genomeAC: 10, genomeAN: 1000, dataset: "gnomad_r4_local" }, aou: { aouAC: 3, aouAN: 1000, aouHet: 3, aouHom: 0 } };
      vi.mocked(fetchLocalPopulationFrequencies).mockResolvedValueOnce(local);
      const result = await fetchCoreVariantData(baseContext, 2000);
      expect(fetchLocalPopulationFrequencies).toHaveBeenCalledWith("PAH", 408, "p.Arg408Trp", { chrom: "12", pos: 102845012, ref: "G", alt: "A", assembly: "GRCh38" });
      // The remote gnomAD record is preferred: the local ingest has no ancestry groups or FAF95, so its
      // combined AF missed UROD p.Gly318Arg's 1.7% African-ancestry frequency (BS1). Local AoU stays.
      expect(fetchGnomadVariantFrequency).toHaveBeenCalledWith("12-102845012-G-A", { assembly: "GRCh38" });
      expect(result.gnomadFrequency?.dataset).not.toBe("gnomad_r4_local");
      expect(result.aouFrequency).toEqual(local.aou);
      expect(result.aouLookup?.localTable).toBe("found");
    });

    it("falls back to the local combined counts when gnomAD itself is unreachable", async () => {
      const { fetchLocalPopulationFrequencies } = await import("../prediction/landscape.ts");
      const { isLocalDbnsfpAvailable } = await import("../prediction/dbnsfp_local.ts");
      const { fetchGnomadVariantFrequency } = await import("./gnomad.ts");
      vi.mocked(isLocalDbnsfpAvailable).mockReturnValueOnce(true);
      const local = { gnomad: { maxAF: 0.01, genomeAC: 10, genomeAN: 1000, dataset: "gnomad_r4_local" }, aou: null };
      vi.mocked(fetchLocalPopulationFrequencies).mockResolvedValueOnce(local);
      vi.mocked(fetchGnomadVariantFrequency).mockRejectedValueOnce(new Error("gnomAD down"));
      const result = await fetchCoreVariantData(baseContext, 2000);
      expect(result.gnomadFrequency).toEqual({ ...local.gnomad, standIn: "fault" });
      expect(result.serviceStatus.gnomadFrequency).toBe("stand-in");
    });

    it("prefers gnomAD's confirmed absence over the local ingest's stale row", async () => {
      const { fetchLocalPopulationFrequencies } = await import("../prediction/landscape.ts");
      const { isLocalDbnsfpAvailable } = await import("../prediction/dbnsfp_local.ts");
      const { fetchGnomadVariantFrequency } = await import("./gnomad.ts");
      vi.mocked(isLocalDbnsfpAvailable).mockReturnValueOnce(true);
      vi.mocked(fetchLocalPopulationFrequencies).mockResolvedValueOnce({
        gnomad: { maxAF: 0.01, genomeAC: 10, genomeAN: 1000, dataset: "gnomad_r4_local" }, aou: null,
      });
      // The only shape a confirmed absence takes: gnomAD's own "Variant not found" resolves `null`.
      // The local derivative must not overturn it — that manufactured a frequency from an absence
      // and could flip a defensible PM2 (absence = 0 ≤ ceiling) into "none".
      vi.mocked(fetchGnomadVariantFrequency).mockResolvedValueOnce(null as any);
      const result = await fetchCoreVariantData(baseContext, 2000);
      expect(result.gnomadFrequency).toBeNull();
      expect(result.serviceStatus.gnomadFrequency).toBe("not_found");
    });

    it("names the grace deadline, not a fault, when the local ingest stands in for a slow gnomAD", async () => {
      const { fetchLocalPopulationFrequencies } = await import("../prediction/landscape.ts");
      const { isLocalDbnsfpAvailable } = await import("../prediction/dbnsfp_local.ts");
      const { fetchGnomadVariantFrequency } = await import("./gnomad.ts");
      vi.mocked(isLocalDbnsfpAvailable).mockReturnValueOnce(true);
      const local = { gnomad: { maxAF: 0.01, genomeAC: 10, genomeAN: 1000, dataset: "gnomad_r4_local" }, aou: null };
      vi.mocked(fetchLocalPopulationFrequencies).mockResolvedValueOnce(local);
      // A slow-but-healthy gnomAD: the 8 s grace window fires first, so the two must not be in
      // the same vocabulary as a refused query or a transport failure. Fake timers advance the
      // window instead of letting the test wait 8 real seconds.
      vi.mocked(fetchGnomadVariantFrequency).mockImplementationOnce(() => new Promise(() => {}));
      vi.useFakeTimers();
      try {
        // A core budget larger than the grace window — the real run orders them this way, and the
        // test's 2 s default would expire before the 8 s grace the behaviour lives on.
        const pending = fetchCoreVariantData(baseContext, 10_000);
        await vi.advanceTimersByTimeAsync(8_000);
        const result = await pending;
        expect(result.gnomadFrequency).toEqual({ ...local.gnomad, standIn: "grace" });
        expect(result.serviceStatus.gnomadFrequency).toBe("stand-in");
      } finally {
        vi.useRealTimers();
      }
    });

    it("reports a gnomAD outage as an error, never as an absence, when there is no local row", async () => {
      const { fetchGnomadVariantFrequency } = await import("./gnomad.ts");
      vi.mocked(fetchGnomadVariantFrequency).mockRejectedValueOnce(new Error("gnomAD down"));
      const result = await fetchCoreVariantData(baseContext, 2000);
      expect(result.gnomadFrequency).toBeNull();
      expect(result.serviceStatus.gnomadFrequency).toBe("error");
    });

    it("never binds protein-selected ALT A AoU to a healthy explicit ALT B, including partial frames", async () => {
      const { fetchPredictorData, fetchConservationDataProgressive } = await import("../prediction/index.ts");
      const { fetchLocalPopulationFrequencies } = await import("../prediction/landscape.ts");
      const { isLocalDbnsfpAvailable } = await import("../prediction/dbnsfp_local.ts");
      vi.mocked(isLocalDbnsfpAvailable).mockReturnValueOnce(true);
      vi.mocked(fetchLocalPopulationFrequencies).mockResolvedValueOnce(null);
      vi.mocked(fetchPredictorData).mockResolvedValueOnce({
        available: true, amPathogenicity: 0.8, caddPhred: 24,
        gnomadVariantId: "12-102845012-G-T", gnomadVariantAssembly: "GRCh38",
        locusResolution: { route: "vep-coordinate", canonicalBy: "vep", retryable: false, steps: [] },
      } as any);
      vi.mocked(fetchConservationDataProgressive).mockResolvedValueOnce({
        revel: null, gerp: null, phylop: null,
        aouFrequency: { aouAC: 100, aouAN: 1000, aouHet: 0, aouHom: 50 },
      } as any);
      const previews: any[] = [];
      const result = await fetchCoreVariantData({ ...baseContext, assembly: "GRCh38", genomicCoordinates: "12-102845012-G-T" },
        2000, undefined, partial => previews.push(partial));
      expect(fetchLocalPopulationFrequencies).toHaveBeenCalledWith("PAH", 408, "p.Arg408Trp",
        { chrom: "12", pos: 102845012, ref: "G", alt: "T", assembly: "GRCh38" });
      expect(result.aouFrequency).toBeNull();
      expect(result.conservationData?.aouFrequency).toBeNull();
      expect(result.aouLookup?.remoteDbnsfp).toBe("not-reported");
      expect(result.ruleBasedInsights!.acmgCriteria.some(c => c.code === "BS2")).toBe(false);
      expect(previews.some(p => p.data.aouFrequency || p.data.conservationData?.aouFrequency)).toBe(false);
    });

    it("retries remote gnomAD after invalid local counts and does not describe invalid AoU as absent", async () => {
      const { fetchLocalPopulationFrequencies } = await import("../prediction/landscape.ts");
      const { isLocalDbnsfpAvailable } = await import("../prediction/dbnsfp_local.ts");
      const { fetchGnomadVariantFrequency } = await import("./gnomad.ts");
      vi.mocked(isLocalDbnsfpAvailable).mockReturnValueOnce(true);
      vi.mocked(fetchLocalPopulationFrequencies).mockResolvedValueOnce({ gnomad: null, aou: null, aouInvalidCounts: true });
      const result = await fetchCoreVariantData(baseContext, 2000);
      expect(fetchGnomadVariantFrequency).toHaveBeenCalledWith("12-102845012-G-A", { assembly: "GRCh38" });
      expect(result.gnomadFrequency?.maxAF).toBe(0.00002);
      expect(result.aouFrequency).toBeNull();
      expect(result.aouLookup).toBeNull();
    });

    it("does not let an all-null local object suppress the remote gnomAD lookup", async () => {
      const { fetchLocalPopulationFrequencies } = await import("../prediction/landscape.ts");
      const { isLocalDbnsfpAvailable } = await import("../prediction/dbnsfp_local.ts");
      const { fetchGnomadVariantFrequency } = await import("./gnomad.ts");
      vi.mocked(isLocalDbnsfpAvailable).mockReturnValueOnce(true);
      vi.mocked(fetchLocalPopulationFrequencies).mockResolvedValueOnce({
        gnomad: { maxAF: null, groupMaxAF: null, genomeAC: null, genomeAN: null, nHomozygous: null }, aou: null,
      });
      const result = await fetchCoreVariantData(baseContext, 2000);
      expect(fetchGnomadVariantFrequency).toHaveBeenCalledWith("12-102845012-G-A", { assembly: "GRCh38" });
      expect(result.gnomadFrequency?.maxAF).toBe(0.00002);
    });
  });

  it("should handle service errors gracefully and report status as error/not_found without throwing", async () => {
    const { fetchClinVarData } = await import("./clinvar.ts");
    vi.mocked(fetchClinVarData).mockRejectedValueOnce(new Error("ClinVar network timeout"));

    const result = await fetchCoreVariantData(baseContext, 2000);

    expect(result).toBeDefined();
    expect(result.clinvar).toBeNull();
    expect(result.serviceStatus.clinvar).toBe("error");
    // Other independent services should still succeed
    expect(result.predictorData?.caddPhred).toBe(28.5);
    expect(result.serviceStatus.predictorData).toBe("ok");
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * PROGRESSIVE EMISSION — one preview per settled source
   * ─────────────────────────────────────────────────────────────────────────────
   * The stream route used to receive nothing from this function until ALL eleven sources had
   * settled, so the second frame the reader ever saw waited on the slowest source. The listener
   * below is what makes each source paintable the moment it answers.
   *
   * The status invariant is the important half: ONE function derives each status, so the running
   * map a preview carries and the final map can never describe the same source differently.
   */
  describe("progressive emission", () => {
    /**
     * The falsifiable half: a preview must exist WHILE a source is still in flight.
     *
     * The assertions below are deliberately about ORDER and PRESENCE, because every "one preview per
     * source" claim is also satisfied by an implementation that buffers all ten and flushes them at
     * the end — which is the defect (a reader waiting on the slowest source) wearing the fix's shape.
     * Holding STRING open behind a gate makes the difference observable: no preview can be flushed
     * for it, so the previews that exist can only come from sources that already settled.
     */
    it("announces a source while another is still in flight, with the running map", async () => {
      const { fetchStringInteractions } = await import("./string.ts");
      let openStringGate: () => void = () => {};
      const gate = new Promise<void>(resolve => { openStringGate = resolve; });
      vi.mocked(fetchStringInteractions).mockImplementationOnce(async () => {
        await gate;
        return [{ preferredName: "QDPR", score: 0.95 }] as any;
      });

      const previews: any[] = [];
      const pending = fetchCoreVariantData(baseContext, 2000, undefined, (partial) => {
        previews.push(partial);
      });

      // Let microtasks drain: everything except the gated source can settle, but nothing may be
      // flushed for it, and the fetch itself cannot complete.
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(previews.length, "nothing was announced before the slowest source finished").toBeGreaterThan(0);
      const beforeGate = previews[previews.length - 1];
      expect(
        beforeGate.serviceStatus.stringInteractions,
        "the running map must keep a pending marker for a source that has not answered"
      ).toBe("pending");
      expect(beforeGate.data.stringInteractions).toBeUndefined();
      // A source that HAS answered is already there, without waiting for the gate.
      expect(beforeGate.serviceStatus.clinvar).toBe("ok");

      openStringGate();
      const result = await pending;

      // The final payload is the authority, and the previews never contradicted it.
      expect(result.serviceStatus.stringInteractions).toBe("ok");
      expect(previews[previews.length - 1].serviceStatus.stringInteractions).toBe("ok");

      /**
       * The offset is REAL. STRING was held behind a gate for at least 20 ms, so the settle offset
       * reported for it cannot be smaller than that — and it is not the same number as the duration
       * by construction, because they are measured from two different starts (the source's attach
       * point and the run's start). A fabricated 0, or a duration reused as an offset, fails here.
       */
      const settledString = previews[previews.length - 1];
      expect(settledString.serviceTimingOffsets.stringInteractions).toBeGreaterThanOrEqual(20);
      expect(typeof settledString.serviceTimingOffsets.stringInteractions).toBe("number");
    });

    it("publishes a total status map: every source is pending until it answers", async () => {
      const previews: any[] = [];
      const result = await fetchCoreVariantData(baseContext, 2000, undefined, (partial) => {
        previews.push(partial);
      });

      const keys = Object.keys(result.serviceStatus);
      for (const preview of previews) {
        expect(
          Object.keys(preview.serviceStatus).sort(),
          "a preview that omits a source is indistinguishable from one that measured it as empty"
        ).toEqual([...keys].sort());
        expect(preview.data.serviceStatus).toEqual(preview.serviceStatus);
        expect(preview.data.metadata.serviceStatus).toEqual(preview.serviceStatus);
      }

      // The FIRST preview still accounts for sources that have not answered — nothing is dropped.
      expect(previews[0].serviceStatus.conservationData).toBe("pending");

      // Each status the final payload reports appeared in a preview first, with the same value.
      for (const [key, status] of Object.entries(result.serviceStatus)) {
        const announced = previews.some(p => p.serviceStatus[key] === status);
        expect(announced, `${key} was decided in the payload but never announced`).toBe(true);
      }
    });

    it("works with no listener at all (the non-streaming route)", async () => {
      const result = await fetchCoreVariantData(baseContext, 2000);
      expect(result.clinvar?.classification).toBe("Pathogenic");
      expect(result.serviceStatus.clinvar).toBe("ok");
    });
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * RACE BUDGETS, REAL TIMINGS, AND THE RUNNING VERDICT
   * ─────────────────────────────────────────────────────────────────────────────
   */
  describe("timeout budgets and per-source timings", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("leaves no armed race timer behind once the run completes", async () => {
      vi.useFakeTimers();

      await fetchCoreVariantData(baseContext, 2000);

      /**
       * The defect this pins: the budgets were two `setTimeout` promises shared by twelve races, and
       * neither was ever cleared — so a run that answered in 20 ms still held a 45 s and a 15 s timer,
       * per request. `vi.getTimerCount()` was 2 here before the fix.
       */
      expect(vi.getTimerCount(), "a completed run must keep no budget timer armed").toBe(0);
    });

    it("times a PREFETCHED source from its own start, and places it on this run's clock", async () => {
      const { fetchClinVarData } = await import("./clinvar.ts");
      vi.mocked(fetchClinVarData).mockImplementationOnce(async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
        return { classification: "Pathogenic", conditions: null, reviewStatus: null, lastEvaluated: null } as any;
      });

      /**
       * A source the caller started 300 ms before this fetch — the shape the stream's fast triage
       * produces. Attaching a clock HERE would report only the ~30 ms tail as the source's whole
       * latency; the real start is handed down instead, so the reported duration covers all of it.
       * The OFFSET is measured from this run's start, which is why it must be the smaller of the two:
       * they are different quantities, and both are measured rather than reconstructed.
       */
      const startedAt = performance.now() - 300;
      const prefetched = {
        clinvarPromise: fetchClinVarData(baseContext.gene, baseContext.variant, baseContext.originalNotation) as any,
        clinvarStartedAt: startedAt
      };

      const result = await fetchCoreVariantData(baseContext, 2000, prefetched as any);

      expect(result.serviceTimings!.clinvar).toBeGreaterThanOrEqual(300);
      expect(result.serviceTimingOffsets!.clinvar).toBeGreaterThanOrEqual(0);
      expect(result.serviceTimingOffsets!.clinvar).toBeLessThan(result.serviceTimings!.clinvar);
      // Every settled source is placed on the timeline, not just the prefetched one.
      for (const key of Object.keys(result.serviceStatus)) {
        expect(typeof result.serviceTimingOffsets![key]).toBe("number");
      }
    });

    it("carries a recomputed, clinically safe ACMG verdict on every preview", async () => {
      const previews: any[] = [];
      await fetchCoreVariantData(baseContext, 2000, undefined, partial => previews.push(partial));

      expect(previews.length).toBeGreaterThan(0);

      for (const preview of previews) {
        expect(preview.data.ruleBasedInsights, "a preview must carry a verdict, not a blank").toBeTruthy();
        expect(typeof preview.data.ruleBasedInsights.acmgVerdict).toBe("string");

        /**
         * THE SAFETY INVARIANT. A preview's verdict is computed from the preview's OWN statuses, so a
         * source that has not answered withholds its criterion instead of inventing one: PM2 may not
         * be awarded while gnomAD is anything other than a measured answer. Getting this wrong is the
         * defect `ServiceFetchStatus` was created for — "not asked" read as "confirmed absent".
         */
        const gnomadStatus = preview.serviceStatus.gnomadFrequency;
        const codes = preview.data.ruleBasedInsights.acmgCriteria.map((c: any) => c.code);
        if (gnomadStatus === "pending" || gnomadStatus === "timeout" || gnomadStatus === "error" || gnomadStatus === "unsupported-build") {
          expect(codes, `PM2 must be withheld while gnomAD is ${gnomadStatus}`).not.toContain("PM2");
        }
      }
    });
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * THE FAST-TRIAGE HAND-OUT — what a joining route is allowed to reuse
   * ─────────────────────────────────────────────────────────────────────────────
   * A route that joins this run (the stream arriving after the structural tab opened it) builds its
   * first frame from these two answers. They must therefore be the SAME data and the SAME verdict the
   * final payload will carry, or the two surfaces would describe ClinVar differently — and the
   * verdict must be this pipeline's own derivation, including the outage/absence distinction.
   */
  describe("fast-triage hand-out", () => {
    it("hands out ClinVar and predictors, synchronously, with the status the payload will report", async () => {
      let handedOut: any = null;
      let handedOutBeforeFirstAwait = false;

      const run = fetchCoreVariantData(
        baseContext,
        2000,
        undefined,
        undefined,
        triage => {
          handedOut = triage;
          // Called before this function's first await, so a caller that joins in the same tick sees it.
          handedOutBeforeFirstAwait = true;
        }
      );

      expect(handedOutBeforeFirstAwait, "the hand-out must be synchronous").toBe(true);
      expect(handedOut?.clinvar).toBeInstanceOf(Promise);
      expect(handedOut?.predictorData).toBeInstanceOf(Promise);

      const result = await run;
      const [clinvar, predictors] = await Promise.all([handedOut.clinvar, handedOut.predictorData]);

      // The same data the payload carries...
      expect(clinvar.data).toEqual(result.clinvar);
      expect(predictors.data).toEqual(result.predictorData);
      // ...and the same STATUS, derived once by the same rules.
      expect(clinvar.status).toBe(result.serviceStatus.clinvar);
      expect(predictors.status).toBe(result.serviceStatus.predictorData);
    });

    it("reports an outage to a joining route as an error, never as a measured absence", async () => {
      const { fetchClinVarData } = await import("./clinvar.ts");
      vi.mocked(fetchClinVarData).mockRejectedValueOnce(new Error("ClinVar network timeout"));

      let handedOut: any = null;
      const run = fetchCoreVariantData(baseContext, 2000, undefined, undefined, triage => { handedOut = triage; });
      await run;

      const clinvar = await handedOut.clinvar;
      expect(clinvar.data).toBeNull();
      expect(clinvar.status, "a failed query is not a confirmed absence").toBe("error");
    });
  });
});
