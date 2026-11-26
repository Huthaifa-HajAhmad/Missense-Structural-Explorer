/**
 * interfacesEvidence.ts — the one model the Interfaces & PPI tab, its Evidence Lineage rail and the
 * Insights "Assembly" lane render. This file is the import path; each section lives in
 * `src/shared/interfaces/`:
 *
 *   assembly.ts      curation: UniProt SUBUNIT statements (each with its qualifier), planned chains
 *   observed.ts      observation: PDBe-KB interfaces, native / fibril / crystal / set aside, and the
 *                    denominator — the structures that MODEL the residue (coverage from PDBe unipdb)
 *   complexModel.ts  prediction: Boltz-2 on request; the residue count decides the browser option
 *   verdict.ts       at an interface / not at one / not modelled / not measured
 *   partnerRows.ts   one row per partner protein, a family named without genes as its own row
 *   partnerGroups.ts tiers, folds, STRING cells, and one partner count
 *   track.ts         the sequence map, including the stretches no structure models
 *   binding.ts       DDMut-PPI ΔΔG_bind, solved wild type first, on request
 *   finding.ts       the headline, predicate, context and the fact strip
 *   trace.ts         the rail's rule trace
 *   stored.ts        stale payloads and per-residue native support for other views
 *
 * INVARIANTS
 *   • No ACMG code is drawn from this tab; the engine record is "None", stated once.
 *   • "At an interface" always carries its support: "in 1 of 8 solved structures (7AIQ)".
 *   • A structure with no coordinates for the residue is not in its denominator, and a residue no
 *     structure models is "Not modelled", never "not at the interface in 0 of 5" (ABCG1 Gly358).
 *   • Construct partners, antibodies and unmapped chains are never counted; fibril stacking and
 *     crystal packing are read apart from native interfaces.
 *   • Observation and prediction that disagree are said to disagree, in words.
 *   • A model that was not run, is running or failed makes the predicted reading "not measured".
 *   • A partner named as a family ("other K-Cl cotransporters", "the ABCG subfamily") is shown as
 *     unresolved, never as a gene and never contradicted by "no curated interaction".
 *   • Partner proteins are counted once, in one place, for the facts, the trace and the filter.
 *   • A STRING score is association, never binding strength.
 *   • ΔΔG_bind carries DDMut-PPI's sign (≤ 0 weaker binding) and its error, not a class.
 *
 * REPLACED: doc/INTERFACES_AUDIT.md (SLC12A4), doc/INTERFACES_PPI_REVIEW.md (SOD1),
 * doc/INTERFACES_PPI_AUDIT_2026-11-26.md (ABCG1: unmodelled residue read as "0 of 5", "ABCG" read as
 * a gene, three partner counts, LocalFold offered for a 1,356-residue complex).
 */
export * from "./interfaces/types.ts";
export {
  DDMUT_PPI_PERFORMANCE,
  DDMUT_PPI_RMSE,
  INTERFACES_SOURCES,
  IPTM_BAND_LABEL,
  NOT_MODELLED_REASON,
  PARTNER_BANDS,
  PARTNER_BAND_LABEL,
  PARTNER_GROUP_LABEL,
  iptmBand,
} from "./interfaces/constants.ts";
export { rcsbUrl, residueLabel, stringNetworkUrl, supportText } from "./interfaces/format.ts";
export { isStaleAssembly, isStalePpi, nativeInterfaceSupport, type NativeInterfaceSupport } from "./interfaces/stored.ts";
export { filterPartnerGroups, isSelfRow } from "./interfaces/partnerGroups.ts";
export { assemblySentence, buildInterfacesEvidence } from "./interfaces/build.ts";
