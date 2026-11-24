/**
 * verifiedResidue.ts — a residue, and how its protein numbering was proven (doc/VERIFIED_RESIDUE_DESIGN.md).
 *
 * The same protein change can be numbered on different isoforms, so a residue number alone can point at the
 * wrong amino acid. `ResidueProof` names how the number was tied to the canonical UniProt sequence:
 *   - `genomic`: translated from a genomic or cDNA coordinate;
 *   - `declared-protein`: mapped through the protein the reader named (`NP_…` or a UniProt isoform);
 *   - `canonical-vs-mane`: a bare notation that only the canonical and MANE numberings were checked against
 *     (a weaker proof than the two above);
 *   - `user-confirmed`: the reader chose the canonical reading when two numberings fitted;
 *   - `unverified`: no proof (a provider was down, or the numbering could not be reconciled).
 *
 * `VerifiedResidue` can only be made by `VerifiedResidue.of`, which refuses an unverified residue. Its
 * private field means an object literal that copies its fields is not one. A `check-boundaries` rule
 * also stops any other file from building it by force (`scripts/verified-residue-rule.ts`).
 */

export type ResidueProof = "genomic" | "declared-protein" | "canonical-vs-mane" | "user-confirmed" | "unverified";

export interface Residue {
  /** Canonical UniProt accession the position is numbered on. */
  accession: string;
  /** Canonical residue number. */
  position: number;
  /** One-letter wild-type amino acid. */
  wildType: string;
  /** One-letter mutant amino acid. */
  mutant: string;
  proof: ResidueProof;
  /** Why the numbering is unverified, when it is. */
  reason?: string;
}

export class VerifiedResidue {
  readonly #brand = true;

  private constructor(readonly residue: Residue) {}

  /** The verified residue, or null when its numbering was not proven. */
  static of(residue: Residue): VerifiedResidue | null {
    return residue.proof === "unverified" ? null : new VerifiedResidue(residue);
  }

  /** True for a value made by this module, not for a copy of its fields. The boundary rule keeps other files from making one. */
  static is(value: unknown): value is VerifiedResidue {
    return typeof value === "object" && value !== null && #brand in value;
  }
}
