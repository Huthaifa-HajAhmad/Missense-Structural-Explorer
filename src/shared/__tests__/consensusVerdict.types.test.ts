import { describe, it, expectTypeOf } from "vitest";
import type { z } from "zod";
import { energeticsDataSchema } from "../contracts.ts";
import { computeConsensusVerdict, type ConsensusVerdict } from "../thresholds/consensus.ts";
import type { StabilityVerdict } from "../energeticsEvidence.ts";

/**
 * The verdict is a closed set. A comparison with a string the consensus cannot return then fails `tsc`
 * (TS2367), instead of silently never matching. These checks run in `tsc --noEmit`: they fail the build
 * if either type widens back to `string`.
 */
describe("the consensus verdict stays a closed set", () => {
  it("is not widened to string by the function that returns it", () => {
    expectTypeOf(computeConsensusVerdict({ foldx: 2 })).toEqualTypeOf<ConsensusVerdict>();
    expectTypeOf<ConsensusVerdict>().toEqualTypeOf<StabilityVerdict>();
  });

  it("is not widened to string by the stored payload contract", () => {
    type Stored = z.infer<typeof energeticsDataSchema>["consensusVerdict"];
    expectTypeOf<Stored>().toEqualTypeOf<StabilityVerdict | null | undefined>();
  });
});
