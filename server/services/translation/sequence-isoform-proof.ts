/**
 * Proves that a consequence's protein numbering follows the canonical UniProt sequence, by comparing
 * sequences.
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
 * exact protein version has the same sequence as the canonical UniProt sequence, the two numberings
 * are the same by definition. A cross-reference alone is not proof: it links a protein to an entry
 * without promising the sequences are the same (see the RHOT1 note in `protein-numbering.ts`).
 *
 * Only the canonical sequence is compared, on purpose. UniProt serves the displayed canonical
 * sequence for the bare accession. When the canonical is not isoform 1 (COL2A1), a separate record
 * `<accession>-1` is a different protein, yet the rest of the pipeline reads `<accession>-1` as
 * canonical. Comparing only the canonical sequence means a match with any other isoform proves
 * nothing, and the answer stays "unverified".
 *
 * The position and the wild-type residue are read from the notation itself (`hgvsp`), because the
 * signed numbering proof is made from that same notation. A provider's `amino_acids` field must agree
 * with it, otherwise a proof could be signed for a residue that was never checked.
 *
 * Anything short of that (no version on the protein id, an accession that names an isoform, Ensembl
 * serving another version, a sequence that differs, the wild-type residue not at the stated position,
 * a provider failure, a lookup that takes too long) proves nothing, and the answer stays "unverified".
 */
import { fetchUniprotSequence } from "../external-api/uniprot.ts";
import { UNIPROT_PATTERN } from "../../utils/validation.ts";
import { anySignal } from "../../utils/signals.ts";
import { aminoAcidChange } from "./isoform-numbering.ts";
import { parseSubstitution } from "./isoform-remap.ts";
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
  const [proteinId, notation] = tc.hgvsp.split(":");
  const substitution = parseSubstitution(notation ?? "");
  const accession = canonicalAccession.toUpperCase();
  if (!substitution || !UNIPROT_PATTERN.test(accession) || !VERSIONED_ENSP.test(proteinId.trim().toUpperCase())) {
    return false;
  }
  // The provider's own amino-acid field must describe the same substitution as the notation.
  if (aminoAcidChange(tc) !== `${substitution.wt1}>${substitution.mut1}`) return false;

  const budget = anySignal([signal, AbortSignal.timeout(SEQUENCE_PROOF_BUDGET_MS)])!;
  // A lookup that fails is not a numbering fact: the answer simply stays unverified.
  const abandoned = new Promise<null>((resolve) =>
    budget.addEventListener("abort", () => resolve(null), { once: true })
  );
  const [enspSequence, canonicalSequence] = await Promise.race([
    Promise.all([
      // Only this lookup is ours alone, so only this one is cancelled with the budget.
      fetchEnsemblProteinSequence(proteinId.trim(), budget).catch(() => null),
      // Shared with every request that needs this sequence, so it is never given our signal: the
      // proof stops WAITING for it, and the fetch carries on for the others.
      fetchUniprotSequence(accession).catch(() => null),
    ]),
    abandoned.then(() => [null, null] as const),
  ]);

  return (
    !!enspSequence &&
    enspSequence[substitution.position - 1] === substitution.wt1 &&
    canonicalSequence?.toUpperCase() === enspSequence
  );
}
