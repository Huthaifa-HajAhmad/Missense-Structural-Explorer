import { AMINO_ACID_3_TO_1 } from "./aminoAcids";

const BASES = "TCAG";
// NCBI Standard nuclear genetic code (Table 1), in T/C/A/G codon order.
// https://www.ncbi.nlm.nih.gov/Taxonomy/Utils/wprintgc.cgi#SG1
const TABLE = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";
const code = new Map<string, string>();
let i = 0;
for (const first of BASES) for (const second of BASES) for (const third of BASES) {
  code.set(first + second + third, TABLE[i++]);
}

/**
 * Conservative protein-only ambiguity proof for human standard nuclear-code inputs.
 * For EVERY possible WT codon, more than one distinct single-base change encodes ALT.
 * False means only "not proved ambiguous"; it NEVER proves that an allele is unique.
 * Known mitochondrial genes and initiator methionine are excluded: the ordinary nuclear sense
 * table does not establish their translation (Table 1 also permits alternative start codons).
 */
export function isIntrinsicallyAmbiguousProteinChange(variant: string, gene?: string): boolean {
  if (gene && /^MT-/i.test(gene.trim())) return false;
  const protein = variant.trim().replace(/^[^:]+:(?=p\.)/i, "").replace(/^p\.\(([^()]+)\)$/i, "p.$1");
  const aa = protein.match(/^(?:p\.)?([a-zA-Z]{1,3})[=:/]?(\d+)[=:/]?([a-zA-Z]{1,3})$/i);
  if (!aa || !Number.isSafeInteger(Number(aa[2])) || Number(aa[2]) < 1) return false;
  const single = (s: string) => s.length === 1 ? s.toUpperCase() : AMINO_ACID_3_TO_1[s.toUpperCase()];
  const wt = single(aa[1]);
  const mut = single(aa[3]);
  if (!wt || !mut || wt === mut || (wt === "M" && Number(aa[2]) === 1)) return false;
  const wtCodons = [...code].filter(([, aminoAcid]) => aminoAcid === wt).map(([codon]) => codon);
  return wtCodons.length > 0 && wtCodons.every(codon => {
    let alternatives = 0;
    for (let pos = 0; pos < 3; pos++) for (const base of BASES) {
      if (base !== codon[pos] && code.get(codon.slice(0, pos) + base + codon.slice(pos + 1)) === mut) alternatives++;
    }
    return alternatives > 1;
  });
}
