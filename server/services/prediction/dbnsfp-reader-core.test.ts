import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { computeGeneNumbering, denseRowidSpan, readLandscapeRows, NUMBERING_GROUPS_SQL, deriveGeneNumbering } from "./dbnsfp-reader-core.ts";
import { aggregateLandscape } from "./landscape-aggregate.ts";

/**
 * A minus-strand gene: rows are ingested in genomic order, so rowid order is the REVERSE of residue
 * order. Residue 10 has two SNVs that make the same substitution (Arg→Gln) with different AlphaMissense
 * scores; `aggregateLandscape` keeps the first one it meets, so a rowid-order read that was not put back
 * into index order would change the aggregate.
 */
function minusStrandStore(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE variant_scores (gene TEXT NOT NULL, chr TEXT, pos_genomic INTEGER, transcript TEXT, aaref TEXT, aaalt TEXT,
    pos INTEGER NOT NULL, ref TEXT, alt TEXT, aa_change TEXT, revel REAL, alphamissense REAL, gerp REAL, phylop REAL, transcript_basis TEXT);
    CREATE INDEX idx_gene_pos ON variant_scores (gene, pos);
    CREATE INDEX idx_variant_scores_gene_pos_ref_alt ON variant_scores (gene, pos, ref, alt);`);
  const ins = db.prepare(`INSERT INTO variant_scores (gene, chr, pos_genomic, transcript, aaref, aaalt, pos, ref, alt, aa_change, revel, alphamissense, gerp, phylop, transcript_basis)
    VALUES (?, '2', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1.0, 2.0, ?)`);
  // genomic ascending == residue descending
  const rows: Array<[number, string, string, number, string, string, string, number, number, string]> = [
    [1000, "ENST1", "R", 12, "C", "T", "p.Arg12Trp", 0.4, 0.70, "mane"],
    [1001, "ENST1", "R", 12, "G", "A", "p.Arg12Gln", 0.3, 0.60, "mane"],
    [1003, "ENST1", "R", 10, "G", "A", "p.Arg10Gln", 0.2, 0.95, "mane"], // same substitution as the next row,
    [1004, "ENST1", "R", 10, "C", "A", "p.Arg10Gln", 0.1, 0.15, "mane"], // different SNV and score
    [1006, "ENST9", "R", 10, "C", "T", "p.Arg10Trp", 0.9, 0.99, "single"], // another isoform: filtered out
    [1009, "ENST1", "K", 7, "A", "G", "p.Lys7Arg", 0.5, 0.50, "mane"],
  ];
  for (const [g, tx, wt, pos, ref, alt, ch, revel, am, basis] of rows) {
    ins.run("MINUS", g, tx, wt, ch.slice(-3) === "Gln" ? "Q" : ch.slice(-3) === "Trp" ? "W" : "R", pos, ref, alt, ch, revel, am, basis);
  }
  return db;
}

describe("dbnsfp-reader-core: a whole-gene read through the rowid range", () => {
  it("is taken for a densely stored gene", () => {
    const db = minusStrandStore();
    expect(denseRowidSpan(db, "MINUS")).toEqual({ lo: 1, hi: 6, rows: 6 });
    expect(denseRowidSpan(db, "ABSENT")).toBeNull();
  });

  it("returns the same numbering as the index GROUP BY", () => {
    const db = minusStrandStore();
    const viaIndex = deriveGeneNumbering(db.prepare(NUMBERING_GROUPS_SQL).all("MINUS") as any);
    expect(computeGeneNumbering(db, "MINUS")).toEqual(viaIndex);
    expect(viaIndex).toEqual({ transcript: "ENST1", basis: "mane" });
  });

  it("returns the same rows, in the same order, and the same aggregate as the index read", () => {
    const db = minusStrandStore();
    const policy = () => null;
    const numbering = computeGeneNumbering(db, "MINUS");
    const viaRange = readLandscapeRows(db, "MINUS", undefined, undefined, numbering, policy, "auto")!;
    const viaIndex = readLandscapeRows(db, "MINUS", undefined, undefined, numbering, policy, "index")!;
    expect(viaRange).toEqual(viaIndex);
    expect(viaRange.candidates.map(c => c.readings[0].pos)).toEqual([7, 10, 10, 12, 12]);
    const opts = { start: 1, end: viaRange.maxPos, sequence: null, choice: { transcript: viaRange.transcript, basis: viaRange.transcriptBasis } };
    const agg = aggregateLandscape(viaRange.candidates, opts);
    expect(agg).toEqual(aggregateLandscape(viaIndex.candidates, opts));
    // Index order puts ref C before G at residue 10, so the C>A SNV's score is the one kept.
    expect(agg.positions.find(p => p.residx === 10)?.substitutions?.find(s => s.alt === "Q")?.am).toBe(0.15);
  });

  it("derives the numbering from the range read itself when none is known, identically", () => {
    const db = minusStrandStore();
    const derived = readLandscapeRows(db, "MINUS", undefined, undefined, null, () => null)!;
    expect(derived.numbering).toEqual(computeGeneNumbering(db, "MINUS"));
  });
});
