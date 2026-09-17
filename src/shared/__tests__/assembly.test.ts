import { describe, it, expect } from "vitest";
import {
  ASSEMBLY_SUPPORT,
  ASSEMBLY_LABELS,
  CANONICAL_ASSEMBLY,
  canUseCoordinateForSource,
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

describe("canUseCoordinateForSource — the refusal rules", () => {
  it("allows a native-build coordinate for a build-aware source", () => {
    expect(canUseCoordinateForSource("spliceai-lookup", { assembly: "GRCh37" })).toBe(true);
    expect(canUseCoordinateForSource("ensembl-vep", { assembly: "GRCh37" })).toBe(true);
  });

  it("refuses another build's coordinate for a pinned source", () => {
    // The whole point: GPN-Star is a GRCh38-only index, so a GRCh37 position must never
    // reach it — a silent miss is bad, a coincidental hit is worse.
    expect(canUseCoordinateForSource("gpn-star", { assembly: "GRCh37" })).toBe(false);
    expect(canUseCoordinateForSource("dbnsfp-local", { assembly: "GRCh37" })).toBe(false);
    expect(canUseCoordinateForSource("genos", { assembly: "GRCh37" })).toBe(false);
  });

  it("refuses a foreign-build coordinate, since a pinned source cannot serve it at all", () => {
    // GPN-Star is a GRCh38-only index: a GRCh37 position must never reach it — a silent miss
    // is bad, a coincidental hit is worse. There is no flag that makes this acceptable, which
    // is the point: a bad lift is discarded by the lift step, not marked and passed along.
    expect(canUseCoordinateForSource("gpn-star", { assembly: "GRCh37" })).toBe(false);
    expect(canUseCoordinateForSource("dbnsfp-local", { assembly: "GRCh37" })).toBe(false);
  });

  it("accepts a lifted coordinate, because a lift lands on the canonical build", () => {
    // By the time a lift is used it is modelled as a canonical-build coordinate, so a
    // canonical-build source accepts it with no special case in the gate.
    const lifted: LiftedCoordinate = {
      chrom: "7", pos: 140753336, ref: "T", alt: "A",
      assembly: CANONICAL_ASSEMBLY,
      originalAssembly: "GRCh37",
      original: { chrom: "7", pos: 140453136 },
      reverseVerified: true
    };
    expect(canUseCoordinateForSource("gpn-star", lifted)).toBe(true);
    expect(canUseCoordinateForSource("alphagenome", lifted)).toBe(true);
  });

  it("refuses when there is no coordinate at all", () => {
    expect(canUseCoordinateForSource("gpn-star", null)).toBe(false);
    expect(canUseCoordinateForSource("gpn-star", undefined)).toBe(false);
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
