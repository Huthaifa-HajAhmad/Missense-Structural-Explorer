/**
 * evidenceTabs.ts — the ONE list of Evidence tabs.
 *
 * WHY THIS EXISTS
 * ---------------
 * The tab set was written out by hand in at least five places, and they had drifted:
 *   • the sidebar (`EVIDENCE_SUB_ITEMS`) said "In-silico predictors", the screen title "Predictors";
 *     the sidebar said "Residue shifts & pockets", the title "Residue shifts and pockets";
 *   • the workspace tab bar kept its own `names` map ("Population", "Predictors"…);
 *   • the inspector subtitles (`EVIDENCE_TAB_SUBTITLES`) had no entry for Expression or Species &
 *     models, so those rails showed the generic subtitle;
 *   • `AppViews` decided which layout an Evidence tab gets from an 11-id literal, so a twelfth tab
 *     would silently render without the Evidence layout;
 *   • the inspector routing was split between `ViewInspector` (three tabs) and `EvidenceInspector`
 *     (the rest), with a dead `structure` branch and an unreachable placeholder fallback.
 *
 * Every surface now reads this table. Adding a tab is one row here; TypeScript then refuses to build
 * until the rail map in `EvidenceInspector` and the guide map have an entry for it.
 *
 * Pure: no React, imports nothing (scripts/check-boundaries.ts).
 */

export const EVIDENCE_TABS = [
  { id: 'clinical', label: 'Population data', subtitle: 'Population data & ClinVar', detailView: 'Clinical assertion', guide: 'population' },
  { id: 'gene-disease', label: 'Gene–disease', subtitle: 'Gene–disease · records & sources', detailView: 'Validity assertions', guide: 'gene_disease' },
  { id: 'expression-models', label: 'Expression', subtitle: 'Expression · tissues & sources', detailView: 'Sampling & coverage', guide: 'expression' },
  { id: 'species-models', label: 'Species & models', subtitle: 'Orthologs, alignments & phenotypes', detailView: 'Orthology & screens', guide: 'species' },
  { id: 'function', label: 'Functional domains', subtitle: 'Functional domains & features', detailView: 'Annotation details', guide: 'function' },
  { id: 'predictors', label: 'In-silico predictors', subtitle: 'In-silico predictors & PP3/BP4 bands', detailView: 'Native score scales', guide: 'predictors' },
  { id: 'alphagenome', label: 'AlphaGenome', subtitle: 'AlphaGenome variant impact (AVI)', detailView: 'Rank & composition', guide: 'alphagenome' },
  { id: 'splicing', label: 'RNA splicing', subtitle: 'Splice rule & junction geometry', detailView: 'Channel details', guide: 'splicing' },
  { id: 'structure', label: 'Residue shifts & pockets', subtitle: 'Residue shifts & pocket provenance', detailView: 'Environment & pockets', guide: 'residue' },
  { id: 'perturbation', label: 'Structural perturbation', subtitle: 'Structural perturbation trace', detailView: 'Packing & geometry', guide: 'perturbation' },
  { id: 'interfaces', label: 'Interfaces & PPI', subtitle: 'Interfaces & partner provenance', detailView: 'Assemblies & models', guide: 'interfaces' },
] as const;

export type EvidenceTabId = (typeof EVIDENCE_TABS)[number]['id'];
export type EvidenceTabInfo = (typeof EVIDENCE_TABS)[number];

const BY_ID = new Map<string, EvidenceTabInfo>(EVIDENCE_TABS.map(t => [t.id, t]));

/** Identity membership; every consumer spells it `EVIDENCE_TABS.some((t) => t.id === id)`. */
export function isEvidenceTabId(id: string | null | undefined): id is EvidenceTabId {
  return typeof id === 'string' && BY_ID.has(id);
}

/** The tab's row. Typed so a caller holding a real id never handles `undefined`. */
export function evidenceTab(id: EvidenceTabId): EvidenceTabInfo {
  return BY_ID.get(id)!;
}

/** The tab's row for an untyped id (a URL, a stored preference), or null. */
export function findEvidenceTab(id: string | null | undefined): EvidenceTabInfo | null {
  return (id && BY_ID.get(id.toLowerCase())) || null;
}
