/**
 * residue-of-request.ts — the residue an analysis request is about, and how its numbering was proven.
 *
 * A signed proof from `POST /translate-variant` wins when it names this residue (`numbering-proof.ts`).
 * Otherwise the analysis route's own check decides, mapped onto the proof names of
 * doc/VERIFIED_RESIDUE_DESIGN.md §3: a canonical answer from the canonical-versus-MANE comparison is
 * `canonical-vs-mane`, the reader's choice at the ambiguity prompt is `user-confirmed` (only when the check
 * did find two readings: the choice settles an ambiguity, it proves nothing on its own), and anything
 * else (no answer, or an answer that is not canonical) is `unverified`. For a request that carries the genomic
 * coordinate it was translated from, only the translation's proof counts: the own check compares canonical and
 * MANE numbering of the protein notation, which says nothing about whether the coordinate was translated to
 * the right residue. A route without a check of its own
 * (`/generate-mutant`) passes none, so a residue without a valid proof is `unverified`.
 */
import type { Residue, ResidueProof } from "../../../src/shared/verifiedResidue.ts";
import {
  verifyNumberingProof,
  type NumberingProofCheck,
  type ResidueIdentity,
} from "../../services/translation/numbering-proof.ts";

/** The proofs a translation issues: the only ones that prove a coordinate's residue. */
const TRANSLATION_PROOFS: ReadonlySet<ResidueProof> = new Set(["genomic", "declared-protein"]);

const COORDINATE_WITHOUT_PROOF =
  "The coordinate's translation sent no valid numbering proof, so the residue it was translated to is not verified.";

export interface RequestResidue {
  residue: Residue;
  /**
   * Why a proof that was sent was not used; absent when none was sent or it was used. `not-a-translation`:
   * a valid proof of the protein notation, sent with a coordinate, which only a translation proof covers.
   */
  rejectedProof?: Exclude<NumberingProofCheck["status"], "valid" | "absent"> | "not-a-translation";
}

export function residueOfRequest(params: {
  token: unknown;
  identity: ResidueIdentity;
  inputKind?: "coordinate" | "protein";
  ownCheck?: { canonicalConfirmed: boolean; status?: string; reason?: string };
}): RequestResidue {
  const { token, identity, inputKind, ownCheck } = params;
  const check = verifyNumberingProof(token, identity);
  if (inputKind === "coordinate") {
    if (check.status === "valid" && TRANSLATION_PROOFS.has(check.proof)) return { residue: { ...identity, proof: check.proof } };
    const residue: Residue = { ...identity, proof: "unverified", reason: COORDINATE_WITHOUT_PROOF };
    if (check.status === "absent") return { residue };
    return { residue, rejectedProof: check.status === "valid" ? "not-a-translation" : check.status };
  }
  if (check.status === "valid") return { residue: { ...identity, proof: check.proof } };

  let proof: ResidueProof = "unverified";
  if (ownCheck?.canonicalConfirmed && ownCheck.status === "ambiguous") proof = "user-confirmed";
  else if (ownCheck?.status === "canonical") proof = "canonical-vs-mane";
  const residue: Residue = {
    ...identity,
    proof,
    ...(proof === "unverified" && ownCheck?.reason ? { reason: ownCheck.reason } : {}),
  };
  return check.status === "absent" ? { residue } : { residue, rejectedProof: check.status };
}
