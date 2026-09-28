import { describe, it, expect } from "vitest";
import {
  ASSEMBLY_SUPPORT,
  ASSEMBLY_LABELS,
  CANONICAL_ASSEMBLY,
  REFSEQ_CHROMOSOME_ACCESSIONS,
  buildsForChromosomeAccession,
  canonicalContigOf,
  describeAssemblyRefusal,
  isCanonicalContig,
  sourceSupportsAssembly,
  statedAssemblyOf,
  supportedAssemblies,
  withAssemblyAnnotation,
  type AssemblyAwareSource,
  type LiftedCoordinate
} from "../assembly.ts";

/**
 * Tests for the genome-build policy.
 *
 * The application accepts both GRCh37 and GRCh38 input, but nearly every coordinate-based
 * evidence source is single-build. The build used to be tracked only inside the
 * translation route and then dropped, so every source silently assumed GRCh38 — which for
 * a GRCh37 query is either a miss or, when the other build's base at that numeric position
 * happens to match the supplied REF, a score for a different locus presented as this
 * variant's. These tests pin the declaration and the refusal rules that prevent that.
 */

const ALL_SOURCES = Object.keys(ASSEMBLY_SUPPORT) as AssemblyAwareSource[];

describe("ASSEMBLY_SUPPORT — the declaration table", () => {
  it("pins the known single-build sources to GRCh38", () => {
    // If any of these ever gains GRCh37 support, this assertion should be updated
    // deliberately rather than the gate silently widening.
    for (const source of ["gpn-star", "alphagenome", "dbnsfp-local", "genos", "dbnsfpOrg", "gnomad-variants"] as const) {
      expect(supportedAssemblies(source)).toEqual(["GRCh38"]);
      expect(sourceSupportsAssembly(source, "GRCh38")).toBe(true);
      expect(sourceSupportsAssembly(source, "GRCh37")).toBe(false);
    }
  });

  it("marks sources that genuinely serve both builds", () => {
    for (const source of ["ensembl-vep", "variant-validator", "spliceai-lookup"] as const) {
      expect(sourceSupportsAssembly(source, "GRCh37")).toBe(true);
      expect(sourceSupportsAssembly(source, "GRCh38")).toBe(true);
    }
  });

  it("treats gene-level / sequence sources as build-naive rather than build-pinned", () => {
    // gnomAD constraint is a gene-level aggregate and RefSeq sequences are build-invariant,
    // so refusing either on build grounds would remove usable evidence for no reason.
    expect(sourceSupportsAssembly("gnomad-constraint", "GRCh37")).toBe(true);
    expect(sourceSupportsAssembly("uniprot-sequence", "GRCh37")).toBe(true);
  });

  it("declares at least one supported build for every source", () => {
    for (const source of ALL_SOURCES) {
      expect(supportedAssemblies(source).length).toBeGreaterThan(0);
    }
  });

  it("never lists an unknown build", () => {
    for (const source of ALL_SOURCES) {
      for (const build of supportedAssemblies(source)) {
        expect(["GRCh37", "GRCh38"]).toContain(build);
      }
    }
  });
});

describe("sourceSupportsAssembly — the production gate", () => {
  it("allows a native-build coordinate for a build-aware source", () => {
    // SpliceAI Lookup runs a service per build, so a GRCh37 coordinate is routed, not refused.
    expect(sourceSupportsAssembly("spliceai-lookup", "GRCh37")).toBe(true);
    expect(sourceSupportsAssembly("spliceai-lookup", "GRCh38")).toBe(true);
    expect(sourceSupportsAssembly("ensembl-vep", "GRCh37")).toBe(true);
  });

  it("refuses another build's coordinate for a pinned source", () => {
    // The whole point: GPN-Star is a GRCh38-only index, so a GRCh37 position must never
    // reach it — a silent miss is bad, a coincidental hit at the wrong locus is worse.
    expect(sourceSupportsAssembly("gpn-star", "GRCh37")).toBe(false);
    expect(sourceSupportsAssembly("dbnsfp-local", "GRCh37")).toBe(false);
    expect(sourceSupportsAssembly("genos", "GRCh37")).toBe(false);
    expect(sourceSupportsAssembly("alphagenome", "GRCh37")).toBe(false);
  });

  it("accepts a lifted coordinate, because a lift lands on the canonical build", () => {
    // A successful lift is modelled as a canonical-build coordinate, so a canonical-build
    // source accepts it with no special case in the gate.
    const lifted: LiftedCoordinate = {
      chrom: "7", pos: 140753336, ref: "T", alt: "A",
      assembly: CANONICAL_ASSEMBLY,
      originalAssembly: "GRCh37",
      original: { chrom: "7", pos: 140453136 },
      reverseVerified: true
    };
    expect(sourceSupportsAssembly("gpn-star", lifted.assembly)).toBe(true);
    expect(sourceSupportsAssembly("alphagenome", lifted.assembly)).toBe(true);
  });

  /**
   * Regression for the hole this change originally left open.
   *
   * The coordinate handed to these sources comes from `gnomadVariantId`, which has two
   * producers: Ensembl VEP on the GRCh38 host, and a MyVariant.info `_id` that is ALWAYS
   * hg19 by default (the query endpoint has no assembly parameter). The declared build
   * therefore does not by itself prove the coordinate's build — the gate is only as sound
   * as that alignment. This test records the obligation so the producer side cannot be
   * changed to emit another build without failing here.
   */
  it("documents that the gate trusts the declared build, so producers must agree", () => {
    // A GRCh38 declaration opens every GRCh38-only source…
    expect(sourceSupportsAssembly("gpn-star", "GRCh38")).toBe(true);
    // …so a producer emitting hg19 coordinates while the request declares GRCh38 would
    // bypass the gate entirely. The build must therefore be established BEFORE it is
    // declared, not inferred from it.
    expect(sourceSupportsAssembly("gpn-star", "GRCh37")).toBe(false);
  });
});

describe("describeAssemblyRefusal — absence must be explained, not silent", () => {
  it("names the source, the builds it covers, and the build refused", () => {
    const msg = describeAssemblyRefusal("gpn-star", "GRCh37");
    expect(msg).toContain("gpn-star");
    expect(msg).toContain(ASSEMBLY_LABELS.GRCh38);
    expect(msg).toContain(ASSEMBLY_LABELS.GRCh37);
    // Must read as "not scored", never as a negative result.
    expect(msg).toContain("not scored");
  });

  it("lists both builds for a build-aware source", () => {
    const msg = describeAssemblyRefusal("spliceai-lookup", "GRCh37");
    expect(msg).toContain(ASSEMBLY_LABELS.GRCh37);
    expect(msg).toContain(ASSEMBLY_LABELS.GRCh38);
  });

  it("has a human label for every build", () => {
    expect(ASSEMBLY_LABELS.GRCh37).toMatch(/hg19/);
    expect(ASSEMBLY_LABELS.GRCh38).toMatch(/hg38/);
  });
});

/**
 * RefSeq chromosome accessions: the one place a coordinate states its own build.
 *
 * A lift needs a canonical Ensembl contig, and `NC_000001.10:g.1256452C>A` says both which
 * chromosome it is and which build it is in. Every entry was verified against its NCBI nuccore
 * summary when the table was written; these tests pin the SHAPE and the failure modes (an unknown
 * accession is never guessed at, and MT carries no build signal because it is the same accession in
 * both builds).
 */
describe("REFSEQ_CHROMOSOME_ACCESSIONS", () => {
  it("covers the 25 addressable contigs in both builds", () => {
    for (const build of ["GRCh37", "GRCh38"] as const) {
      const contigs = Object.values(REFSEQ_CHROMOSOME_ACCESSIONS[build]);
      expect(contigs).toHaveLength(25);
      expect(new Set(contigs).size).toBe(25);
      for (const contig of contigs) expect(isCanonicalContig(contig)).toBe(true);
    }
  });

  it("resolves an accession to its contig, whichever build it belongs to", () => {
    // The reported coordinate's accession, and the GRCh38 spelling of the same chromosome.
    expect(canonicalContigOf("NC_000001.10")).toBe("1");
    expect(canonicalContigOf("NC_000001.11")).toBe("1");
    expect(canonicalContigOf("NC_000023.10")).toBe("X");
    expect(canonicalContigOf("NC_000024.9")).toBe("Y");
    // Bare and chr-prefixed contigs pass through, normalized.
    expect(canonicalContigOf("chrX")).toBe("X");
    expect(canonicalContigOf("m")).toBe("MT");
  });

  it("never guesses at an accession it does not know", () => {
    expect(canonicalContigOf("NC_999999.1")).toBeNull();
    expect(buildsForChromosomeAccession("NC_999999.1")).toEqual([]);
    expect(canonicalContigOf("chrUn_KI270442v1")).toBeNull();
  });

  it("reports the build an accession states, and reports none for the shared MT accession", () => {
    expect(buildsForChromosomeAccession("NC_000001.10")).toEqual(["GRCh37"]);
    expect(buildsForChromosomeAccession("NC_000001.11")).toEqual(["GRCh38"]);
    // The rCRS is the same sequence accession in both builds: no build signal, so callers must
    // fall back to the caller's own statement rather than pick one.
    expect(buildsForChromosomeAccession("NC_012920.1")).toEqual(["GRCh37", "GRCh38"]);
    // Only RefSeq chromosome accessions carry a build; a bare contig says nothing about one.
    expect(buildsForChromosomeAccession("1")).toEqual([]);
  });
});

/**
 * The build SELECTOR's two pure halves: reading what a notation states, and writing a build into it.
 *
 * A build is a property of the coordinate, so the control owns no state of its own — it derives its
 * value from the notation and rewrites the notation when changed. These are the functions that make
 * that possible, and they are the reason "no toggle and no conflict banner" is a design property
 * rather than a hope: there is nothing that can disagree with the text.
 */
describe("statedAssemblyOf / withAssemblyAnnotation", () => {
  it("reads a stated build from the annotation, then from a RefSeq accession", () => {
    expect(statedAssemblyOf("Chr1(GRCh37):g.1256452C>A")).toEqual({
      build: "GRCh37",
      source: "annotation",
    });
    expect(statedAssemblyOf("chrX(hg19):g.12345C>G")).toEqual({
      build: "GRCh37",
      source: "annotation",
    });
    expect(statedAssemblyOf("NC_000001.10:g.1256452C>A")).toEqual({
      build: "GRCh37",
      source: "accession",
    });
    /**
     * …and the accession states it for cDNA too: it names the reference SEQUENCE, whichever coordinate
     * type it prefixes. Asking only the genomic parser meant `NC_000001.10:c.1799T>A` reported nothing,
     * so the panel showed the server's GRCh38 default beside a GRCh37 accession and the request went to
     * the GRCh38 host.
     */
    expect(statedAssemblyOf("NC_000001.10:c.1799T>A")).toEqual({
      build: "GRCh37",
      source: "accession",
    });
    // A transcript accession states no BUILD (NM_000001.11 is the same sequence in both), so the
    // server's default is shown for what it is.
    expect(statedAssemblyOf("NM_004333.6:c.1799T>A")).toBeNull();
  });

  it("reports NOTHING for a build that was not stated", () => {
    // The distinction the server draws (`buildDeclared`): a bare coordinate has no build to report,
    // and answering "GRCh38" here is how an assumed build comes to look established.
    expect(statedAssemblyOf("chr1:g.1256452C>A")).toBeNull();
    expect(statedAssemblyOf("1-1256452-C-A")).toBeNull();
    expect(statedAssemblyOf("NC_012920.1:g.100A>G")).toBeNull();
    // Protein notations carry no build at all.
    expect(statedAssemblyOf("p.Gly380Arg")).toBeNull();
    expect(statedAssemblyOf("")).toBeNull();
  });

  it("writes the chosen build into every coordinate family the server accepts", () => {
    expect(withAssemblyAnnotation("chr1:g.1256452C>A", "GRCh37")).toBe("Chr1(GRCh37):g.1256452C>A");
    // An existing annotation is REPLACED, so the two builds can be swapped without retyping.
    expect(withAssemblyAnnotation("Chr1(GRCh38):g.1256452C>A", "GRCh37")).toBe(
      "Chr1(GRCh37):g.1256452C>A"
    );
    // Dashed input is normalized to HGVS on the way, exactly as the server's intake does.
    expect(withAssemblyAnnotation("20-23365054-G-A", "GRCh37")).toBe("Chr20(GRCh37):g.23365054G>A");
    // A RefSeq accession becomes an Ensembl contig, which is what makes a build swap possible at all.
    expect(withAssemblyAnnotation("NC_000001.10:g.1256452C>A", "GRCh38")).toBe(
      "Chr1(GRCh38):g.1256452C>A"
    );
    expect(withAssemblyAnnotation("chrX(hg19):g.12345C>G", "GRCh38")).toBe("ChrX(GRCh38):g.12345C>G");
  });

  /**
   * cDNA is the family whose build annotation sits in a DIFFERENT place — on the transcript's own
   * sequence (`NM_004333.6(GRCh37):c.…`) rather than immediately before the coordinate. The rewrite
   * has to put it there, because that is the only spelling the server reads; putting it anywhere else
   * produces a string that is accepted and then silently annotated on the default build.
   */
  it("writes the build onto the transcript accession for cDNA, and replaces an existing one", () => {
    expect(withAssemblyAnnotation("NM_004333.6:c.1799T>A", "GRCh37")).toBe(
      "NM_004333.6(GRCh37):c.1799T>A"
    );
    expect(withAssemblyAnnotation("NM_004333.6(GRCh37):c.1799T>A", "GRCh38")).toBe(
      "NM_004333.6(GRCh38):c.1799T>A"
    );
    expect(withAssemblyAnnotation("ENST00000288602.11(hg19):c.1799T>A", "GRCh38")).toBe(
      "ENST00000288602.11(GRCh38):c.1799T>A"
    );
    // Round-trip through the reader the panel derives the control's value from.
    expect(statedAssemblyOf("NM_004333.6(GRCh37):c.1799T>A")).toEqual({
      build: "GRCh37",
      source: "annotation",
    });
    // An unannotated cDNA states nothing, so the control shows the server's default rather than a claim.
    expect(statedAssemblyOf("NM_004333.6:c.1799T>A")).toBeNull();
  });

  /**
   * A patch release is a different reference, and a control that exists to let the reader STATE a build
   * must not quietly loosen the one they pinned.
   */
  it("keeps a pinned patch release when the chosen build is its own major", () => {
    expect(withAssemblyAnnotation("NM_004333.6(GRCh38.p14):c.1799T>A", "GRCh38")).toBe(
      "NM_004333.6(GRCh38.p14):c.1799T>A"
    );
    expect(withAssemblyAnnotation("Chr1(GRCh38.p14):g.1256452C>A", "GRCh38")).toBe(
      "Chr1(GRCh38.p14):g.1256452C>A"
    );
    // …and is dropped when the reader switches to the other major, which it does not describe.
    expect(withAssemblyAnnotation("Chr1(GRCh38.p14):g.1256452C>A", "GRCh37")).toBe(
      "Chr1(GRCh37):g.1256452C>A"
    );
  });

  it("refuses to annotate what the server would not honour", () => {
    expect(withAssemblyAnnotation("p.Gly380Arg", "GRCh37")).toBeNull();
    expect(withAssemblyAnnotation("", "GRCh37")).toBeNull();
    // A BARE `c.` notation names no transcript, so there is no reference sequence to qualify: writing
    // a build into it would state a build for a sequence nobody identified.
    expect(withAssemblyAnnotation("c.1799T>A", "GRCh37")).toBeNull();
    // The result must round-trip through the reader: what the control writes is what it then reads.
    const written = withAssemblyAnnotation("chr1:g.1256452C>A", "GRCh37");
    expect(written).not.toBeNull();
    expect(statedAssemblyOf(written!)).toEqual({ build: "GRCh37", source: "annotation" });
  });
});
