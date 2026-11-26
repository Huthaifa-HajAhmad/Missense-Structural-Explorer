/**
 * Gene symbols that HGNC (the committee that names human genes) has renamed, where the sources this app
 * reads disagree about which name they hold. The app uses the current name everywhere; a source that
 * still holds the retired one is asked under both, and names a source returns are compared with
 * `sameGene`.
 *
 * GBA was renamed GBA1. As measured on the live sources (November 2026): ClinVar, gnomAD, GRCh38
 * Ensembl VEP and the dbNSFP 5 web service hold GBA1 only; myvariant.info (dbNSFP 4) and the bundled
 * gnomAD v4.1.2 constraint table hold GBA only; GRCh37 Ensembl VEP accepts both and answers GBA.
 */
const RETIRED_SYMBOLS: Readonly<Record<string, readonly string[]>> = { GBA1: ["GBA"] };

/** The current symbol for a gene, upper-cased. */
export function normalizeGeneSymbol(gene: string): string {
  const symbol = gene.trim().toUpperCase();
  return Object.keys(RETIRED_SYMBOLS).find((current) => RETIRED_SYMBOLS[current].includes(symbol)) ?? symbol;
}

/** Every symbol the gene is held under: the current one first, then the retired ones. */
export function geneSymbolAliases(gene: string): string[] {
  const current = normalizeGeneSymbol(gene);
  return [current, ...(RETIRED_SYMBOLS[current] ?? [])];
}

export const sameGene = (a: string, b: string): boolean => normalizeGeneSymbol(a) === normalizeGeneSymbol(b);

/** A myvariant.info (dbNSFP) query term that matches the gene under any of its symbols. */
export function dbnsfpGeneTerm(gene: string): string {
  const symbols = geneSymbolAliases(gene);
  return `dbnsfp.genename:${symbols.length > 1 ? `(${symbols.join(" OR ")})` : symbols[0]}`;
}
