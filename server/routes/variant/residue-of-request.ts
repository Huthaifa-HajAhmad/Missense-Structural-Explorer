/**
 * residue-of-request.ts — the residue an analysis request is about, and how its numbering was proven.
 *
 * A signed proof from `POST /translate-variant` wins when it names this residue (`numbering-proof.ts`).
 * Otherwise the analysis route's own check decides, mapped onto the proof names of
 * doc/VERIFIED_RESIDUE_DESIGN.md §3: a canonical answer from the canonical-versus-MANE comparison is
 * `canonical-vs-mane`, the reader's choice at the ambiguity prompt is `user-confirmed`, and anything
 * else (no answer, or an answer that is not canonical) is `unverified`.
 */
import type { Residue, ResidueProof } from "../../../src/shared/verifiedResidue.ts";
import {
  verifyNumberingProof,
  type NumberingProofCheck,
  type ResidueIdentity,
} from "../../services/translation/numbering-proof.ts";

export interface RequestResidue {
  residue: Residue;
  /** Why a proof that was sent was not used; absent when none was sent or it was used. */
  rejectedProof?: Exclude<NumberingProofCheck["status"], "valid" | "absent">;
}

export function residueOfRequest(params: {
  token: unknown;
  identity: ResidueIdentity;
  ownCheck: { canonicalConfirmed: boolean; status?: string; reason?: string };
}): RequestResidue {
  const { token, identity, ownCheck } = params;
  const check = verifyNumberingProof(token, identity);
  if (check.status === "valid") return { residue: { ...identity, proof: check.proof } };

  let proof: ResidueProof = "unverified";
  if (ownCheck.canonicalConfirmed) proof = "user-confirmed";
  else if (ownCheck.status === "canonical") proof = "canonical-vs-mane";
  const residue: Residue = {
    ...identity,
    proof,
    ...(proof === "unverified" && ownCheck.reason ? { reason: ownCheck.reason } : {}),
  };
  return check.status === "absent" ? { residue } : { residue, rejectedProof: check.status };
}
