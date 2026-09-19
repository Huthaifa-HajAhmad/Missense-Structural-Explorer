/**
 * Live reference data for the production numbering case, shared by the translation tests.
 *
 * ACOT9: the UniProt canonical sequence `Q9Y305` (439 aa) and the MANE Select protein
 * `NP_001032248.1` = UniProt `Q9Y305-4` (448 aa), which is the canonical sequence plus the
 * 9-residue insertion `ACSSIHVNH` after Glu39. The lab reports `p.Lys281Asn`; the canonical
 * residue is K272, canonical 281 is a different residue (L), and at indices such as 85 the
 * wild-type LETTER coincides across the two numberings while the residue is 9 positions away —
 * the case that must be reported as ambiguous rather than guessed.
 *
 * Fetched from UniProt (canonical + `-4`) while building this, so the tests pin real data rather
 * than a paraphrase of it.
 */
export const ACOT9_CANONICAL =
  "MRRAALRLCALGKGQLTPGRGLTQGPQNPKKQGIFHIHEVRDKLREIVGASTNWRDHVKAMEERKLLHSFLAKSQDGLPPRRMKDSYIEVLLPLGSEPELREKYLTVQNTVRFGRILEDLDSLGVLICYMHNKIHSAKMSPLSIVTALVDKIDMCKKSLSPEQDIKFSGHVSWVGKTSMEVKMQMFQLHGDEFCPVLDATFVMVARDSENKGPAFVNPLIPESPEEEELFRQGELNKGRRIAFSSTSLLKMAPSAEERTTIHEMFLSTLDPKTISFRSRVLPSNAVWMENSKLKSLEICHPQERNIFNRIFGGFLMRKAYELAWATACSFGGSRPFVVAVDDIMFQKPVEVGSLLFLSSQVCFTQNNYIQVRVHSEVASLQEKQHTTTNVFHFTFMSEKEVPLVFPKTYGESMLYLDGQRHFNSMSGPATLRKDYLVEP";

export const ACOT9_ISOFORM_4 =
  "MRRAALRLCALGKGQLTPGRGLTQGPQNPKKQGIFHIHEACSSIHVNHVRDKLREIVGASTNWRDHVKAMEERKLLHSFLAKSQDGLPPRRMKDSYIEVLLPLGSEPELREKYLTVQNTVRFGRILEDLDSLGVLICYMHNKIHSAKMSPLSIVTALVDKIDMCKKSLSPEQDIKFSGHVSWVGKTSMEVKMQMFQLHGDEFCPVLDATFVMVARDSENKGPAFVNPLIPESPEEEELFRQGELNKGRRIAFSSTSLLKMAPSAEERTTIHEMFLSTLDPKTISFRSRVLPSNAVWMENSKLKSLEICHPQERNIFNRIFGGFLMRKAYELAWATACSFGGSRPFVVAVDDIMFQKPVEVGSLLFLSSQVCFTQNNYIQVRVHSEVASLQEKQHTTTNVFHFTFMSEKEVPLVFPKTYGESMLYLDGQRHFNSMSGPATLRKDYLVEP";

/** The 9 residues MANE Select carries that the canonical sequence does not. */
export const ACOT9_INSERTION = "ACSSIHVNH";

/** Inserts `inserted` after `afterPosition`, i.e. builds the isoform SHAPE from a canonical one. */
export function withInsertion(sequence: string, afterPosition: number, inserted: string): string {
  return sequence.slice(0, afterPosition) + inserted + sequence.slice(afterPosition);
}
