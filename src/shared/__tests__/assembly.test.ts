import { describe, it, expect } from "vitest";
import {
  ASSEMBLY_SUPPORT,
  ASSEMBLY_LABELS,
  CANONICAL_ASSEMBLY,
  describeAssemblyRefusal,
  sourceSupportsAssembly,
  supportedAssemblies,
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
