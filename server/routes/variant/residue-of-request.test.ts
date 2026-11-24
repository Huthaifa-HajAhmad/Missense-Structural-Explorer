import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { residueOfRequest } from "./residue-of-request.ts";
import { issueNumberingProof, NUMBERING_PROOF_LIFETIME_MS } from "../../services/translation/numbering-proof.ts";

/**
 * How an analysis request's numbering is named (doc/VERIFIED_RESIDUE_DESIGN.md §3): a valid signed proof
 * wins; otherwise the route's own check decides; and a proof that was sent but not used says why.
 */
const identity = { accession: "Q9Y305", position: 55, wildType: "R", mutant: "A" };
const proofOf = (position = 55, issuedAt = Date.now()) =>
  issueNumberingProof({ ...identity, position, proof: "declared-protein" }, issuedAt);

describe("residueOfRequest", () => {
  beforeEach(() => {
    vi.stubEnv("APP_SESSION_SECRET", "residue-of-request-test-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("takes the proof's name when the signed proof names this residue", () => {
    const result = residueOfRequest({ token: proofOf(), identity, ownCheck: { canonicalConfirmed: false, status: "ambiguous" } });
    expect(result).toEqual({ residue: { ...identity, proof: "declared-protein" } });
  });

  it.each([
    ["a canonical answer from the canonical-versus-MANE check", { canonicalConfirmed: false, status: "canonical" }, "canonical-vs-mane"],
    ["the reader choosing the canonical reading", { canonicalConfirmed: true, status: "ambiguous" }, "user-confirmed"],
    ["an unverified answer", { canonicalConfirmed: false, status: "unverified", reason: "no answer" }, "unverified"],
    ["no answer at all", { canonicalConfirmed: false }, "unverified"],
  ])("falls back to its own check for %s", (_label, ownCheck, proof) => {
    const { residue, rejectedProof } = residueOfRequest({ token: undefined, identity, ownCheck });
    expect(residue.proof).toBe(proof);
    expect(rejectedProof).toBeUndefined();
  });

  it.each([
    ["the check gave no answer (UniProt down)", undefined, "unverified"],
    ["the check could not verify", "unverified", "unverified"],
    ["the check found one reading", "canonical", "canonical-vs-mane"],
  ])("does not take the reader's choice as proof when there was no ambiguity to settle: %s", (_label, status, proof) => {
    const { residue } = residueOfRequest({ token: undefined, identity, ownCheck: { canonicalConfirmed: true, status } });
    expect(residue.proof).toBe(proof);
  });

  it("names a coordinate's residue unverified without the translation's proof: the route's own check cannot prove it", () => {
    const { residue } = residueOfRequest({
      token: undefined, identity, inputKind: "coordinate", ownCheck: { canonicalConfirmed: false, status: "canonical" },
    });
    expect(residue.proof).toBe("unverified");
    expect(residue.reason).toMatch(/translation/);
  });

  it("takes the translation's proof for a coordinate's residue", () => {
    const { residue } = residueOfRequest({ token: proofOf(), identity, inputKind: "coordinate", ownCheck: { canonicalConfirmed: false } });
    expect(residue.proof).toBe("declared-protein");
  });

  it("keeps the reason when the numbering is unverified", () => {
    const { residue } = residueOfRequest({ token: undefined, identity, ownCheck: { canonicalConfirmed: false, status: "unverified", reason: "UniProt did not answer" } });
    expect(residue).toMatchObject({ proof: "unverified", reason: "UniProt did not answer" });
  });

  it.each([
    ["names another residue", () => proofOf(56), "other-residue"],
    ["has expired", () => proofOf(55, Date.now() - NUMBERING_PROOF_LIFETIME_MS - 60_000), "expired"],
    ["is not a proof", () => "np1.garbage.signature", "invalid"],
  ])("says why it did not use a proof that %s", (_label, token, reason) => {
    const result = residueOfRequest({ token: token(), identity, ownCheck: { canonicalConfirmed: false, status: "canonical" } });
    expect(result.rejectedProof).toBe(reason);
    expect(result.residue.proof).toBe("canonical-vs-mane");
  });
});
