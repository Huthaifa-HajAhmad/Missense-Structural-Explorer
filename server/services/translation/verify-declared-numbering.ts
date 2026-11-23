/**
 * Verifies a coordinate answer's protein numbering through the protein the provider named.
 *
 * When Ensembl VEP is unavailable, VariantValidator answers instead. It names the RefSeq protein its
 * numbering follows (`NP_000537.3:p.(Arg273His)`) but no UniProt accession, so the reconciliation
 * marks the answer "unverified". That protein is enough to settle the question: UniProt's RefSeq
 * cross-references place it in the isoform model exactly, and the declared-protein resolver (the
 * one used for typed `NP_…:p.…` notations) then checks the wild-type residue on that protein and
 * maps the position onto the canonical sequence.
 *
 * A check that cannot complete (UniProt unreachable, protein not in UniProt, two readings) leaves
 * the answer unverified, as before.
 */
import { resolveAccessionedProteinNotation } from "./protein-numbering.ts";
import type { NumberingVerdict } from "./isoform-numbering.ts";

export async function verifyDeclaredNumbering(verdict: NumberingVerdict): Promise<NumberingVerdict> {
  const accession = verdict.numberingProteinId;
  const hgvsp = verdict.consequence.hgvsp ?? "";
  const proteinNotation = hgvsp.slice(hgvsp.indexOf(":") + 1);
  if (verdict.status !== "unverified" || !accession || !proteinNotation) return verdict;

  // A failed check is not a numbering verdict: the answer simply stays unverified.
  const outcome = await resolveAccessionedProteinNotation({ accession, proteinNotation }).catch(() => null);
  if (!outcome?.canonicalAccession || !outcome.canonicalVariant) return verdict;

  if (outcome.status === "canonical") {
    return {
      ...verdict,
      status: "canonical",
      canonicalAccession: outcome.canonicalAccession,
      numberingIsoform: outcome.basisId,
      reason: undefined,
    };
  }
  if (outcome.status === "remapped") {
    return {
      ...verdict,
      status: "remapped",
      consequence: { ...verdict.consequence, hgvsp: `${outcome.canonicalAccession}:${outcome.canonicalVariant}` },
      canonicalAccession: outcome.canonicalAccession,
      numberingIsoform: outcome.canonicalAccession,
      fromIsoform: outcome.basisId,
      reason: undefined,
    };
  }
  return verdict;
}
