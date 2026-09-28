import { describe, it, expect, vi } from "vitest";
import type { LiftedCoordinate } from "../../../src/shared/assembly.ts";
import { isRetryableLiftRefusal } from "../../../src/shared/contracts.ts";
import {
  decideIntakeAssembly,
  INTAKE_LIFT_BUDGET_MS,
  TRANSLATE_TOTAL_BUDGET_MS,
} from "./intake-assembly.ts";
import { DEFAULT_RESOLUTION_BUDGET_MS } from "./coordinate-resolver.ts";

/**
 * The genome-build intake decision.
 *
 * Regression context: a submitted GRCh37 coordinate used to be annotated on Ensembl's frozen GRCh37
 * archive — no MANE Select, no `uniprot_isoform`, retired gene symbols — while every other consumer
 * in the pipeline is pinned to GRCh38. The policy (`src/shared/assembly.ts`) is to lift onto the
 * canonical build with a reverse-verified map, and to keep the coordinate's own build — saying why —
 * when no verified lift exists. These tests pin the DECISION TABLE; the lift's own verification is
 * `liftover.test.ts`'s subject, so it is injected here.
 */

/**
 * A lifter that verifies nothing: the coordinate keeps its build, and the refusal carries the code
 * the real one would report for an assembly map that did not answer.
 */
const noLift = vi.fn(async () => ({ failure: "map-unavailable" } as const));

/** A lifter that "verifies" the real INTS11 locus: chr1:1,256,452 (GRCh37) → chr1:1,321,072 (GRCh38). */
const verifiedLift = vi.fn(
  async (coord: { chrom: string; pos: number; ref: string; alt: string; assembly: string }) => ({
    lifted: {
      chrom: coord.chrom,
      pos: 1321072,
      ref: coord.ref,
      alt: coord.alt,
      assembly: "GRCh38",
      originalAssembly: coord.assembly,
      original: { chrom: coord.chrom, pos: coord.pos },
      reverseVerified: true,
    } as LiftedCoordinate,
  })
);

/** The exact INTS11/CPSF3L case from the bug report. */
const GRCH37_NOTATION = "chr1:g.1256452C>A";
const GRCH38_NOTATION = "chr1:g.1321072C>A";

describe("decideIntakeAssembly", () => {
  it("leaves a canonical-build coordinate alone and spends nothing", async () => {
    const lift = vi.fn();
    const decision = await decideIntakeAssembly({
      notation: GRCH38_NOTATION,
      annotatedAssembly: "GRCh38",
      annotationPresent: false,
    }, { lift: lift as any });

    expect(decision.resolveAssembly).toBe("GRCh38");
    expect(decision.submittedAssembly).toBe("GRCh38");
    expect(decision.notation).toBe(GRCH38_NOTATION);
    expect(decision.coordinateLift).toEqual({
      status: "not-needed",
      fromAssembly: "GRCh38",
      toAssembly: "GRCh38",
      fromCoordinates: "1-1321072-C-A",
      // No annotation and no accession: GRCh38 is the DEFAULT, not a stated build, and the record
      // must not present an assumed build as established.
      buildDeclared: false,
    });
    // No lift is attempted for a coordinate that is already on the canonical build.
    expect(lift).not.toHaveBeenCalled();
    // No note: an unannotated canonical coordinate has nothing to disclose (unchanged behaviour).
    expect(decision.assemblyNote).toBeUndefined();
  });

  it("keeps the historical note wording for an annotated canonical coordinate", async () => {
    const decision = await decideIntakeAssembly({
      notation: GRCH38_NOTATION,
      annotatedAssembly: "GRCh38",
      annotationPresent: true,
    }, { lift: noLift });

    expect(decision.assemblyNote).toBe(
      `Notation annotated "(GRCh38)" — resolved against the GRCh38 reference assembly.`
    );
  });

  it("verifies a GRCh37 coordinate onto GRCh38 and rewrites the queried notation", async () => {
    const decision = await decideIntakeAssembly({
      notation: GRCH37_NOTATION,
      annotatedAssembly: "GRCh37",
      annotationPresent: true,
      deadlineAt: 12345,
    }, { lift: verifiedLift as any });

    expect(decision.resolveAssembly).toBe("GRCh38");
    expect(decision.submittedAssembly).toBe("GRCh37");
    // The lifted coordinate is a REAL spelling for VEP, not the submitted one relabelled.
    expect(decision.notation).toBe(GRCH38_NOTATION);
    expect(decision.coordinateLift).toEqual({
      status: "lifted",
      fromAssembly: "GRCh37",
      toAssembly: "GRCh38",
      fromCoordinates: "1-1256452-C-A",
      toCoordinates: "1-1321072-C-A",
      reverseVerified: true,
      buildDeclared: true,
    });
    expect(decision.submittedCoordinates).toBe("1-1256452-C-A");
    expect(decision.liftedCoordinates).toBe("1-1321072-C-A");
    expect(decision.assemblyNote).toContain("verified");
    expect(decision.assemblyNote).toContain("GRCh38");
    /**
     * The note must never say the annotation came from the SUBMITTED build: that clause used to be
     * composed from a template and then contradicted by the lift sentence appended to it, so a
     * returned, documented disclosure asserted the wrong reference release. Only `toContain`
     * assertions existed, so the false sentence passed.
     */
    expect(decision.assemblyNote).not.toContain("resolved against the GRCh37 reference");
    // The verification is bounded: an unbounded lift could outlive the client's own budget.
    expect(verifiedLift).toHaveBeenCalledWith(
      { chrom: "1", pos: 1256452, ref: "C", alt: "A", assembly: "GRCh37" },
      { deadlineAt: 12345 }
    );
  });

  it("keeps the submitted build and states why when no verified lift exists", async () => {
    const decision = await decideIntakeAssembly({
      notation: GRCH37_NOTATION,
      annotatedAssembly: "GRCh37",
      annotationPresent: true,
    }, { lift: noLift });

    expect(decision.resolveAssembly).toBe("GRCh37");
    expect(decision.notation).toBe(GRCH37_NOTATION);
    expect(decision.coordinateLift.status).toBe("unavailable");
    expect(decision.coordinateLift.reason).toContain("could not be verified");
    // The record may not present an assumed build as established.
    expect(decision.coordinateLift.buildDeclared).toBe(true);
    /**
     * The note must say what a reader needs — that this annotation comes from an older release —
     * WITHOUT naming a provider: it is composed before the ladder runs, so the build-aware
     * VariantValidator fallback may be the one that answers, and "Ensembl's archive" would then be
     * false.
     */
    expect(decision.assemblyNote).toContain("GRCh37");
    expect(decision.assemblyNote).toContain("predates MANE Select");
    expect(decision.assemblyNote).not.toContain("Ensembl");
    // Never coerced: the locus the caller submitted is still what the response describes.
    expect(decision.submittedCoordinates).toBe("1-1256452-C-A");
    expect(decision.liftedCoordinates).toBeUndefined();
  });

  it("reports cDNA and non-substitutions as not-applicable without calling the lifter", async () => {
    const lift = vi.fn();
    for (const notation of ["NM_017871.6:c.50G>T", "chr1:g.1256452delG"]) {
      const decision = await decideIntakeAssembly({
        notation,
        annotatedAssembly: "GRCh37",
        annotationPresent: true,
      }, { lift: lift as any });

      expect(decision.resolveAssembly).toBe("GRCh37");
      expect(decision.coordinateLift.status).toBe("not-applicable");
      expect(decision.coordinateLift.reason).toBeTruthy();
    }
    expect(lift).not.toHaveBeenCalled();
  });

  it("refuses to lift a contig the assembly map cannot address", async () => {
    const lift = vi.fn();
    const decision = await decideIntakeAssembly({
      // A well-formed RefSeq accession that names no human chromosome we know: it PARSES, so the
      // refusal has to come from the contig check rather than from the notation grammar.
      notation: "NC_999999.1:g.100A>G",
      annotatedAssembly: "GRCh37",
      annotationPresent: true,
    }, { lift: lift as any });

    expect(decision.coordinateLift.status).toBe("not-applicable");
    expect(decision.coordinateLift.reason).toContain("NC_999999.1");
    expect(lift).not.toHaveBeenCalled();
  });

  /**
   * A chromosome that does not exist in either build is refused by the NOTATION GATE, not by the
   * lift: `chr23:g.…` used to pass it (the contig pattern allowed `\d{1,2}`), then could neither be
   * lifted nor annotated, and the user got a provider-failure message whose advice — "annotate the
   * build and it will be verified on GRCh38" — could never help.
   */
  it("never sees a chromosome that no reference carries (the gate refuses it first)", async () => {
    const lift = vi.fn();
    const decision = await decideIntakeAssembly({
      notation: "chr23:g.100A>G",
      annotatedAssembly: "GRCh37",
      annotationPresent: true,
    }, { lift: lift as any });

    // The intake is defensive if it ever does: no lift, and a reason that names what is wrong.
    expect(decision.coordinateLift.status).toBe("not-applicable");
    expect(lift).not.toHaveBeenCalled();
  });

  /**
   * A RefSeq chromosome accession names the reference sequence, so it states the build itself.
   * Honouring it is not a guess — and it is the one build signal an hg19 coordinate usually carries
   * when the caller wrote no `(GRCh37)`.
   */
  it("takes the build from a RefSeq accession when no annotation states one", async () => {
    const decision = await decideIntakeAssembly({
      notation: "NC_000001.10:g.1256452C>A",
      annotatedAssembly: "GRCh38",
      annotationPresent: false,
    }, { lift: verifiedLift as any });

    expect(decision.submittedAssembly).toBe("GRCh37");
    expect(decision.resolveAssembly).toBe("GRCh38");
    expect(decision.coordinateLift.status).toBe("lifted");
    expect(decision.assemblyNote).toContain("NC_000001.10");
    expect(decision.assemblyNote).toContain("GRCh37");
  });

  /**
   * …and for a cDNA notation, which is the same rule about the same thing.
   *
   * `NC_000001.10` IS a GRCh37 reference sequence whichever coordinate type follows it. Reading the
   * accession only from the genomic parser left `NC_000001.10:c.1799T>A` on the server's GRCh38
   * default — and skipped the documented "the accession wins over a contradicting annotation" rule, so
   * this cDNA was queried on the wrong host while its own text named a GRCh37 sequence.
   */
  it("takes the build from a RefSeq accession on a cDNA notation, annotation or not", async () => {
    const bare = await decideIntakeAssembly({
      notation: "NC_000001.10:c.1799T>A",
      annotatedAssembly: "GRCh38",
      annotationPresent: false,
    }, { lift: noLift });

    expect(bare.submittedAssembly).toBe("GRCh37");
    expect(bare.resolveAssembly).toBe("GRCh37");
    // cDNA has no genomic locus to lift, stated with the code that says exactly that.
    expect(bare.coordinateLift.status).toBe("not-applicable");
    expect(bare.coordinateLift.reasonCode).toBe("no-genomic-locus");
    // The build IS stated — by the coordinate — so the record may not present it as assumed.
    expect(bare.coordinateLift.buildDeclared).toBe(true);
    expect(bare.assemblyNote).toContain("NC_000001.10");
    expect(bare.assemblyNote).toContain("GRCh37");

    const contradicting = await decideIntakeAssembly({
      notation: "NC_000001.10(GRCh38):c.1799T>A",
      annotatedAssembly: "GRCh38",
      annotationPresent: true,
    }, { lift: noLift });

    expect(contradicting.submittedAssembly).toBe("GRCh37");
    expect(contradicting.assemblyNote).toContain("not used");
  });

  it("lets the accession win over a contradicting annotation, and says so", async () => {
    const decision = await decideIntakeAssembly({
      notation: "NC_000001.10:g.1256452C>A",
      annotatedAssembly: "GRCh38",
      annotationPresent: true,
    }, { lift: verifiedLift as any });

    expect(decision.submittedAssembly).toBe("GRCh37");
    expect(decision.coordinateLift.fromAssembly).toBe("GRCh37");
    expect(decision.assemblyNote).toContain("(GRCh38)");
    expect(decision.assemblyNote).toContain("not used");
  });

  /** MT is the same accession in both builds, so it carries no build signal at all. */
  it("treats an accession shared by both builds as no signal", async () => {
    const decision = await decideIntakeAssembly({
      notation: "NC_012920.1:g.100A>G",
      annotatedAssembly: "GRCh37",
      annotationPresent: true,
    }, { lift: noLift });

    expect(decision.submittedAssembly).toBe("GRCh37");
    expect(decision.coordinateLift.status).toBe("unavailable");
    expect(decision.assemblyNote).not.toContain("not used");
  });

  /**
   * The accession override is gated on `builds.length === 1`, and that gate is the ONLY thing
   * standing between an ambiguous accession and a build nobody stated.
   *
   * `NC_012920.1` (the mitochondrial rCRS) appears in BOTH build tables because the mitochondrion
   * is the same sequence under the same accession in GRCh37 and GRCh38 — it carries NO build
   * signal. Annotated `(GRCh38)`, that coordinate is already canonical and must stay there. Widen
   * the guard to `builds.length >= 1` (which "any human chromosome accession" reads like) and the
   * first table entry — GRCh37 — silently overrides the caller's own annotation, so the coordinate
   * is treated as non-canonical, the lift is attempted, and a mitochondrial variant is annotated
   * on the wrong release. `DECISION TABLE` tests never covered a length>1 accession with a
   * CANONICAL annotation, so that mutant passed.
   */
  it("does not override a stated canonical build with an accession both builds share", async () => {
    const lift = vi.fn();
    const decision = await decideIntakeAssembly({
      notation: "NC_012920.1:g.100A>G",
      annotatedAssembly: "GRCh38",
      annotationPresent: true,
    }, { lift: lift as any });

    // The caller's own `(GRCh38)` annotation stands: MT states nothing, so nothing overrides it.
    expect(decision.submittedAssembly).toBe("GRCh38");
    expect(decision.resolveAssembly).toBe("GRCh38");
    // `not-needed` — NOT `unavailable`: the coordinate was never treated as non-canonical.
    expect(decision.coordinateLift.status).toBe("not-needed");
    expect(decision.coordinateLift.fromAssembly).toBe("GRCh38");
    // `not-needed` spends nothing: an unnecessary lift is a provider round trip per request.
    expect(lift).not.toHaveBeenCalled();
    // The build IS stated — by the annotation — so the record may not present it as assumed.
    expect(decision.coordinateLift.buildDeclared).toBe(true);
    // …and the accession must not be described as having overridden the annotation.
    expect(decision.assemblyNote).not.toContain("not used");
  });

  /**
   * The refusal CODE, per cause.
   *
   * The reason sentence is for a reader; the code is what a caller BRANCHES on, and the branch that
   * matters is retryable-versus-definitive — "try again in a minute" is honest advice for an
   * unanswered assembly map and false advice for a base where the two references disagree. Every
   * cause must therefore arrive as itself, not as the catch-all "the lift failed".
   */
  it("carries the lifter's refusal code through, per cause, into the reason", async () => {
    const cases = [
      { code: "no-mapping", says: "no mapping for that position" },
      // The bucket covers every non-unique answer (several mappings, a strand flip, a range
      // expansion), so its sentence describes what the map's answer is NOT rather than claiming the
      // position maps more than once — which was false for two of the three.
      { code: "ambiguous-mapping", says: "not a single-base, same-strand, unique mapping" },
      { code: "contig-changed", says: "different chromosome" },
      { code: "round-trip-failed", says: "does not reproduce the submitted position" },
      { code: "reference-discontinuity", says: "is not the submitted allele" },
      { code: "map-unavailable", says: "unavailable" },
      { code: "budget-exceeded", says: "budget" },
      { code: "invalid-coordinate", says: "single-base substitution" },
    ] as const;

    for (const { code, says } of cases) {
      const decision = await decideIntakeAssembly({
        notation: GRCH37_NOTATION,
        annotatedAssembly: "GRCh37",
        annotationPresent: true,
      }, { lift: vi.fn(async () => ({ failure: code })) as any });

      expect(decision.coordinateLift.status, code).toBe("unavailable");
      expect(decision.coordinateLift.reasonCode, code).toBe(code);
      // The sentence names the actual cause, so the disclosure can advise the right next step.
      expect(decision.coordinateLift.reason, code).toContain(says);
      // Every refusal still states the build it WAS annotated on, and never coerces the locus.
      expect(decision.resolveAssembly, code).toBe("GRCh37");
      expect(decision.coordinateLift.fromAssembly, code).toBe("GRCh37");
      expect(decision.coordinateLift.toAssembly, code).toBe("GRCh37");
      expect(decision.liftedCoordinates, code).toBeUndefined();
      expect(decision.notation, code).toBe(GRCH37_NOTATION);
    }
  });

  /**
   * Only the causes that another attempt could actually change are advertised as retryable. This is
   * the assertion that keeps `isRetryableLiftRefusal` from becoming "any refusal".
   */
  it("marks an outage or our own deadline retryable, and a reference fact NOT retryable", async () => {
    const retryability = async (code: string) => {
      const decision = await decideIntakeAssembly({
        notation: GRCH37_NOTATION,
        annotatedAssembly: "GRCh37",
        annotationPresent: true,
      }, { lift: vi.fn(async () => ({ failure: code })) as any });
      return isRetryableLiftRefusal(decision.coordinateLift);
    };

    expect(await retryability("map-unavailable")).toBe(true);
    expect(await retryability("budget-exceeded")).toBe(true);
    for (const definitive of ["no-mapping", "ambiguous-mapping", "contig-changed", "reference-discontinuity"]) {
      expect(await retryability(definitive), definitive).toBe(false);
    }
  });

  /**
   * `not-applicable` is not one thing: a cDNA notation has no genomic allele to lift, while a real
   * substitution on a contig the assembly map cannot address is a coordinate we failed to serve.
   * Both are coded, and differently, so neither is mistaken for the other.
   */
  it("codes the two ways of having nothing to lift differently", async () => {
    const lift = vi.fn();

    const cdna = await decideIntakeAssembly({
      notation: "NM_017871.6:c.50G>T",
      annotatedAssembly: "GRCh38",
      annotationPresent: false,
    }, { lift: lift as any });
    expect(cdna.coordinateLift.status).toBe("not-applicable");
    /**
     * `no-genomic-locus`, NOT `not-a-substitution`: a cDNA missense IS a substitution, and a code that
     * reads "out of missense scope" sends a caller to the wrong remedy for notation that is squarely
     * in scope — it simply carries no genomic position to lift.
     */
    expect(cdna.coordinateLift.reasonCode).toBe("no-genomic-locus");

    const unsupportedContig = await decideIntakeAssembly({
      notation: "NC_999999.1:g.100A>G",
      annotatedAssembly: "GRCh37",
      annotationPresent: true,
    }, { lift: lift as any });
    expect(unsupportedContig.coordinateLift.status).toBe("not-applicable");
    expect(unsupportedContig.coordinateLift.reasonCode).toBe("unsupported-contig");

    // A code is a statement about a lift that was CONSIDERED: nothing was attempted here.
    expect(lift).not.toHaveBeenCalled();
    // `not-needed` is not a refusal, so it carries no refusal code at all.
    const alreadyCanonical = await decideIntakeAssembly({
      notation: GRCH38_NOTATION,
      annotatedAssembly: "GRCh38",
      annotationPresent: true,
    }, { lift: lift as any });
    expect(alreadyCanonical.coordinateLift.status).toBe("not-needed");
    expect(alreadyCanonical.coordinateLift.reasonCode).toBeUndefined();
  });

  /**
   * The request allowance is ONE budget split between the lift and the ladder, and this is the
   * arithmetic that makes the split safe.
   *
   * The route gives the lift at most {@link INTAKE_LIFT_BUDGET_MS} and hands the ladder what is
   * left, floored at 10s (`translation.ts`). Each constant looks reasonable alone — which is
   * exactly how their SUM comes to abort a request that was about to succeed. If either the lift
   * budget or the ladder's default grows past this invariant, the floor stops fitting inside the
   * ceiling and a slow lift can only be answered by spending time the request does not have.
   */
  it("keeps the lift budget plus the ladder budget inside the request ceiling", () => {
    // The invariant the constants exist to satisfy.
    expect(INTAKE_LIFT_BUDGET_MS + DEFAULT_RESOLUTION_BUDGET_MS).toBeLessThanOrEqual(
      TRANSLATE_TOTAL_BUDGET_MS
    );

    /**
     * The route's floor cannot exceed the ceiling: `translation.ts` computes the ladder's budget as
     * `max(10_000, min(DEFAULT_RESOLUTION_BUDGET_MS, remaining))`, so a 10s floor larger than the
     * total allowance would let the ladder outlive the request that owns it.
     */
    const ROUTE_LADDER_FLOOR_MS = 10_000;
    expect(ROUTE_LADDER_FLOOR_MS).toBeLessThanOrEqual(TRANSLATE_TOTAL_BUDGET_MS);
    expect(ROUTE_LADDER_FLOOR_MS).toBeLessThanOrEqual(DEFAULT_RESOLUTION_BUDGET_MS);
    // Even a lift that spends its WHOLE allowance leaves the ladder its floor inside the ceiling.
    expect(INTAKE_LIFT_BUDGET_MS + ROUTE_LADDER_FLOOR_MS).toBeLessThanOrEqual(
      TRANSLATE_TOTAL_BUDGET_MS
    );
  });
});
