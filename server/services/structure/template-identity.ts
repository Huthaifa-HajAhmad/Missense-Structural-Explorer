/**
 * template-identity.ts — is a template chain the wild-type protein?
 *
 * An experimental entry verified at the variant site can still differ from the UniProt sequence
 * elsewhere: engineered mutations (1R3S, the UROD structure chosen for p.Gly318Arg, is the D86G
 * mutant), thermostabilising or cysteine-free constructs, a natural variant in the cloned allele, a
 * sequence conflict. Such a chain is not a wild type, and every engine that mutates a template
 * (FoldX BuildModel, DynaMut2, DDMut, ThermoMPNN, StabilityOracle) would compute the queried change
 * against a background carrying another substitution. The resolver refuses such a chain for those
 * engines and says which residues disqualified it.
 *
 * Input is a chain ALREADY renumbered to UniProt (the Tier-1 resolver's output), so residue N is
 * compared with sequence[N-1]. Modified residues read as their parent (MSE is Met, not a mutation).
 * Residues with an insertion code, or outside the sequence, have no UniProt position and are skipped.
 */
import { AMINO_ACID_3_TO_1 } from "../../../src/shared/aminoAcids.ts";
import { extractPdbChainSequence } from "./sequence-aligner.ts";

export interface TemplateDifference {
  /** UniProt position. */
  pos: number;
  /** UniProt residue. */
  wt: string;
  /** Residue in the template. */
  found: string;
  /** The entry's own SEQADV comment, lower case ("engineered mutation", "conflict", "variant"), when it gives one. */
  kind: string | null;
}

/** SEQADV comments keyed by UniProt position (the record's database residue number). */
function seqadvKinds(pdbText: string, chainId: string): Map<number, string> {
  const kinds = new Map<number, string>();
  const chain = chainId.trim().toUpperCase();
  for (const line of pdbText.split("\n")) {
    if (!line.startsWith("SEQADV")) continue;
    // SEQADV 1R3S GLY A   86  UNP  P06132    ASP    86 ENGINEERED MUTATION
    const t = line.trim().split(/\s+/);
    if (t.length < 10 || t[3].toUpperCase() !== chain) continue;
    const dbRes = t[7].toUpperCase();
    const dbSeq = parseInt(t[8], 10);
    if (!AMINO_ACID_3_TO_1[dbRes] || !Number.isFinite(dbSeq)) continue;
    const comment = t.slice(9).join(" ").trim().toLowerCase();
    if (comment) kinds.set(dbSeq, comment);
  }
  return kinds;
}

export function templateSequenceDifferences(pdbText: string, chainId: string, sequence: string): TemplateDifference[] {
  const { residues } = extractPdbChainSequence(pdbText, chainId);
  const kinds = seqadvKinds(pdbText, chainId);
  const out: TemplateDifference[] = [];
  const seen = new Set<number>();
  for (const r of residues) {
    if (r.insCode || r.resSeq < 1 || r.resSeq > sequence.length || seen.has(r.resSeq)) continue;
    seen.add(r.resSeq);
    if (!/^[ACDEFGHIKLMNPQRSTVWY]$/.test(r.resName1)) continue;
    const wt = sequence[r.resSeq - 1].toUpperCase();
    if (wt !== r.resName1) out.push({ pos: r.resSeq, wt, found: r.resName1, kind: kinds.get(r.resSeq) ?? null });
  }
  return out;
}

/** "D86G (engineered mutation)", or "D86G" when the entry gives no reason. */
export function formatTemplateDifference(d: TemplateDifference): string {
  return `${d.wt}${d.pos}${d.found}${d.kind ? ` (${d.kind})` : ""}`;
}
