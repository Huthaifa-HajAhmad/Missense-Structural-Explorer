/**
 * Reference values and labels for the Interfaces & PPI model. Every number here names its source;
 * none is a calibration, and none feeds an ACMG criterion.
 */
import type { MultimerNotModelledReason } from "../contracts.ts";
import { THRESHOLDS } from "../thresholds/constants.ts";
import type { IptmBand, PartnerGroup } from "./types.ts";

/** AlphaFold-Multimer's published reading guide (EMBL-EBI), not a calibration; Boltz-2 has none of its own. */
export function iptmBand(iptm: number | null | undefined): IptmBand | null {
  if (iptm === null || iptm === undefined || !Number.isFinite(iptm)) return null;
  const C = THRESHOLDS.complexConfidence;
  if (iptm > C.iptmConfident) return "confident";
  if (iptm < C.iptmLow) return "low";
  return "grey";
}

export const IPTM_BAND_LABEL: Record<IptmBand, string> = {
  confident: "Confident interface",
  grey: "Uncertain",
  low: "Likely wrong",
};

/**
 * DDMut-PPI's reported performance (Zhou et al., NAR 2024;52:W207). The RMSE is what tells a reader
 * that a value of a few tenths of a kcal/mol is inside the method's error.
 */
export const DDMUT_PPI_RMSE = 1.33;
export const DDMUT_PPI_PERFORMANCE =
  "DDMut-PPI's authors report Pearson r 0.75 (RMSE 1.33 kcal/mol) leaving one complex out, and r 0.67 (RMSE 1.51 kcal/mol) leaving one binding site out. They publish no cut-point.";

export const NOT_MODELLED_REASON: Record<MultimerNotModelledReason, string> = {
  unstated: "UniProt states no assembly for this protein, so there is no complex to model.",
  "interactions-only": "UniProt lists binary interactions only, with no assembly to model.",
  complex: "The protein is one subunit of a larger complex whose composition UniProt does not state.",
  "heteromer-partner": "The partner named in the SUBUNIT record could not be resolved to exactly one UniProt entry.",
  "heteromer-stoichiometry": "Only heterodimers are modelled: a larger heteromer's copy numbers are not stated reliably.",
  "too-many-chains": "This app models at most four chains, and a partial ring is not the stated assembly.",
  "reference-mismatch": "The variant's reference residue does not match the UniProt sequence at that position.",
  "no-sequence": "The UniProt sequence could not be read.",
};

export const INTERFACES_SOURCES: Array<{ citation: string; doi?: string; url?: string }> = [
  { citation: "Varadi M, et al. PDBe-KB aggregated API (interface residues and residue coverage per UniProt accession). Bioinformatics 2021.", doi: "10.1093/bioinformatics/btab424" },
  { citation: "Del Toro N, et al. The IntAct database. Nucleic Acids Res 2022;50:D648.", doi: "10.1093/nar/gkab1006" },
  { citation: "Szklarczyk D, et al. The STRING database in 2023. Nucleic Acids Res 2023;51:D638.", doi: "10.1093/nar/gkac1000" },
  { citation: "Passaro S, et al. Boltz-2: towards accurate and efficient binding affinity prediction. bioRxiv 2025.", doi: "10.1101/2025.06.14.659707" },
  { citation: "Evans R, et al. Protein complex prediction with AlphaFold-Multimer. bioRxiv 2021 (ipTM defined).", doi: "10.1101/2021.10.04.463034" },
  { citation: "EMBL-EBI AlphaFold course: confidence scores in AlphaFold-Multimer (ipTM guidance).", url: "https://www.ebi.ac.uk/training/online/courses/alphafold/inputs-and-outputs/evaluating-alphafolds-predicted-structures-using-confidence-scores/confidence-scores-in-alphafold-multimer/" },
  { citation: "Zhou Y, Myung Y, Rodrigues CHM, Ascher DB. DDMut-PPI. Nucleic Acids Res 2024;52:W207.", doi: "10.1093/nar/gkae412" },
];

export const PARTNER_GROUP_LABEL: Record<PartnerGroup, { title: string; meta: string }> = {
  assembly: { title: "Assembly", meta: "Named in UniProt's SUBUNIT record" },
  structural: { title: "Seen in solved structures", meta: "PDBe-KB interfaces" },
  curated: { title: "Reported binding", meta: "UniProt or IntAct, beyond a single two-hybrid screen" },
  screen: { title: "Binary screen only", meta: "IntAct, two-hybrid in one study" },
  physical: { title: "Physical association only", meta: "STRING physical sub-network, no curated binding" },
  functional: { title: "Functional association only", meta: "STRING, no physical evidence" },
};

/**
 * The two bands the partner list is read in: binding evidence (a curated, structural or screened
 * claim that the two proteins actually bind) and association only (STRING physical/functional,
 * which is not a binding strength). The tier filter and the grid group headers share this map.
 */
export const PARTNER_BANDS: Record<PartnerGroup, "binding" | "association"> = {
  assembly: "binding",
  structural: "binding",
  curated: "binding",
  screen: "binding",
  physical: "association",
  functional: "association",
};

export const PARTNER_BAND_LABEL: Record<"binding" | "association", { title: string; meta: string }> = {
  binding: { title: "Binding evidence", meta: "a curated, structural or screened claim that the two proteins bind" },
  association: { title: "Association only", meta: "STRING association, not a binding strength" },
};
