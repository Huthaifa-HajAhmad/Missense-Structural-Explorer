/**
 * The splicing tab's reference variant, NAE1 p.Asp116Gly (NM_003905.4, MANE Select), as the
 * user's screenshots of 2026-09-28 showed it.
 *
 * What the payload carried: junction geometry (exon 6 of 20, 80 bp, exonic, 25 bp from the
 * acceptor, reverse strand); NO SpliceAI score and NO dbscSNV score; AlphaGenome refusing the
 * coordinate with a reference-base mismatch (the coordinate string carried the coding-strand
 * alleles of a reverse-strand gene); REVEL 0.231, AlphaMissense 0.362, FoldX 2.62 kcal/mol.
 *
 * Exon bounds were not on screen and are left null rather than invented.
 */
export function nae1Reference(overrides: Record<string, any> = {}): any {
  const base: any = {
    metadata: {
      gene: "NAE1",
      variant: "p.Asp116Gly",
      wildType: "Asp",
      mutant: "Gly",
      residueIndex: 116,
      uniprotId: "Q13564",
      assembly: "GRCh38",
      genomicCoordinates: "16-66823281-A-G",
    },
    maneRefSeqId: "NM_003905.4",
    transcriptId: null,
    predictorData: { amPathogenicity: 0.362, amClass: "ambiguous" },
    foldingEnergetics: { foldx: 2.62 },
    conservationData: {
      revel: 0.231,
      spliceProximity: {
        distance: 25,
        isNearSpliceSite: false,
        isCanonicalJunction: true,
        exonNumber: 6,
        totalExons: 20,
        exonLength: 80,
        exonStart: null,
        exonEnd: null,
        intronNumber: null,
        adjacentIntronNumber: 5,
        junctionType: "acceptor",
        regionType: "exonic",
        strand: "-",
        transcriptId: null,
      },
      spliceai: null,
      dbscsnv: null,
      alphagenome: {
        status: "unavailable",
        message:
          "AlphaGenome gRPC error [code 3]: Variant: chr16:66823281:A>G reference base does not match the expected reference base: T.",
        featureAttributions: null,
        topModality: null,
      },
    },
  };
  return deepMerge(base, overrides);
}

function deepMerge(a: any, b: any): any {
  if (b === null || typeof b !== "object" || Array.isArray(b)) return b;
  const out: any = { ...(a ?? {}) };
  for (const k of Object.keys(b)) {
    out[k] = a && typeof a[k] === "object" && a[k] !== null && !Array.isArray(a[k]) && b[k] !== null && typeof b[k] === "object" && !Array.isArray(b[k])
      ? deepMerge(a[k], b[k])
      : b[k];
  }
  return out;
}
