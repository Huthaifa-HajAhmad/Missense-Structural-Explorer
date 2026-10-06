import type { VerifiedLiteratureAlias } from "./contracts";
import { parseVariantResidues } from "./literatureEvidence";

/** Only provider-resolved aliases bound to this gene, canonical accession and substitution. */
export function verifiedAliasQuery(gene: string, variant: string, accession: string, aliases: readonly VerifiedLiteratureAlias[]): string | null {
  const target = parseVariantResidues(variant);
  if (!target || !/^[A-Za-z0-9.-]+$/.test(gene)) return null;
  const notations = new Set<string>();
  for (const alias of aliases) {
    const residue = parseVariantResidues(alias.proteinVariant);
    if (alias.gene.toUpperCase() !== gene.toUpperCase() || alias.uniprotId !== accession || !residue
      || residue.wildType !== target.wildType || residue.position !== target.position || residue.alternate !== target.alternate) continue;
    const match = alias.notation.match(/^((?:ENST\d+|NM_\d+|NR_\d+)(?:\.\d+)?):(c\.\d+[ACGT]>[ACGT])$/);
    if (!match) continue;
    notations.add(match[0]); notations.add(match[2]);
  }
  return notations.size ? `${gene.toUpperCase()} AND (${[...notations].map(n => `"${n}"`).join(" OR ")})` : null;
}
