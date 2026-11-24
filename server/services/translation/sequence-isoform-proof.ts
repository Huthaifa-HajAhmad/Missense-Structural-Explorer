/**
 * Proves which UniProt isoform a consequence's protein numbering follows by comparing sequences.
 *
 * WHY
 * ---
 * Ensembl VEP names the isoform (`uniprot_isoform`) only for UniProt entries that have more than one
 * isoform. For an entry with a single sequence (PAH P00439, HBB, SOD1, BRCA2) it reports the
 * accession in `swissprot` and nothing else, and UniProt's own Ensembl and RefSeq cross-references
 * name no isoform either. With no stated basis the reconciliation could only answer "unverified".
 *
 * WHAT COUNTS AS PROOF
 * --------------------
 * VEP numbers `hgvsp` on the Ensembl protein it names (`ENSP00000448059.1:p.Arg408Trp`). If that
 * exact protein version has the same sequence as a UniProt isoform, the two numberings are the same
 * by definition. A cross-reference alone is not proof: it links a protein to an entry without
 * promising the sequences are the same (see the RHOT1 note in `protein-numbering.ts`).
 *
 * Only the CANONICAL record counts. UniProt labels the displayed (canonical) sequence with the bare
 * accession; when the canonical is not isoform 1 (COL2A1), a separate record `<accession>-1` is a
 * different protein, yet `<accession>-1` reads as canonical everywhere else. A match with any other
 * isoform therefore proves nothing here, and the answer stays "unverified".
 *
 * Anything short of that (no version on the protein id, Ensembl serving another version, a sequence
 * that differs, the wild-type residue not at the stated position, a provider failure) proves
 * nothing, and the answer stays "unverified".
 */
import { fetchUniprotIsoforms } from "../external-api/uniprot.ts";
import { anySignal } from "../../utils/signals.ts";
import { aminoAcidChange, proteinPosition } from "./isoform-numbering.ts";
import { fetchEnsemblProteinSequence } from "./protein-numbering.ts";
import type { ProteinAlteringConsequence } from "./types.ts";

/** A versioned Ensembl protein id: the version is what pins the sequence. */
const VERSIONED_ENSP = /^ENSP\d+\.\d+$/;

/**
 * Both lookups together get this long. The provider already answered; a slow sequence service
 * must not use up the time left for the translation.
 */
const SEQUENCE_PROOF_BUDGET_MS = 8_000;

/**
 * True when the Ensembl protein `tc.hgvsp` is numbered on has exactly the canonical sequence of
 * `canonicalAccession` and carries the stated wild-type residue at the stated position.
 */
export async function isCanonicalBySequence(
  tc: ProteinAlteringConsequence,
  canonicalAccession: string,
  signal?: AbortSignal
): Promise<boolean> {
  const proteinId = tc.hgvsp.split(":")[0]?.trim().toUpperCase() ?? "";
  const position = proteinPosition(tc.hgvsp);
  const wildType = aminoAcidChange(tc)?.split(">")[0];
  if (!VERSIONED_ENSP.test(proteinId) || !position || !wildType) return false;

  const budget = anySignal([signal, AbortSignal.timeout(SEQUENCE_PROOF_BUDGET_MS)]);
  // A lookup that fails is not a numbering fact: the answer simply stays unverified.
  const [enspSequence, isoforms] = await Promise.all([
    fetchEnsemblProteinSequence(proteinId, budget).catch(() => null),
    fetchUniprotIsoforms(canonicalAccession, { signal: budget }).catch(() => []),
  ]);
  if (!enspSequence || enspSequence[position - 1] !== wildType) return false;

  const accession = canonicalAccession.toUpperCase();
  const canonical = isoforms.find((isoform) => isoform.id.toUpperCase() === accession);
  return canonical?.sequence.toUpperCase() === enspSequence;
}
