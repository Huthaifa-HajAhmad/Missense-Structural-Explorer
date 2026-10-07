import { describe, it, expect, vi } from "vitest";

// Isolate the post-fetch statistics from the network-bound modules.
vi.mock("./dbnsfp_local.ts", () => ({
  isLocalDbnsfpAvailable: vi.fn(() => false),
  queryLocalDbnsfpVariant: vi.fn(async () => null),
  queryLocalDbnsfpLandscapeRows: vi.fn(async () => null),
  readLocalDbnsfpVersion: vi.fn(() => null)
}));
vi.mock("../external-api/uniprot.ts", () => ({
  resolveGeneToUniprot: vi.fn(async () => "P00439"),
  // Residue 5 is D.
  fetchUniprotSequence: vi.fn(async () => "MKVLDVGLGNCGVFSLLDKN")
}));

import { fetchLandscape } from "./landscape.ts";
import {
  aggregateLandscape,
  candidateFromMyVariantHit,
  selectReferenceTranscript,
  MAX_SNVS_PER_CODON,
  type SnvCandidate
} from "./landscape-aggregate.ts";

const hit = (id: string, over: Record<string, unknown>) => ({ _id: id, dbnsfp: { aa: { ref: "D" }, ...over } });

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("fetchLandscape", () => {
  it("computes mean / min / max / count per residue and averages conservation over nucleotides", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        hits: [
          // Two alts at the same nucleotide: its conservation is counted once.
          hit("chr1:g.100A>G", { aa: { ref: "D", alt: "G", pos: 5 }, revel: { score: 0.2 }, alphamissense: { score: 0.1 }, "gerp++": { rs: 2 }, phylop: { "100way_vertebrate": { score: 1 } } }),
          hit("chr1:g.100A>C", { aa: { ref: "D", alt: "A", pos: 5 }, revel: { score: 0.8 }, alphamissense: { score: 0.9 }, "gerp++": { rs: 2 }, phylop: { "100way_vertebrate": { score: 1 } } }),
          hit("chr1:g.101T>C", { aa: { ref: "D", alt: "V", pos: 5 }, revel: { score: 0.5 }, alphamissense: { score: 0.5 }, "gerp++": { rs: 5 }, phylop: { "100way_vertebrate": { score: 4 } } })
        ]
      })
    );
    fetchSpy.mockResolvedValueOnce(jsonResponse({ src: { dbnsfp: { version: "4.4a" } } }));

    const { positions, meta } = await fetchLandscape("PAH", 5, 5);
    expect(positions).toHaveLength(1);
    const p = positions[0];
    expect(p.revelMean).toBeCloseTo(0.5);
    expect(p.revelMin).toBe(0.2);
    expect(p.revelMax).toBe(0.8);
    expect(p.revelCount).toBe(3);
    expect(p.amCount).toBe(3);
    // Nucleotides 100 (2) and 101 (5), not rows (2, 2, 5).
    expect(p.gerp).toBeCloseTo(3.5);
    expect(p.phylop).toBeCloseTo(2.5);
    expect(p.nucleotideCount).toBe(2);
    expect(p.aaref).toBe("D");
    expect(p.refMismatch).toBe(false);
    expect(meta.source).toBe("myvariant");
    expect(meta.sourceVersion).toBe("dbNSFP 4.4a");
    // "gerp++" must survive the query string: unencoded, '+' decodes to a space.
    expect(String(fetchSpy.mock.calls[0][0])).toContain("dbnsfp.gerp%2B%2B");
    fetchSpy.mockRestore();
  });
});

describe("nucleotide identity", () => {
  // myvariant.info ids carry no "g." separator. The old pattern required `g.<pos><ref>><alt>`, so
  // live myvariant candidates had `nucleotideKey: null` and the same nucleotide's three alt SNVs
  // were counted as three nucleotides in the codon-mean GERP++ / phyloP.
  it("reads the nucleotide out of myvariant's own id shape (chr7:117287507G>A)", () => {
    const a = candidateFromMyVariantHit(hit("chr7:117287507G>A", { aa: { ref: "D", alt: "G", pos: 5 }, "gerp++": { rs: 2 }, phylop: { "100way_vertebrate": { score: 1 } } }))!;
    const b = candidateFromMyVariantHit(hit("chr7:117287507G>C", { aa: { ref: "D", alt: "A", pos: 5 }, "gerp++": { rs: 2 }, phylop: { "100way_vertebrate": { score: 1 } } }))!;
    const c = candidateFromMyVariantHit(hit("chr7:117287508T>C", { aa: { ref: "D", alt: "V", pos: 5 }, "gerp++": { rs: 5 }, phylop: { "100way_vertebrate": { score: 4 } } }))!;
    expect(a.nucleotideKey).toBe("chr7:117287507");
    expect(b.nucleotideKey).toBe("chr7:117287507");
    const { positions } = aggregateLandscape([a, b, c], { start: 5, end: 5, sequence: null, choice: { transcript: null, basis: "unknown" } });
    // Nucleotides 117287507 (2) and 117287508 (5), not the three SNV rows (2, 2, 5).
    expect(positions[0].nucleotideCount).toBe(2);
    expect(positions[0].gerp).toBeCloseTo(3.5);
    expect(positions[0].phylop).toBeCloseTo(2.5);
  });
});

describe("window query", () => {
  it("asks for each residue by exact term, never a range (SOD1 p.Ala5Val lost residues 4-9)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockImplementation(async () => jsonResponse({ hits: [] }));
    await fetchLandscape("SOD1", 1, 45);
    const urls = fetchSpy.mock.calls.map((c) => decodeURIComponent(String(c[0])).replace(/\+/g, " "));
    const queries = urls.filter((u) => u.includes("/v1/query"));
    // 45 residues are split over two requests of at most 40 terms.
    expect(queries).toHaveLength(2);
    for (const q of queries) {
      // myvariant.info indexes aa.pos as text: "[1 TO 31]" excludes "5" because "5" > "31".
      expect(q).not.toMatch(/\[\d+ TO \d+\]/);
    }
    const terms = queries.flatMap((q) => q.match(/dbnsfp\.aa\.pos:\d+/g) ?? []);
    expect(terms).toHaveLength(45);
    expect(terms).toContain("dbnsfp.aa.pos:5");
    expect(terms).toContain("dbnsfp.aa.pos:45");
    fetchSpy.mockRestore();
  });
});

describe("per-transcript aggregation", () => {
  // One SNV listed on three transcripts: MANE residue 116, an isoform residue 98, and a third.
  const multi = candidateFromMyVariantHit(
    hit("chr16:g.66823281T>C", {
      aa: { ref: "D", alt: "G", pos: [116, 98, 116] },
      ensembl: { transcriptid: ["ENST_MANE", "ENST_ISO2", "ENST_ISO3"] },
      mane: ["MANE Select", ".", "."],
      revel: { score: [0.231, 0.4, 0.231] },
      alphamissense: { score: [0.362, 0.5, 0.362] }
    })
  )!;

  it("reads an SNV once, on the MANE transcript, at that transcript's index", () => {
    const choice = selectReferenceTranscript([multi], null);
    expect(choice).toEqual({ transcript: "ENST_MANE", basis: "mane" });
    const { positions } = aggregateLandscape([multi], { start: 90, end: 120, sequence: null, choice });
    const at98 = positions.find((p) => p.residx === 98)!;
    const at116 = positions.find((p) => p.residx === 116)!;
    expect(at98.revelCount).toBe(0);
    expect(at116.revelCount).toBe(1);
    expect(at116.revelMean).toBeCloseTo(0.231);
    expect(at116.amMean).toBeCloseTo(0.362);
    expect(at116.substitutions).toEqual([{ alt: "G", am: 0.362, revel: 0.231 }]);
  });

  it("never counts more SNVs at a residue than a codon admits, however many transcripts list it", () => {
    const candidates: SnvCandidate[] = [];
    const alts = ["G", "N", "E", "V", "A", "H", "Y", "N", "G"]; // 9 SNVs, 7 distinct amino acids
    for (let i = 0; i < 48; i++) {
      // 48 rows: 9 SNVs at MANE residue 116, the rest another isoform's residue 116.
      const own = i < 9;
      candidates.push(
        candidateFromMyVariantHit(
          hit(`chr16:g.${own ? 1000 + Math.floor(i / 3) : 5000 + i}A>${"CGT"[i % 3]}`, {
            aa: { ref: "D", alt: own ? alts[i] : "G", pos: own ? [116, 200] : [300, 116] },
            ensembl: { transcriptid: ["ENST_MANE", "ENST_ISO2"] },
            mane: ["MANE Select", "."],
            revel: { score: [0.3, 0.3] },
            alphamissense: { score: [own ? 0.1 * (i + 1) : 0.99, 0.5] }
          })
        )!
      );
    }
    const choice = selectReferenceTranscript(candidates, null);
    const { positions, qualityFlags } = aggregateLandscape(candidates, { start: 116, end: 116, sequence: null, choice });
    // Summaries are over the 7 distinct substitutions, never over other isoforms' rows.
    expect(positions[0].amCount).toBe(7);
    expect(positions[0].substitutions).toHaveLength(7);
    expect(positions[0].amMax).toBeLessThan(0.99);
    expect(qualityFlags).not.toContain("overcount:116");
  });

  it("weighs a substitution once when two SNVs give the same amino acid", () => {
    const a = candidateFromMyVariantHit(hit("chr1:g.10A>G", { aa: { ref: "D", alt: "G", pos: 5 }, revel: { score: 0.2 }, alphamissense: { score: 0.9 } }))!;
    const b = candidateFromMyVariantHit(hit("chr1:g.11T>C", { aa: { ref: "D", alt: "G", pos: 5 }, revel: { score: 0.4 }, alphamissense: { score: 0.9 } }))!;
    const c = candidateFromMyVariantHit(hit("chr1:g.12A>T", { aa: { ref: "D", alt: "V", pos: 5 }, revel: { score: 0.6 }, alphamissense: { score: 0.1 } }))!;
    const { positions } = aggregateLandscape([a, b, c], { start: 5, end: 5, sequence: null, choice: { transcript: null, basis: "unknown" } });
    expect(positions[0].amCount).toBe(2);
    expect(positions[0].amMean).toBeCloseTo(0.5); // (0.9 + 0.1) / 2, not (0.9 + 0.9 + 0.1) / 3
    expect(positions[0].substitutions).toEqual([
      { alt: "G", am: 0.9, revel: 0.4 },
      { alt: "V", am: 0.1, revel: 0.6 }
    ]);
  });

  it("flags a residue with more SNVs than one codon admits", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      candidateFromMyVariantHit(hit(`chr1:g.${100 + i}A>G`, { aa: { ref: "D", alt: "G", pos: 5 }, revel: { score: 0.3 } }))!
    );
    const { qualityFlags } = aggregateLandscape(many, { start: 5, end: 5, sequence: null, choice: { transcript: null, basis: "unknown" } });
    expect(qualityFlags).toContain("overcount:5");
  });

  it("falls back to agreement with the displayed sequence when dbNSFP carries no transcript flag", () => {
    const seq = "A".repeat(97) + "K" + "A".repeat(17) + "D"; // 98 = K, 116 = D
    const unflagged = candidateFromMyVariantHit(
      hit("chr16:g.1T>C", {
        aa: { ref: "D", alt: "G", pos: [98, 116] },
        ensembl: { transcriptid: ["ENST_ISO2", "ENST_CANON"] },
        revel: { score: [0.1, 0.9] }
      })
    )!;
    const choice = selectReferenceTranscript([unflagged], seq);
    expect(choice).toEqual({ transcript: "ENST_CANON", basis: "sequence-match" });
  });

  it("flags residues whose dbNSFP reference residue disagrees with the displayed sequence", () => {
    const c = candidateFromMyVariantHit(hit("chr1:g.1A>G", { aa: { ref: "W", alt: "R", pos: 5 }, revel: { score: 0.5 } }))!;
    const { positions, qualityFlags } = aggregateLandscape([c], {
      start: 5,
      end: 5,
      sequence: "MKVLDV",
      choice: { transcript: null, basis: "unknown" }
    });
    expect(positions[0].refMismatch).toBe(true);
    expect(qualityFlags).toContain("ref-mismatch:1");
  });

  it("skips synonymous and stop-gain SNVs for scores but keeps their nucleotide's conservation", () => {
    const syn = candidateFromMyVariantHit(hit("chr1:g.1A>G", { aa: { ref: "D", alt: "D", pos: 5 }, revel: { score: 0.9 }, "gerp++": { rs: 4 } }))!;
    const stop = candidateFromMyVariantHit(hit("chr1:g.2A>T", { aa: { ref: "D", alt: "X", pos: 5 }, revel: { score: 0.9 } }))!;
    const { positions } = aggregateLandscape([syn, stop], { start: 5, end: 5, sequence: null, choice: { transcript: null, basis: "unknown" } });
    expect(positions[0].revelCount).toBe(0);
    expect(positions[0].gerp).toBe(4);
  });
});
