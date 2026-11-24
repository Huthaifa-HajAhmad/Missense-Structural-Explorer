import { isLocalDbnsfpAvailable, queryLocalDbnsfpVariant, readLocalDbnsfpVersion } from "../dbnsfp_local.ts";
import { queryDbnsfpOrg } from "./dbnsfp-query.ts";
import { queryMyVariantDbnsfp } from "./myvariant-dbnsfp.ts";
import { scoresFromLocalRecord, type DbnsfpAnswer } from "./dbnsfp-scores.ts";
import { parseGenomicCoordinateString } from "../../../../src/shared/contracts.ts";

export interface DbnsfpRequest {
  gene: string;
  variant: string;
  /** Protein position; the local store and MyVariant are searched by it. */
  resolvedPos: number | null;
  /** The analysed allele as a GRCh38 id (`17-7673802-C-T`), or null when it is unknown or another build. */
  grch38AlleleId: string | null;
}

/**
 * The first dbNSFP source that has this variant: the local store, then query.dbnsfp.org, then
 * MyVariant.info. Null when none has it. A failing source is logged and the next one is asked.
 * query.dbnsfp.org counts only when it has REVEL, GERP++ or phyloP; a thinner row falls through.
 *
 * The allele is passed on when known, because REVEL and BayesDel score a
 * nucleotide change and one protein change can come from several (Q867H: CAA→CAC or CAT).
 */
export async function firstDbnsfpAnswer(req: DbnsfpRequest): Promise<DbnsfpAnswer | null> {
  const local = await localAnswer(req);
  if (local) return local;

  const org = await queryDbnsfpOrg(req.gene, req.variant, req.grch38AlleleId);
  // A row with only a secondary score (say ESM1b) must not end the search: MyVariant may hold REVEL.
  if (org && (org.revel !== null || org.gerp !== null || org.phylop !== null)) return { scores: org, source: "Public dbNSFP (dbnsfp.org)", revelProvenance: "query.dbnsfp.org (release not stated)" };

  const myVariant = await queryMyVariantDbnsfp(req.gene, req.variant, req.resolvedPos);
  if (myVariant) return { scores: myVariant, source: "myvariant.info", revelProvenance: "myvariant.info dbNSFP (release not stated)" };
  return null;
}

async function localAnswer(req: DbnsfpRequest): Promise<DbnsfpAnswer | null> {
  if (!isLocalDbnsfpAvailable() || req.resolvedPos === null) return null;
  // With the allele known, the store matches it exactly; a protein change encoded by two nucleotide
  // changes has two rows, and the protein-only match refuses that as ambiguous.
  const allele = parseGenomicCoordinateString(req.grch38AlleleId);
  try {
    const rec = await queryLocalDbnsfpVariant(req.gene, req.resolvedPos, null, null, req.variant,
      allele ? { ...allele, assembly: "GRCh38" as const } : null);
    if (!rec) return null;
    return {
      scores: scoresFromLocalRecord(rec),
      source: "local dbNSFP",
      revelProvenance: readLocalDbnsfpVersion() ?? "local dbNSFP (version not recorded)",
    };
  } catch (err: any) {
    console.warn(`[Local dbNSFP Query Error] Fallback to remote: ${err.message}`);
    return null;
  }
}
