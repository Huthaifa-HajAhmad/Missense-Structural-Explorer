import { describe, expect, it } from "vitest";
import { RESEARCH_GUIDES } from "../../../shared/researchGuides";
import { BURIAL_RSA_BANDS, PACKING_NEIGHBOUR_BANDS } from "../../../shared/burialEvidence";

/**
 * The metric-explanation registry is the third place that stated burial bands.
 *
 * It said "core < 15% RSA / surface > 35% RSA" while the SASA engine that produced the
 * badge used 5% / 25%, so one residue could be labelled "boundary" by the number and
 * "deeply buried in the hydrophobic core" by the sentence explaining it. The registry
 * cannot import the classification logic, so it is pinned to the shared cutoffs here.
 *
 * The assertions check the *direction* of each band, not merely that the numbers appear:
 * "core < 15% … surface > 35%" — the exact pre-fix sentence — satisfies a co-occurrence check
 * for "15%" and "35%" while inverting which side of each cutoff is buried, so a guard written
 * that way could not fail on the defect it exists for.
 */
describe("metric explanations agree with the shared burial bands", () => {
  it("states the same RSA cutoffs, in the same direction, as the classifier", () => {
    const interpretation = RESEARCH_GUIDES.burial_status.reading;

    // Core is the LOW side: at or below the core cutoff.
    expect(interpretation).toMatch(new RegExp(`core[^.]*?\\u2264\\s*${BURIAL_RSA_BANDS.coreMax * 100}%`, "i"));
    // Surface is the HIGH side: at or above the surface cutoff.
    expect(interpretation).toMatch(new RegExp(`surface[^.]*?\\u2265\\s*${BURIAL_RSA_BANDS.surfaceMin * 100}%`, "i"));
    // ...and the inverted reading must not be what the registry says.
    expect(interpretation).not.toMatch(/core[^.]*?>\s*15%/i);
    expect(interpretation).not.toMatch(/surface[^.]*?<\s*35%/i);
  });

  it("does not give the Cα count cut-points of its own", () => {
    // The count is a reading only; the registry must not re-introduce the retired bands.
    const interpretation = RESEARCH_GUIDES.contact_density.reading;
    expect(interpretation).toMatch(/reading only/i);
    expect(interpretation).not.toMatch(/core residues have/i);
  });

  it("names the residue-packing radius the server counts within", () => {
    expect(RESEARCH_GUIDES.contact_density.answer).toContain(
      `${PACKING_NEIGHBOUR_BANDS.radiusAngstrom}\u00c5`
    );
  });
});
