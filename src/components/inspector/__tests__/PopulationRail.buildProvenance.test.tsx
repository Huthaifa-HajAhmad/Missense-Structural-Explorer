// @vitest-environment jsdom
/**
 * The build trail under the lineage rows.
 *
 * The Assembly row states the build the models saw. When the translate route lifted a submitted
 * GRCh37 coordinate onto GRCh38 with a reverse-verified lift, the payload carries a second build fact
 * (and, when the lift failed, the reason the GRCh38-only sources declined). These assertions pin both
 * halves of the honesty requirement: the note appears when there is a trail to state, and it does NOT
 * appear when the builds agree or the fields are absent — a note that always rendered would be the
 * same hardcoded build claim the Assembly row was fixed for, one line lower.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PopulationRail } from "../PopulationRail";
import { buildAssemblyLiftNote } from "../assemblyLiftNote";
import { ASSEMBLY_LABELS } from "../../../shared/assembly";

const BASE: any = {
  metadata: { variant: "p.Phe508del", uniprotId: "P13569" },
  transcriptId: "ENST00000003084",
  isManeSelect: true,
  // The build the predictors actually saw — the row above the note.
  predictorData: { gnomadVariantAssembly: "GRCh38" },
};

function renderRail(overrides: Record<string, unknown> = {}) {
  return render(<PopulationRail analysisResult={{ ...BASE, ...overrides }} />);
}

/**
 * The lift record used throughout: a REAL server-emittable lift.
 *
 * `Chr1(GRCh37):g.1256452C>A` → `Chr1(GRCh38):g.1321072C>A` is the verified INTS11/CPSF3L lift.
 * An earlier fixture lifted an INDEL (`7-117199644-ATCT-A` → `7-117548628-ATCT-A`), which the
 * server can NEVER emit: `liftover.ts` lifts single-base substitutions only (an indel has no
 * single position to lift, and approximating one would describe a different variant), so a rail
 * certified against it was certified against a shape no payload carries.
 */
const LIFTED = {
  status: "lifted" as const,
  fromAssembly: "GRCh37" as const,
  toAssembly: "GRCh38" as const,
  fromCoordinates: "1-1256452-C-A",
  toCoordinates: "1-1321072-C-A",
  reverseVerified: true,
};

describe("PopulationRail — build trail", () => {
  it("states a verified lift and names the canonical locus", () => {
    renderRail({
      assembly: "GRCh37",
      resolvedAssembly: "GRCh38",
      liftedGenomicCoordinates: "1-1321072-C-A",
      coordinateLift: LIFTED,
    });

    const note = screen.getByTestId("assembly-lift-note");
    expect(note.textContent).toContain("Coordinate verified on the GRCh38 / hg38 reference");
    // Labels come from the shared table, not from a second spelling written here.
    expect(note.textContent).toContain(`${ASSEMBLY_LABELS.GRCh37} → ${ASSEMBLY_LABELS.GRCh38}`);
    expect(note.textContent).toContain("1-1321072-C-A");
  });

  /**
   * The payload shape here is the one the SERVER actually emits for a refused lift, taken from
   * `decideIntakeAssembly`: `toAssembly` means "the build the annotation ran against", so for
   * `unavailable` it equals `fromAssembly` — the submitted build — and the build the lift could not
   * reach is the canonical one by POLICY, not by a field. An earlier version of this test invented
   * `toAssembly: "GRCh38"` here, which made the (then unreachable) branch look covered while the
   * real payload rendered nothing at all.
   */
  it("states the build the annotation stayed on when no lift could be verified", () => {
    renderRail({
      assembly: "GRCh37",
      resolvedAssembly: "GRCh37",
      coordinateLift: {
        status: "unavailable",
        fromAssembly: "GRCh37",
        toAssembly: "GRCh37",
        fromCoordinates: "1-1256452-C-A",
        reason:
          "the coordinate could not be verified on the GRCh38 reference (no unique mapping, a " +
          "reference discontinuity, the assembly map was unavailable, or it did not answer within " +
          "the verification budget), so it was annotated on the GRCh37 reference, whose annotations " +
          "come from Ensembl's GRCh37 archive and predate MANE Select",
      },
    });

    const note = screen.getByTestId("assembly-lift-note");
    /**
     * The server's reason is the WHOLE disclosure when it is present — it already says what could not
     * be verified, on which reference, and where the annotation came from instead. The note used to
     * state that first clause in its own words AND append the reason, so the reader got "…could not be
     * verified on GRCh38 / hg38. the coordinate could not be verified on the GRCh38 reference (…)" —
     * one cause, twice, with the second sentence starting mid-thought.
     */
    expect(note.textContent).toContain("could not be verified on the GRCh38 reference");
    expect(note.textContent).toContain("Ensembl's GRCh37 archive");
    expect(note.textContent).toContain("predate MANE Select");
    // Said once: the clause that opens the server's reason must not appear twice in the note.
    // Case-insensitive because the note renders the reason as a sentence (its first letter upper-cased).
    expect(note.textContent!.match(/coordinate could not be verified/gi) ?? []).toHaveLength(1);
    /**
     * NO retry advice for THIS refusal: the reason names a reference discontinuity among its causes,
     * and `retryable` is only claimed for the codes that another attempt could actually change.
     */
    expect(note.textContent).not.toContain("Retrying may succeed");
  });

  /**
   * …and the mirror: an assembly map that did not answer, or our own deadline, IS worth retrying — and
   * the note says so, which is the only thing that gives `isRetryableLiftRefusal` a consumer.
   */
  it("invites a retry when the lift was refused for a retryable cause", () => {
    renderRail({
      assembly: "GRCh37",
      resolvedAssembly: "GRCh37",
      coordinateLift: {
        status: "unavailable",
        fromAssembly: "GRCh37",
        toAssembly: "GRCh37",
        reasonCode: "map-unavailable",
        reason:
          "the coordinate could not be verified on the GRCh38 reference (the assembly map was " +
          "unavailable), so it was annotated on the GRCh37 reference, whose annotation release " +
          "predates MANE Select",
      },
    });

    const note = screen.getByTestId("assembly-lift-note");
    expect(note.textContent).toContain("the assembly map was unavailable");
    expect(note.textContent).toContain("Retrying may succeed");
  });

  it("renders no note for a refused lift that claims a canonical submitted build", () => {
    // Contradictory payload (a lift is only attempted when the submitted build differs): inventing
    // a note here would assert a trail the server never produced.
    renderRail({
      assembly: "GRCh38",
      resolvedAssembly: "GRCh38",
      coordinateLift: { status: "unavailable", fromAssembly: "GRCh38", toAssembly: "GRCh38" },
    });

    expect(screen.queryByTestId("assembly-lift-note")).toBeNull();
  });

  it("renders no note when both builds agree", () => {
    renderRail({
      assembly: "GRCh38",
      resolvedAssembly: "GRCh38",
      coordinateLift: { status: "not-needed", fromAssembly: "GRCh38", toAssembly: "GRCh38" },
    });

    expect(screen.queryByTestId("assembly-lift-note")).toBeNull();
    // The build row itself is unchanged.
    expect(screen.getByText(ASSEMBLY_LABELS.GRCh38)).toBeTruthy();
  });

  it("renders no note when the payload carries no trail at all", () => {
    renderRail();
    expect(screen.queryByTestId("assembly-lift-note")).toBeNull();
  });
});

describe("buildAssemblyLiftNote", () => {
  it("is null for absent, empty and self-consistent provenance", () => {
    expect(buildAssemblyLiftNote(null)).toBeNull();
    expect(buildAssemblyLiftNote(undefined)).toBeNull();
    expect(buildAssemblyLiftNote({})).toBeNull();
    expect(
      buildAssemblyLiftNote({ assembly: "GRCh38", resolvedAssembly: "GRCh38" })
    ).toBeNull();
    // A lift record that claims no lift is not a reason to print a build.
    expect(
      buildAssemblyLiftNote({
        assembly: "GRCh38",
        resolvedAssembly: "GRCh38",
        coordinateLift: { status: "not-applicable", fromAssembly: "GRCh38", toAssembly: "GRCh38" },
      })
    ).toBeNull();
  });

  it("never names a build it cannot vouch for", () => {
    // The TYPE now forbids an unnameable build (`GenomeAssembly | null`), but the wire can still
    // carry one from an older or different server — and the guard must hold at runtime, because a
    // note that prints a build the payload never stated is the hardcoded-`GRCh38` defect again.
    expect(
      buildAssemblyLiftNote({ assembly: "hg19", resolvedAssembly: "GRCh38" } as any)
    ).toBeNull();
  });

  it("reads the two builds from the lift record when the top-level fields are absent", () => {
    const note = buildAssemblyLiftNote({
      coordinateLift: {
        status: "lifted",
        fromAssembly: "GRCh37",
        toAssembly: "GRCh38",
        toCoordinates: "1-1321072-C-A",
        reverseVerified: true,
      },
    });
    expect(note).toContain("Coordinate verified on the GRCh38 / hg38 reference");
    expect(note).toContain("1-1321072-C-A");
  });

  it("displays gnomAD v4 and local table not installed in sources section", () => {
    renderRail({
      gnomadFrequency: null,
      serviceStatus: { gnomadFrequency: "not_found" } as any,
      aouLookup: { localTable: "not-installed", remoteDbnsfp: "not-reported" },
    });
    expect(screen.getByText("v4")).toBeTruthy();
    expect(screen.getByText("local table not installed")).toBeTruthy();
  });
});
