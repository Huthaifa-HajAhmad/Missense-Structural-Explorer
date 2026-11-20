import { predictorCoordinateFromContext } from "../../../src/shared/contracts.ts";
import type { FetchClinVarOptions } from "./clinvar.ts";

/**
 * The third argument for `fetchClinVarData` for a run: the plain notation when no GRCh38 allele is
 * stated (unchanged behaviour), otherwise options that bind the record to that exact allele.
 */
export function clinvarLookupOptions(context: {
  originalNotation?: string;
  genomicCoordinates?: string | null;
  assembly?: any;
  liftedGenomicCoordinates?: string | null;
  resolvedAssembly?: any;
}): string | FetchClinVarOptions | undefined {
  const c = predictorCoordinateFromContext(context);
  if (!c || c.assembly !== "GRCh38") return context.originalNotation;
  return { originalNotation: context.originalNotation, coordinate: c };
}

