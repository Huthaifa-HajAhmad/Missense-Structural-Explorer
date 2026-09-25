import { describe, expect, it } from "vitest";
import { METRIC_EXPLANATIONS } from "../MetricExplanations";
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
    const interpretation = METRIC_EXPLANATIONS.burial_status.interpretation;

    // Core is the LOW side: at or below the core cutoff.
    expect(interpretation).toMatch(new RegExp(`core[^.]*?\\u2264\\s*${BURIAL_RSA_BANDS.coreMax * 100}%`, "i"));
    // Surface is the HIGH side: at or above the surface cutoff.
    expect(interpretation).toMatch(new RegExp(`surface[^.]*?\\u2265\\s*${BURIAL_RSA_BANDS.surfaceMin * 100}%`, "i"));
    // ...and the inverted reading must not be what the registry says.
    expect(interpretation).not.toMatch(/core[^.]*?>\s*15%/i);
    expect(interpretation).not.toMatch(/surface[^.]*?<\s*35%/i);
  });

  it("states the same packing cutoffs, in the same direction, as the classifier", () => {
    const interpretation = METRIC_EXPLANATIONS.contact_density.interpretation;

    expect(interpretation).toMatch(
      new RegExp(`core[^.]*?\\u2265\\s*${PACKING_NEIGHBOUR_BANDS.coreMin}\\b`, "i")
    );
    expect(interpretation).toMatch(
      new RegExp(`surface[^.]*?\\u2264\\s*${PACKING_NEIGHBOUR_BANDS.surfaceMax}\\b`, "i")
    );
  });

  it("names the residue-packing radius the server counts within", () => {
    expect(METRIC_EXPLANATIONS.contact_density.description).toContain(
      `${PACKING_NEIGHBOUR_BANDS.radiusAngstrom}\u00c5`
    );
  });
});
