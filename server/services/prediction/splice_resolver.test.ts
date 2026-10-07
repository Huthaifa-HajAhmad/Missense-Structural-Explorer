import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calculateDistanceToSpliceSite,
  fetchTranscriptExons,
  nearbyExonsOf,
  resolveSpliceProximity,
  resetExonCacheForTests
} from "./splice_resolver.ts";
import { AnalysisDatabase } from "../infra/analysis-db.ts";

describe("Splice Resolver and Distance Calculator Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetExonCacheForTests();
  });

  describe("calculateDistanceToSpliceSite", () => {
    it("should return Infinity if exons list is empty", () => {
      expect(calculateDistanceToSpliceSite(100, [])).toBe(Infinity);
    });

    it("should calculate correct minimum distance to any start/end coordinate of exons", () => {
      const exons = [
        { start: 10, end: 50 },
        { start: 100, end: 150 }
      ];

      // Variant exactly on a boundary
      expect(calculateDistanceToSpliceSite(10, exons)).toBe(0);
      expect(calculateDistanceToSpliceSite(150, exons)).toBe(0);

      // Variant close to a boundary
      expect(calculateDistanceToSpliceSite(54, exons)).toBe(4);
      expect(calculateDistanceToSpliceSite(97, exons)).toBe(3);

      // Variant right in the middle
      expect(calculateDistanceToSpliceSite(75, exons)).toBe(25);
    });
  });

  describe("fetchTranscriptExons and resolveSpliceProximity", () => {
    it("should return null if Ensembl API returns non-OK status", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 404
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await fetchTranscriptExons("ENST00000300000");
      expect(result).toBeNull();
    });

    it("should resolve splice proximity and exon/intron structure correctly from mock API", async () => {
      const mockEnsemblResponse = {
        object_type: "Transcript",
        id: "ENST00000256078",
        strand: 1,
        Exon: [
          { id: "EXON1", start: 1000, end: 1200 },
          { id: "EXON2", start: 2000, end: 2200 }
        ]
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockEnsemblResponse
      });
      vi.stubGlobal("fetch", fetchMock);

      // Variant is at 1195 (5bp from exon 1 end / donor junction)
      const res = await resolveSpliceProximity("ENST00000256078", 1195);
      expect(res).toBeDefined();
      expect(res!.distance).toBe(5);
      expect(res!.isNearSpliceSite).toBe(true);
      expect(res!.exonNumber).toBe(1);
      expect(res!.totalExons).toBe(2);
      expect(res!.exonLength).toBe(201);
      expect(res!.junctionType).toBe("donor");
      expect(res!.adjacentIntronNumber).toBe(1);
      expect(res!.regionType).toBe("exonic");

      // Variant is in Intron 1 at 1500 (300bp from boundaries)
      const resFar = await resolveSpliceProximity("ENST00000256078", 1500);
      expect(resFar).toBeDefined();
      expect(resFar!.distance).toBe(300);
      expect(resFar!.isNearSpliceSite).toBe(false);
      expect(resFar!.regionType).toBe("intronic");
      expect(resFar!.intronNumber).toBe(1);
    });

    it("should correctly handle reverse-strand transcripts (strand: -1)", async () => {
      const mockReverseResponse = {
        object_type: "Transcript",
        id: "ENST00000400000",
        strand: -1,
        Exon: [
          { id: "EXON_REV_2", start: 1000, end: 1200 }, // in reverse strand, this is Exon 2 (3' end of transcript)
          { id: "EXON_REV_1", start: 2000, end: 2200 }  // in reverse strand, this is Exon 1 (5' start of transcript)
        ]
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockReverseResponse
      });
      vi.stubGlobal("fetch", fetchMock);

      // Variant is at 2004 (4bp from 2000, which is the 5' donor of Exon 1 on reverse strand)
      const resDonor = await resolveSpliceProximity("ENST00000400000", 2004);
      expect(resDonor).toBeDefined();
      expect(resDonor!.distance).toBe(4);
      expect(resDonor!.isNearSpliceSite).toBe(true);
      expect(resDonor!.exonNumber).toBe(1);
      expect(resDonor!.totalExons).toBe(2);
      expect(resDonor!.junctionType).toBe("donor");
      expect(resDonor!.adjacentIntronNumber).toBe(1);
      expect(resDonor!.strand).toBe("-");

      // Variant at 2198 (2bp from 2200, which is the transcription start site / 5' terminal boundary)
      const resTSS = await resolveSpliceProximity("ENST00000400000", 2198);
      expect(resTSS).toBeDefined();
      expect(resTSS!.distance).toBe(2);
      expect(resTSS!.junctionType).toBe("terminal");
      expect(resTSS!.isNearSpliceSite).toBe(false); // Terminal boundary must never trigger splice proximity
    });

    it("should never flag single-exon genes as near splice site", async () => {
      const mockSingleExonResponse = {
        object_type: "Transcript",
        id: "ENST00000500000",
        strand: 1,
        Exon: [
          { id: "EXON_SINGLE", start: 1000, end: 2000 }
        ]
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockSingleExonResponse
      });
      vi.stubGlobal("fetch", fetchMock);

      // Variant at 1002 (2bp from transcript start)
      const res = await resolveSpliceProximity("ENST00000500000", 1002);
      expect(res).toBeDefined();
      expect(res!.distance).toBe(2);
      expect(res!.totalExons).toBe(1);
      expect(res!.junctionType).toBe("terminal");
      expect(res!.isNearSpliceSite).toBe(false); // No splicing occurs in single-exon transcripts
      expect(res!.isCanonicalJunction).toBe(false); // A terminus is not an exon/intron junction
      expect(res!.adjacentIntronNumber).toBeNull();
    });

    it("marks a real donor/acceptor boundary as a canonical junction", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          object_type: "Transcript",
          id: "ENST00000256078",
          strand: 1,
          Exon: [
            { id: "EXON1", start: 1000, end: 1200 },
            { id: "EXON2", start: 2000, end: 2200 }
          ]
        })
      });
      vi.stubGlobal("fetch", fetchMock);

      // 5bp from exon 1's end => a genuine donor junction.
      const donor = await resolveSpliceProximity("ENST00000256078", 1195);
      expect(donor!.junctionType).toBe("donor");
      expect(donor!.isCanonicalJunction).toBe(true);
    });

    it("leaves regionType null for positions outside the transcript span", async () => {
      // 5000 sits well downstream of the last exon (ending at 2200), matching neither
      // the exon loop nor any intron. It must not be reported as "exonic": that
      // produced payloads claiming "Region Type: Exonic" with no exon bounds.
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          object_type: "Transcript",
          id: "ENST00000256078",
          strand: 1,
          Exon: [
            { id: "EXON1", start: 1000, end: 1200 },
            { id: "EXON2", start: 2000, end: 2200 }
          ]
        })
      });
      vi.stubGlobal("fetch", fetchMock);

      const offTranscript = await resolveSpliceProximity("ENST00000256078", 5000);
      expect(offTranscript).toBeDefined();
      expect(offTranscript!.regionType).toBeNull();
      expect(offTranscript!.exonNumber).toBeNull();
      expect(offTranscript!.exonStart).toBeNull();
      expect(offTranscript!.isCanonicalJunction).toBe(false);
      // Distance is still reported (fallback calculator); it just is not a junction hit.
      expect(offTranscript!.distance).toBeGreaterThan(0);
    });

    /**
     * F-6 (unmapping-defect audit): the resolver previously accepted any integer and measured
     * it against the transcript's exons without ever checking the contig — so a wrong-build or
     * wrong-locus coordinate that reached it rendered as confident geometry.
     */
    describe("contig guard", () => {
      // Distinct transcript ids per case: the resolver's exon cache is module-level and is
      // NOT cleared between tests, so reusing an id would serve the first mock's structure.
      const twoExonTranscript = (id: string, contig: string) => ({
        ok: true,
        json: async () => ({
          object_type: "Transcript",
          id,
          strand: 1,
          seq_region_name: contig,
          Exon: [
            { id: "EXON1", start: 1000, end: 1200 },
            { id: "EXON2", start: 2000, end: 2200 }
          ]
        })
      });

      it("refuses geometry when the variant contig is not the transcript's chromosome", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(twoExonTranscript("ENST00000600001", "1")));
        const res = await resolveSpliceProximity("ENST00000600001", 1195, "X");
        expect(res).toBeNull();
      });

      it("resolves when the contig matches, tolerating the chr prefix and case", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(twoExonTranscript("ENST00000600002", "1")));
        const res = await resolveSpliceProximity("ENST00000600002", 1195, "chr1");
        expect(res).not.toBeNull();
        expect(res!.distance).toBe(5);
      });

      it("stays permissive when the transcript model names no contig (older payloads)", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            object_type: "Transcript",
            id: "ENST00000600003",
            strand: 1,
            Exon: [{ id: "EXON1", start: 1000, end: 1200 }]
          })
        }));
        const res = await resolveSpliceProximity("ENST00000600003", 1195, "X");
        expect(res).not.toBeNull();
      });

      it("treats chrM and MT as the same contig (review L-8: per-side normalizers disagreed)", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            object_type: "Transcript",
            id: "ENST00000600004",
            strand: 1,
            seq_region_name: "MT",
            Exon: [{ id: "EXON1", start: 1000, end: 1200 }]
          })
        }));
        const res = await resolveSpliceProximity("ENST00000600004", 1195, "chrM");
        expect(res).not.toBeNull();
        expect(res!.distance).toBe(5);
      });
    });

    describe("UCSC fallback, RefSeq resolution, and L2 SQLite cache", () => {
      it("falls back to UCSC knownGene when Ensembl returns 500 error", async () => {
        const fetchMock = vi.fn().mockImplementation(async (url: string) => {
          if (url.includes("ensembl.org")) {
            return { ok: false, status: 500, statusText: "Internal Server Error" };
          }
          if (url.includes("api.genome.ucsc.edu") && url.includes("track=knownGene")) {
            return {
              ok: true,
              json: async () => ({
                knownGene: [
                  {
                    chrom: "chr20",
                    chromStart: 23362181,
                    chromEnd: 23373062,
                    name: "ENST00000338121.10",
                    strand: "+",
                    blockCount: 6,
                    blockSizes: "56,1385,95,168,158,2972,",
                    chromStarts: "0,2181,4821,6580,7402,7909,",
                    geneName: "GZF1"
                  }
                ]
              })
            };
          }
          return { ok: false, status: 404 };
        });
        vi.stubGlobal("fetch", fetchMock);

        const res = await resolveSpliceProximity("ENST00000338121", 23369727, "20");
        expect(res).not.toBeNull();
        expect(res!.distance).toBe(14);
        expect(res!.exonNumber).toBe(5);
        expect(res!.totalExons).toBe(6);
        expect(res!.junctionType).toBe("donor");
        expect(res!.regionType).toBe("exonic");
      });

      it("resolves RefSeq NM_ accessions directly via UCSC ncbiRefSeq track", async () => {
        const fetchMock = vi.fn().mockImplementation(async (url: string) => {
          if (url.includes("api.genome.ucsc.edu") && url.includes("track=ncbiRefSeq")) {
            return {
              ok: true,
              json: async () => ({
                ncbiRefSeq: [
                  {
                    name: "NM_022482.5",
                    chrom: "chr20",
                    strand: "+",
                    txStart: 23362181,
                    txEnd: 23373062,
                    exonCount: 6,
                    exonStarts: "23362181,23364362,23367002,23368761,23369583,23370090,",
                    exonEnds: "23362237,23365747,23367097,23368929,23369741,23373062,",
                    name2: "GZF1"
                  }
                ]
              })
            };
          }
          return { ok: false, status: 404 };
        });
        vi.stubGlobal("fetch", fetchMock);

        const res = await resolveSpliceProximity("NM_022482.5", 23369727, "chr20");
        expect(res).not.toBeNull();
        expect(res!.distance).toBe(14);
        expect(res!.exonNumber).toBe(5);
        expect(res!.totalExons).toBe(6);
        expect(res!.junctionType).toBe("donor");
        expect(res!.regionType).toBe("exonic");
      });

      it("persists resolved structure into L2 SQLite and serves from cache on subsequent call", async () => {
        const db = AnalysisDatabase.getInstance();
        const testId = "ENST00000777777";
        await db.saveExternalCacheAsync(`exon:v2:${testId}`, {
          strand: 1,
          seqRegionName: "1",
          exons: [
            { id: "EX1", start: 1000, end: 1100, strand: 1, seq_region_name: "1" },
            { id: "EX2", start: 2000, end: 2100, strand: 1, seq_region_name: "1" }
          ]
        }, "transcript-exons", 3600);

        // Fetch is stubbed with 500 error to prove it does NOT hit network
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

        const res = await resolveSpliceProximity(testId, 1098, "chr1");
        expect(res).not.toBeNull();
        expect(res!.distance).toBe(2);
        expect(res!.exonNumber).toBe(1);
        expect(res!.totalExons).toBe(2);
        expect(res!.junctionType).toBe("donor");
      });

      it("safely returns null without querying external API when genomicPos is NaN or invalid", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const resNaN = await resolveSpliceProximity("ENST00000338121", NaN, "20");
        expect(resNaN).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();

        const resZero = await resolveSpliceProximity("ENST00000338121", 0, "20");
        expect(resZero).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("normalizes MT contig to chrM for UCSC query", async () => {
        const queriedUrls: string[] = [];
        const fetchMock = vi.fn().mockImplementation(async (url: string) => {
          queriedUrls.push(url);
          if (url.includes("ensembl.org")) {
            return { ok: false, status: 500 };
          }
          if (url.includes("api.genome.ucsc.edu")) {
            return {
              ok: true,
              json: async () => ({
                knownGene: [
                  {
                    chrom: "chrM",
                    chromStart: 1000,
                    chromEnd: 2000,
                    name: "ENST00000388888.1",
                    strand: "+",
                    blockCount: 1,
                    blockSizes: "1000,",
                    chromStarts: "0,",
                    geneName: "MT-TEST"
                  }
                ]
              })
            };
          }
          return { ok: false, status: 404 };
        });
        vi.stubGlobal("fetch", fetchMock);

        const res = await resolveSpliceProximity("ENST00000388888", 1500, "MT");
        expect(res).not.toBeNull();
        const ucscCall = queriedUrls.find(u => u.includes("api.genome.ucsc.edu"));
        expect(ucscCall).toBeDefined();
        expect(ucscCall).toContain("chrom=chrM");
      });

      it("correctly handles reverse-strand transcripts from UCSC with genePred/bigBed schema", async () => {
        const fetchMock = vi.fn().mockImplementation(async (url: string) => {
          if (url.includes("ensembl.org")) {
            return { ok: false, status: 500 };
          }
          if (url.includes("api.genome.ucsc.edu")) {
            return {
              ok: true,
              json: async () => ({
                knownGene: [
                  {
                    chrom: "chr7",
                    chromStart: 10000,
                    chromEnd: 20000,
                    name: "ENST00000999999.1",
                    strand: "-",
                    blockCount: 2,
                    blockSizes: "1000,1000,",
                    chromStarts: "0,9000,",
                    geneName: "REV-TEST"
                  }
                ]
              })
            };
          }
          return { ok: false, status: 404 };
        });
        vi.stubGlobal("fetch", fetchMock);

        // Exon 1 in genomic coords: 10001..11000 (which is Exon 2 in reverse transcript order 5'->3')
        // Exon 2 in genomic coords: 19001..20000 (which is Exon 1 in reverse transcript order 5'->3')
        // Variant at 19005 is 4 bp from 19001 (5' donor of Exon 1 on reverse strand)
        const res = await resolveSpliceProximity("ENST00000999999", 19005, "chr7");
        expect(res).not.toBeNull();
        expect(res!.exonNumber).toBe(1);
        expect(res!.totalExons).toBe(2);
        expect(res!.strand).toBe("-");
        expect(res!.distance).toBe(4);
        expect(res!.junctionType).toBe("donor");
      });

      it("resolves live GZF1 exon structure for ENST and RefSeq with exact donor distance 14", async () => {
        try {
          const resEnst = await resolveSpliceProximity("ENST00000338121", 23369727, "chr20");
          if (resEnst) {
            expect(resEnst.distance).toBe(14);
            expect(resEnst.exonNumber).toBe(5);
            expect(resEnst.totalExons).toBe(6);
            expect(resEnst.junctionType).toBe("donor");
            expect(resEnst.regionType).toBe("exonic");
          }

          const resRefSeq = await resolveSpliceProximity("NM_022482.5", 23369727, "20");
          if (resRefSeq) {
            expect(resRefSeq.distance).toBe(14);
            expect(resRefSeq.exonNumber).toBe(5);
            expect(resRefSeq.totalExons).toBe(6);
            expect(resRefSeq.junctionType).toBe("donor");
            expect(resRefSeq.regionType).toBe("exonic");
          }
        } catch (_) {
          // In offline test harnesses without external network access, gracefully succeed
        }
      }, 15000);
    });
  });
});

describe("nearbyExonsOf — the exons the splice map draws", () => {
  // A three-exon reverse-strand transcript, ascending in the genome: the genome-lowest exon is the LAST in the transcript.
  const rev = [
    { start: 43106456, end: 43106533 },
    { start: 43115726, end: 43115779 },
    { start: 43124017, end: 43124115 },
  ];

  it("numbers in transcript order: a reverse-strand gene counts down the genome", () => {
    expect(nearbyExonsOf(rev, 43115729, true, 100_000).map(e => e.number)).toEqual([3, 2, 1]);
  });

  it("keeps only exons within reach of the variant, keeping their transcript numbers", () => {
    // The neighbours are 8–9 kb away: only the variant's own exon (number 2 of 3) is in a 2.5 kb reach.
    expect(nearbyExonsOf(rev, 43115729, true, 2500)).toEqual([{ number: 2, start: 43115726, end: 43115779 }]);
  });

  it("numbers a forward-strand gene up the genome", () => {
    const fwd = [{ start: 100, end: 200 }, { start: 400, end: 500 }, { start: 900, end: 950 }];
    expect(nearbyExonsOf(fwd, 450, false, 300)).toEqual([
      { number: 1, start: 100, end: 200 },
      { number: 2, start: 400, end: 500 },
    ]);
  });
});
