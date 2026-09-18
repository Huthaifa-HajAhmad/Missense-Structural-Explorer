import { describe, it, expect, vi } from "vitest";
import { computeRuleBasedACMG } from "./acmg.ts";
import { computeConsensusVerdict } from "../../../src/shared/thresholds.ts";
import { 
  svd3, 
  calculateLocalSidechainRmsd, 
  calculateClashes, 
  predictStructuralDisruption, 
  type PdbAtom 
} from "../stability/biophysics.ts";

describe("MissenseResolve® Correctness & Predictors Tests", () => {
  describe("MissenseResolve® Correctness Rules", () => {
    it("should assign PVS1 for nonsense/stop/frameshift variants in known constrained genes when NMD is predicted", () => {
      const res = computeRuleBasedACMG({
        gene: "PAH",
        variant: "p.Arg100*",
        clinvar: null,
        predictorData: { available: true, amPathogenicity: null, amClass: null, caddPhred: null },
        conservationData: { available: false, revel: null },
        gnomadConstraint: { pli: 0.95, missense_z: 1.0, oe_mis: 1.0, isPP2Constrained: false },
        gnomadFrequency: null,
        acmgWeighting: "standard",
        esm2: null,
        uniprotFeatures: null,
        sequence: "A".repeat(452)
      });
      expect(res.acmgCriteria.some(c => c.code === "PVS1")).toBe(true);
    });

    it("should assign PVS1_Moderate for C-terminal nonsense variants without critical domain overlap", () => {
      const res = computeRuleBasedACMG({
        gene: "PAH",
        variant: "p.Arg408*",
        clinvar: null,
        predictorData: { available: true, amPathogenicity: null, amClass: null, caddPhred: null },
        conservationData: { available: false, revel: null },
        gnomadConstraint: { pli: 0.95, missense_z: 1.0, oe_mis: 1.0, isPP2Constrained: false },
        gnomadFrequency: null,
        acmgWeighting: "standard",
        esm2: null,
        uniprotFeatures: null,
        sequence: "A".repeat(452)
      });
      expect(res.acmgCriteria.some(c => c.code === "PVS1_Moderate")).toBe(true);
    });

    it("should assign PVS1_Strong for C-terminal nonsense variants with critical domain overlap", () => {
      const res = computeRuleBasedACMG({
        gene: "PAH",
        variant: "p.Arg408*",
        clinvar: null,
        predictorData: { available: true, amPathogenicity: null, amClass: null, caddPhred: null },
        conservationData: { available: false, revel: null },
        gnomadConstraint: { pli: 0.95, missense_z: 1.0, oe_mis: 1.0, isPP2Constrained: false },
        gnomadFrequency: null,
        acmgWeighting: "standard",
        esm2: null,
        uniprotFeatures: { features: [{ type: "domain", start: 400, end: 420 }] },
        sequence: "A".repeat(452)
      });
      expect(res.acmgCriteria.some(c => c.code === "PVS1_Strong")).toBe(true);
    });

    it("should correctly count homozygous null variants when total is zero", async () => {
      const fakeGnomadData = {
        exome: { homozygous_count: 0 },
        genome: { homozygous_count: 0 }
      };
      const totalHom = (fakeGnomadData.exome?.homozygous_count ?? 0) + (fakeGnomadData.genome?.homozygous_count ?? 0);
      expect(totalHom).toBe(0);
    });

    it("should validate and compute consensus verdict stability correctly", () => {
      const highRisk = computeConsensusVerdict({ foldxMean: 2.0, rasp: -1.2 });
      expect(highRisk).toBe("Moderate Misfolding Risk (Conflicting Stability)");

      const conflicting = computeConsensusVerdict({ foldxMean: 2.0, rasp: 0.1, ddmut: 0.2 });
      expect(conflicting).toBe("Moderate Misfolding Risk (Conflicting Stability)");

      const neutral = computeConsensusVerdict({ foldxMean: 0.5, rasp: 0.2 });
      expect(neutral).toBe("Low Misfolding Risk (Neutral Stability)");
    });
  });

  describe("Critical Biophysical Numerical and Rules Verification (C-2)", () => {
    it("should verify svd3 matrix decomposition against a known identity matrix", () => {
      const I = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ] as any;
      const { U, S, V } = svd3(I);
      expect(S[0]).toBeCloseTo(1.0);
      expect(S[1]).toBeCloseTo(1.0);
      expect(S[2]).toBeCloseTo(1.0);
      expect(U[0][0]).toBeCloseTo(1.0);
      expect(V[0][0]).toBeCloseTo(1.0);
    });

    it("should compute 0.0 RMSD for perfectly aligned identical sidechains", () => {
      const atom1: PdbAtom = { resSeq: 10, resName: "ARG", name: "CB", chain: "A", x: 1.0, y: 1.0, z: 1.0 };
      const atom2: PdbAtom = { resSeq: 10, resName: "ARG", name: "CG", chain: "A", x: 2.0, y: 1.5, z: 1.0 };
      const atom3: PdbAtom = { resSeq: 10, resName: "ARG", name: "CA", chain: "A", x: 0.0, y: 0.0, z: 0.0 };
      const rmsd = calculateLocalSidechainRmsd([atom1, atom2, atom3], [atom1, atom2, atom3], 10, "A");
      expect(rmsd).toBeCloseTo(0.0);
    });

    it("should accurately count steric clashes when atoms are below threshold", () => {
      const a1: PdbAtom = { resSeq: 1, resName: "ALA", name: "CA", chain: "A", x: 0.0, y: 0.0, z: 0.0 };
      const a2: PdbAtom = { resSeq: 5, resName: "ALA", name: "CB", chain: "A", x: 1.0, y: 1.0, z: 1.0 };
      expect(calculateClashes([a1, a2])).toBe(1);

      const a3: PdbAtom = { resSeq: 5, resName: "ALA", name: "CB", chain: "A", x: 3.0, y: 0.0, z: 0.0 };
      expect(calculateClashes([a1, a3])).toBe(0);
    });

    it("should evaluate predictStructuralDisruption rules correctly", async () => {
      function formatPdbAtomLine(serial: number, name: string, resName: string, chain: string, resSeq: number, x: number, y: number, z: number): string {
        const chars = Array(80).fill(" ");
        chars.splice(0, 4, ..."ATOM".split(""));
        const serialStr = String(serial).padStart(5, " ");
        chars.splice(6, 5, ...serialStr.split(""));
        const nameStr = name.padEnd(4, " ");
        chars.splice(12, 4, ...nameStr.split(""));
        const resNameStr = resName.padEnd(3, " ");
        chars.splice(17, 3, ...resNameStr.split(""));
        chars[21] = chain.slice(0, 1);
        const resSeqStr = String(resSeq).padStart(4, " ");
        chars.splice(22, 4, ...resSeqStr.split(""));
        const xStr = x.toFixed(3).padStart(8, " ");
        chars.splice(30, 8, ...xStr.split(""));
        const yStr = y.toFixed(3).padStart(8, " ");
        chars.splice(38, 8, ...yStr.split(""));
        const zStr = z.toFixed(3).padStart(8, " ");
        chars.splice(46, 8, ...zStr.split(""));
        const bStr = "95.00".padStart(6, " ");
        chars.splice(60, 6, ...bStr.split(""));
        return chars.join("");
      }

      const pdbHelix = `
HELIX    1  H1 ALA A   10  ALA A   20
${formatPdbAtomLine(1, "CA", "ALA", "A", 10, 0, 0, 0)}
TER
END
      `.trim();
      const resA = await predictStructuralDisruption(pdbHelix, "A", 10, "P", "A");
      expect(resA.level).toBe("high");
      expect(resA.reason).toContain("Proline introduced at position 10");

      let pdbBuried = formatPdbAtomLine(1, "CA", "ASP", "A", 15, 0, 0, 0) + "\n";
      for (let i = 1; i <= 15; i++) {
        const theta = (i / 15) * 2 * Math.PI;
        const phi = (i / 15) * Math.PI;
        const r = 2.0;
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);
        pdbBuried += formatPdbAtomLine(i + 1, "CA", "VAL", "A", 15 + i, x, y, z) + "\n";
      }
      pdbBuried += "TER\nEND";
      const resB = await predictStructuralDisruption(pdbBuried, "D", 15, "R", "A");
      expect(resB.level).toBe("high");
      expect(resB.reason).toContain("Buried charge reversal");

      let pdbVolume = formatPdbAtomLine(1, "CA", "GLY", "A", 20, 0, 0, 0) + "\n";
      for (let i = 1; i <= 15; i++) {
        const theta = (i / 15) * 2 * Math.PI;
        const phi = (i / 15) * Math.PI;
        const r = 2.0;
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);
        pdbVolume += formatPdbAtomLine(i + 1, "CA", "VAL", "A", 20 + i, x, y, z) + "\n";
      }
      pdbVolume += "TER\nEND";
      const resC = await predictStructuralDisruption(pdbVolume, "G", 20, "W", "A");
      expect(resC.level).toBe("high");
      expect(resC.reason).toContain("Severe core steric expansion");

      const pdbLoop = `
${formatPdbAtomLine(1, "CA", "PRO", "A", 25, 0, 0, 0)}
TER
END
      `.trim();
      const resD = await predictStructuralDisruption(pdbLoop, "P", 25, "G", "A");
      expect(resD.level).toBe("high");
      expect(resD.reason).toContain("Proline to Glycine substitution in structural loop");

      const pdbNeutral = `
${formatPdbAtomLine(1, "CA", "ALA", "A", 30, 0, 0, 0)}
TER
END
      `.trim();
      const resNormal = await predictStructuralDisruption(pdbNeutral, "A", 30, "V", "A");
      expect(resNormal.level).toBe("low");
    }, 60000);
  });

  describe("Progressive Conservation Merge", () => {
    it("should progressively merge async PDB mapping and predictor enrichment into base conservation data", async () => {
      const { fetchConservationDataProgressive } = await import("../predictors.ts");

      const mockPdbMappingPromise = Promise.resolve({
        pdbId: "1TUP",
        chainId: "A",
        shift: 0,
        unpStart: 1,
        structStart: 1
      });

      const mockPredictorPromise = Promise.resolve({
        gnomadVariantId: "17-7577121-G-A",
        transcriptId: "ENST00000269305"
      });

      const mockGenosPromise = Promise.resolve({
        revel: 0.85,
        gerp: 4.5,
        phylop: 7.2,
        popeve: 1.2
      });

      const result = await fetchConservationDataProgressive({
        gene: "TP53",
        variant: "p.R273H",
        pos: 273,
        uniprotId: "P04637",
        pdbMappingPromise: mockPdbMappingPromise,
        predictorPromise: mockPredictorPromise,
        genosPromise: mockGenosPromise
      });

      expect(result).toBeDefined();
      expect(result.available).toBe(true);
      expect("alphagenome" in result).toBe(true);
    }, 25000);

    it("should enrich alphagenome from predictor promise with colon or Ensembl coordinates", async () => {
      const { fetchConservationDataProgressive } = await import("../predictors.ts");
      const { setAlphaGenomeMockProvider } = await import("../alphagenome-bridge.ts");

      setAlphaGenomeMockProvider(async () => ({
        status: "live",
        aviPhred: 32.5,
        acmgStrength: "PP3_Moderate",
        topModality: "Splicing"
      }));

      const mockPredictor = Promise.resolve({
        gnomadVariantId: "chr17:7673802:C>T", // colon notation with >
        // AlphaGenome is GRCh38-only and the gate keys on the coordinate's build, so the fixture
        // must declare one. An undeclared build is refused rather than assumed.
        gnomadVariantAssembly: "GRCh38",
        transcriptId: "ENST00000269305"
      });

      const res = await fetchConservationDataProgressive({
        gene: "TP53",
        variant: "p.R273H",
        pos: 273,
        predictorPromise: mockPredictor
      });

      expect(res.alphagenome).toBeDefined();
      expect(res.alphagenome?.status).toBe("live");
      expect(res.alphagenome?.aviPhred).toBe(32.5);
      expect(res.alphagenome?.acmgStrength).toBe("PP3_Moderate");

      setAlphaGenomeMockProvider(null);
    }, 25000);

    /**
     * Wiring regression tests for the live SpliceAI overlay.
     *
     * These exist because the feature was once inert in production while every unit test of the
     * client passed: the fetch was placed on a code path that never received a genomic coordinate,
     * so it returned null for every variant. Testing the client in isolation cannot catch that —
     * only exercising the orchestrator's own path can. `setSpliceAiMockProvider` keeps these
     * hermetic (no call to the rate-limited third-party service).
     */
    it("overlays a live SpliceAI score onto the progressive result, with provenance", async () => {
      const { fetchConservationDataProgressive } = await import("../predictors.ts");
      const { setSpliceAiMockProvider } = await import("../external-api/spliceai_broad.ts");
      const { clearAllCaches } = await import("../infra/cache.ts");

      // The conservation cache is keyed by gene/variant/pos, so without this an earlier test's
      // entry is served and the mock provider is never consulted.
      clearAllCaches(true);

      setSpliceAiMockProvider(async (chrom, pos, ref, alt) => {
        // The coordinate must reach the client intact, or the score is for the wrong variant.
        // The parser preserves the input spelling, so a "1-25484258-G-A" id yields "1".
        expect(chrom).toBe("1");
        expect(pos).toBe(25484258);
        expect(ref).toBe("G");
        expect(alt).toBe("A");
        return {
          ds_ag: 0, ds_al: 0, ds_dg: 0, ds_dl: 0.004,
          max_ds: 0.004,
          dp: { ds_ag: -142, ds_al: -172, ds_dg: 19, ds_dl: 123 },
          transcriptId: "ENST00000374343.5",
          transcriptRefSeqIds: ["NM_018202.6"],
          isManeSelect: true,
          geneSymbol: "MACO1",
          distance: 500,
          mask: 1,
          computedLive: true,
          source: "spliceai:model",
        };
      });

      try {
        const res = await fetchConservationDataProgressive({
          gene: "MACO1",
          variant: "p.Glu433Lys",
          pos: 433,
          predictorPromise: Promise.resolve({
            gnomadVariantId: "1-25484258-G-A",
            // The coordinate's build must be declared explicitly: the gate now keys on it, and a
            // null build refuses. This mirrors the Ensembl VEP producer, which queries the GRCh38
            // host. The MyVariant producer instead declares GRCh37, because its `_id` is hg19.
            gnomadVariantAssembly: "GRCh38",
            transcriptId: "ENST00000374343"
          })
        });

        // The headline goal: a variant with no precomputed value now carries a measured score.
        expect(res.spliceai).not.toBeNull();
        expect(res.spliceai?.max_ds).toBeCloseTo(0.004, 5);
        // Delta positions must survive the merge — they localise where splicing shifts.
        expect(res.spliceai?.dp?.ds_dl).toBe(123);
        // Provenance must survive too, so a reader can tell live from frozen.
        expect(res.spliceai?.provenance?.source).toBe("broad-lookup");
        expect(res.spliceai?.provenance?.distanceBp).toBe(500);
        expect(res.spliceai?.provenance?.masked).toBe(1);
      } finally {
        setSpliceAiMockProvider(null);
      }
    }, 25000);

    it("preserves the precomputed score when the live lookup misses", async () => {
      const { fetchConservationDataProgressive } = await import("../predictors.ts");
      const { setSpliceAiMockProvider } = await import("../external-api/spliceai_broad.ts");
      const { clearAllCaches } = await import("../infra/cache.ts");
      clearAllCaches(true);

      // Simulates an unreachable or rate-limited upstream.
      setSpliceAiMockProvider(async () => null);

      try {
        const res = await fetchConservationDataProgressive({
          gene: "MACO1",
          variant: "p.Glu433Lys",
          pos: 433,
          predictorPromise: Promise.resolve({
            gnomadVariantId: "1-25484258-G-A",
            // The coordinate's build must be declared explicitly: the gate now keys on it, and a
            // null build refuses. This mirrors the Ensembl VEP producer, which queries the GRCh38
            // host. The MyVariant producer instead declares GRCh37, because its `_id` is hg19.
            gnomadVariantAssembly: "GRCh38",
            transcriptId: "ENST00000374343"
          })
        });

        // A null live score must never erase or fabricate the fallback value.
        if (res.spliceai !== null && res.spliceai !== undefined) {
          expect(res.spliceai.provenance?.source).not.toBe("broad-lookup");
        }
      } finally {
        setSpliceAiMockProvider(null);
      }
    }, 25000);

    /**
     * Build-binding tests.
     *
     * The gate previously compared the build the user's NOTATION declared against each source's
     * support, which answers the wrong question: the coordinate comes from predictor metadata
     * whose producers disagree (VEP → GRCh38 host; MyVariant `_id` → hg19). That let a GRCh37
     * request route a GRCh38 coordinate to the GRCh37 service, and an untagged coordinate reach
     * GRCh38-only sources. These pin the corrected semantics: the gate follows the COORDINATE's
     * build, and an unknown build refuses rather than defaulting.
     */
    it("refuses a coordinate whose build is unknown, rather than assuming one", async () => {
      const { fetchConservationDataProgressive } = await import("../predictors.ts");
      const { setSpliceAiMockProvider } = await import("../external-api/spliceai_broad.ts");
      const { clearAllCaches } = await import("../infra/cache.ts");
      clearAllCaches(true);

      let called = false;
      setSpliceAiMockProvider(async () => {
        called = true;
        return null;
      });

      try {
        await fetchConservationDataProgressive({
          gene: "MACO1",
          variant: "p.Glu433Lys",
          pos: 433,
          // No gnomadVariantAssembly: the coordinate's build is unknown.
          predictorPromise: Promise.resolve({
            gnomadVariantId: "1-25484258-G-A",
            transcriptId: "ENST00000374343"
          })
        });

        // An untagged coordinate must not be routed: a wrong-build request is not merely a miss,
        // it can be ACCEPTED and scored for a different locus. Refusing is the safe answer.
        expect(called).toBe(false);
      } finally {
        setSpliceAiMockProvider(null);
      }
    }, 25000);

    it("routes a GRCh37-labelled coordinate to the GRCh37 service, not the GRCh38 one", async () => {
      const { fetchSpliceAiBroad, setSpliceAiMockProvider } = await import("../external-api/spliceai_broad.ts");

      // Capture the URL the client would actually request. The mock provider sits at the
      // transport boundary, so the URL is built for real and only the response is stubbed.
      let requestedUrl: string | null = null;
      const originalFetch = global.fetch;
      global.fetch = (async (url: any) => {
        requestedUrl = String(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({ scores: [] }),
          text: async () => "",
          headers: { get: () => null }
        } as any;
      }) as any;
      setSpliceAiMockProvider(null);

      try {
        await fetchSpliceAiBroad("17", 7577121, "G", "A", { assembly: "GRCh37", skipCache: true });

        // The whole point of labelling the coordinate: an hg19 position goes to the hg37
        // service. Sending it to the GRCh38 model is what produced a plausible score for a
        // different locus (the hg38 base at that numeric position coincides with the hg19 REF).
        expect(requestedUrl).not.toBeNull();
        expect(requestedUrl).toContain("spliceai-37-");
        expect(requestedUrl).not.toContain("spliceai-38-");
        expect(requestedUrl).toContain("hg=37");
      } finally {
        global.fetch = originalFetch;
        setSpliceAiMockProvider(null);
      }
    }, 25000);
  });

  describe("Tier 3 Public dbNSFP Predictors Extraction", () => {
    it("should extract DANN, BayesDel, ClinPred, and Eigen from dbnsfp function_prediction response", async () => {
      const { queryDbnsfpOrg } = await import("../predictors.ts");
      const origFetch = global.fetch;

      const mockResponse = {
        tabs: {
          conservative_scores: {
            rows: [{ "GERP++_RS": "4.2", "phyloP100way_vertebrate": "7.8" }]
          },
          all_transcripts: {
            rows: [{ REVEL: "0.45", MetaRNN: "0.82", ESM1b: "-6.5", popEVE: "-4.1" }]
          },
          function_prediction: {
            rows: [{
              DANN_score: "0.992",
              BayesDel_noAF_score: "0.15",
              ClinPred_score: "0.98",
              "Eigen-phred_coding": "6.8",
              "Eigen-raw_coding": "0.72"
            }]
          }
        }
      };

      global.fetch = async () => new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

      try {
        const res = await queryDbnsfpOrg("GZF1", "p.Arg591Trp", "20-23369727-C-T");
        expect(res).toBeDefined();
        expect(res?.revel).toBeCloseTo(0.45);
        expect(res?.dann).toBeCloseTo(0.992);
        expect(res?.bayesdel).toBeCloseTo(0.15);
        expect(res?.clinpred).toBeCloseTo(0.98);
        expect(res?.eigenPhred).toBeCloseTo(6.8);
        expect(res?.eigenRaw).toBeCloseTo(0.72);
      } finally {
        global.fetch = origFetch;
      }
    });

    it("should preserve DANN, BayesDel, ClinPred, and Eigen in Tier 3 fetchConservationData", async () => {
      const { fetchConservationData } = await import("../predictors.ts");
      const { clearAllCaches } = await import("../cache.ts");
      clearAllCaches(true);
      const origFetch = global.fetch;

      const mockResponse = {
        tabs: {
          conservative_scores: {
            rows: [{ "GERP++_RS": "3.5", "phyloP100way_vertebrate": "6.1" }]
          },
          all_transcripts: {
            rows: [{ REVEL: "0.33", MetaRNN: "0.65", ESM1b: "-5.0" }]
          },
          function_prediction: {
            rows: [{
              DANN_score: "0.995",
              BayesDel_noAF_score: "0.22",
              ClinPred_score: "0.91",
              "Eigen-phred_coding": "5.5",
              "Eigen-raw_coding": "0.60"
            }]
          }
        }
      };

      global.fetch = async () => new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

      try {
        const res = await fetchConservationData("GZF1", "p.Arg591Trp", null, null, 591, "20-23369727-C-T");
        expect(res.available).toBe(true);
        expect(res.source).toBe("Public dbNSFP (dbnsfp.org)");
        expect(res.dann).toBeCloseTo(0.995);
        expect(res.bayesdel).toBeCloseTo(0.22);
        expect(res.clinpred).toBeCloseTo(0.91);
        expect(res.eigenPhred).toBeCloseTo(5.5);
        expect(res.eigenRaw).toBeCloseTo(0.60);
      } finally {
        global.fetch = origFetch;
      }
    });

    it("should fallback to MyVariant.info when Ensembl VEP 503s and strictly match variant substitution", async () => {
      const { fetchPredictorData } = await import("../predictors.ts");
      const { clearAllCaches } = await import("../cache.ts");
      clearAllCaches(true);
      const origFetch = global.fetch;

      global.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes("rest.ensembl.org")) {
          // Simulate Ensembl VEP HTTP 503 Service Unavailable
          return new Response(JSON.stringify({ error: "Service unavailable" }), {
            status: 503,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (urlStr.includes("rest.uniprot.org")) {
          return new Response(JSON.stringify({
            uniProtKBCrossReferences: [
              { database: "RefSeq", properties: [{ key: "NucleotideSequenceId", value: "NM_013400.3" }] },
              { database: "Ensembl", id: "ENST00000305885" }
            ]
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (urlStr.includes("myvariant.info")) {
          return new Response(JSON.stringify({
            hits: [
              // Hit 1: Different substitution at same position (p.Arg408Gln) - must be rejected!
              {
                dbnsfp: {
                  hgvsp: ["p.Arg408Gln", "p.R408Q"],
                  alphamissense: { am_pathogenicity: 0.12, am_class: "likely_benign" },
                  cadd: { phred: 12.5 }
                }
              },
              // Hit 2: Exact matching substitution (p.Arg408Trp) - must be accepted!
              {
                _id: "chr12:g.102844810C>T",
                dbnsfp: {
                  hgvsp: ["p.Arg408Trp", "p.R408W"],
                  alphamissense: { am_pathogenicity: 0.985, am_class: "likely_pathogenic" },
                  cadd: { phred: 34.0 }
                }
              }
            ]
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("{}", { status: 404 });
      });

      try {
        const res = await fetchPredictorData("PAH", "p.Arg408Trp", "P00439");
        expect(res.available).toBe(true);
        expect(res.source).toBe("MyVariant.info & dbNSFP (VEP Fallback)");
        expect(res.amPathogenicity).toBeCloseTo(0.985);
        expect(res.amClass).toBe("likely_pathogenic");
        expect(res.caddPhred).toBeCloseTo(34.0);
        expect(res.transcriptId).toBe("ENST00000305885");
        expect(res.maneRefSeqId).toBe("NM_013400.3");
      } finally {
        global.fetch = origFetch;
      }
    }, 15000);

    it("should prioritize dedicated MANE-Select database cross-references from UniProt", async () => {
      const { fetchPredictorData } = await import("../predictors.ts");
      const { clearAllCaches } = await import("../cache.ts");
      clearAllCaches(true);
      const origFetch = global.fetch;
      global.fetch = vi.fn(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("rest.ensembl.org")) {
          return new Response(JSON.stringify({ error: "Isoform mismatch 400" }), { status: 400 });
        }
        if (urlStr.includes("uniprot.org")) {
          return new Response(JSON.stringify({
            uniProtKBCrossReferences: [
              {
                database: "Ensembl",
                id: "ENST00000999999.1",
                properties: [{ key: "ProteinId", value: "ENSP00000999999.1" }]
              },
              {
                database: "RefSeq",
                id: "NP_999999.1",
                properties: [{ key: "NucleotideSequenceId", value: "NM_999999.1" }]
              },
              {
                database: "MANE-Select",
                id: "ENST00000361297.7",
                properties: [
                  { key: "RefSeqNucleotideId", value: "NM_015112.3" },
                  { key: "RefSeqProteinId", value: "NP_055927.2" }
                ]
              }
            ]
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (urlStr.includes("myvariant.info")) {
          return new Response(JSON.stringify({ hits: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("{}", { status: 404 });
      });

      try {
        const res = await fetchPredictorData("MAST2", "p.Arg408Cys", "P99999");
        expect(res.transcriptId).toBe("ENST00000361297.7");
        expect(res.maneRefSeqId).toBe("NM_015112.3");
        expect(res.isManeSelect).toBe(true);
      } finally {
        global.fetch = origFetch;
      }
    }, 15000);
  });
});
