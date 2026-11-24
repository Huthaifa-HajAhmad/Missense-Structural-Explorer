import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueNumberingProof, verifyNumberingProof, NUMBERING_PROOF_LIFETIME_MS } from "./numbering-proof.ts";
import { CACHE_SCHEMA_VERSION } from "../infra/cache-keys.ts";

/**
 * The translate route knows how the residue was proven (genomic coordinate, or declared protein), but the
 * analysis routes receive only the protein notation. The proof is how that knowledge reaches them: the
 * server signs it, the browser passes it back unchanged, and the server checks the signature.
 */
const residue = { accession: "Q9Y305", position: 55, wildType: "R", mutant: "A" };
const NOW = Date.UTC(2026, 10, 24);

describe("numbering proof", () => {
  const savedSecret = process.env.APP_SESSION_SECRET;
  beforeEach(() => {
    process.env.APP_SESSION_SECRET = "test-session-secret-for-numbering-proofs";
  });
  afterEach(() => {
    if (savedSecret === undefined) delete process.env.APP_SESSION_SECRET;
    else process.env.APP_SESSION_SECRET = savedSecret;
  });

  it("verifies a proof it issued, and returns how the residue was proven", () => {
    const token = issueNumberingProof({ ...residue, proof: "genomic" }, NOW);
    expect(token).toEqual(expect.any(String));
    expect(verifyNumberingProof(token, residue, NOW + 1000)).toEqual({ status: "valid", proof: "genomic" });
  });

  it("issues no proof for an unverified residue", () => {
    expect(issueNumberingProof({ ...residue, proof: "unverified", reason: "provider down" }, NOW)).toBeNull();
  });

  it("issues no proof when the server has no session secret to sign with", () => {
    delete process.env.APP_SESSION_SECRET;
    expect(issueNumberingProof({ ...residue, proof: "genomic" }, NOW)).toBeNull();
  });

  it("reports a missing proof as absent, so the caller falls back to its own check", () => {
    expect(verifyNumberingProof(undefined, residue, NOW)).toEqual({ status: "absent" });
    expect(verifyNumberingProof("", residue, NOW)).toEqual({ status: "absent" });
  });

  it("cannot be moved onto another residue", () => {
    const token = issueNumberingProof({ ...residue, proof: "genomic" }, NOW);
    expect(verifyNumberingProof(token, { ...residue, position: 56 }, NOW)).toEqual({ status: "other-residue" });
    expect(verifyNumberingProof(token, { ...residue, mutant: "W" }, NOW)).toEqual({ status: "other-residue" });
    expect(verifyNumberingProof(token, { ...residue, accession: "P04637" }, NOW)).toEqual({ status: "other-residue" });
  });

  it("rejects a proof whose content was changed after signing", () => {
    const token = issueNumberingProof({ ...residue, proof: "genomic" }, NOW)!;
    const [version, body, signature] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const forged = Buffer.from(JSON.stringify({ ...payload, position: 56 })).toString("base64url");
    expect(verifyNumberingProof(`${version}.${forged}.${signature}`, { ...residue, position: 56 }, NOW)).toEqual({ status: "invalid" });
    expect(verifyNumberingProof("not-a-proof", residue, NOW)).toEqual({ status: "invalid" });
  });

  it("rejects a proof signed with another secret (a rotated or different server)", () => {
    const token = issueNumberingProof({ ...residue, proof: "genomic" }, NOW);
    process.env.APP_SESSION_SECRET = "another-secret-entirely-for-this-test";
    expect(verifyNumberingProof(token, residue, NOW)).toEqual({ status: "invalid" });
  });

  it("expires after 30 days", () => {
    const token = issueNumberingProof({ ...residue, proof: "declared-protein" }, NOW);
    expect(NUMBERING_PROOF_LIFETIME_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(verifyNumberingProof(token, residue, NOW + NUMBERING_PROOF_LIFETIME_MS - 1).status).toBe("valid");
    expect(verifyNumberingProof(token, residue, NOW + NUMBERING_PROOF_LIFETIME_MS + 1)).toEqual({ status: "expired" });
  });

  it("is bound to the cache schema version, so a version bump retires old proofs", () => {
    const token = issueNumberingProof({ ...residue, proof: "genomic" }, NOW)!;
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    expect(payload.schema).toBe(CACHE_SCHEMA_VERSION);
    expect(verifyNumberingProof(token, residue, NOW, "v-next")).toEqual({ status: "stale-schema" });
  });
});
