import { describe, expect, it } from "vitest";
import { METRIC_EXPLANATIONS } from "../MetricExplanations";
import { BURIAL_RSA_BANDS, PACKING_NEIGHBOUR_BANDS } from "../../../shared/burialEvidence";

/**
 * The metric-explanation registry is the third place that stated burial bands.
 *
 * It said "core < 15% RSA / surface > 35% RSA" while the SASA engine that produced the
 * badge used 5% / 25%, so one residue could be labelled "boundary" by the number and
 * "deeply buried in the hydrophobic core" by the sentence explaining it. The registry
 * cannot import the classification logic, so it is pinned to the shared cutoffs here:
 * changing a band without changing the explanation fails this test.
 */
describe("metric explanations agree with the shared burial bands", () => {
  it("states the same RSA cutoffs the classifier applies", () => {
    const interpretation = METRIC_EXPLANATIONS.burial_status.interpretation;

    expect(interpretation).toContain(`${BURIAL_RSA_BANDS.coreMax * 100}%`);
    expect(interpretation).toContain(`${BURIAL_RSA_BANDS.surfaceMin * 100}%`);
  });

  it("states the same packing cutoffs the classifier applies", () => {
    const interpretation = METRIC_EXPLANATIONS.contact_density.interpretation;

    expect(interpretation).toContain(`\u2265 ${PACKING_NEIGHBOUR_BANDS.coreMin}`);
    expect(interpretation).toContain(`\u2264 ${PACKING_NEIGHBOUR_BANDS.surfaceMax}`);
  });

  it("names the residue-packing radius the server counts within", () => {
    expect(METRIC_EXPLANATIONS.contact_density.description).toContain(
      `${PACKING_NEIGHBOUR_BANDS.radiusAngstrom}\u00c5`
    );
  });
});
