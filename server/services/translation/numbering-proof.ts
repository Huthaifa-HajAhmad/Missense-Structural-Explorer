/**
 * numbering-proof.ts — a signed statement of how a residue's numbering was proven (doc/VERIFIED_RESIDUE_DESIGN.md §2).
 *
 * `POST /translate-variant` proves the residue (from the genomic coordinate, or through the declared
 * protein), but the analysis routes receive only the canonical protein notation. A field the browser sends
 * back would only be a claim, so the translate route signs the proof and the analysis routes check the
 * signature. HMAC (a keyed hash: only a holder of the key can produce it) with SHA-256.
 *
 * The key is derived from `APP_SESSION_SECRET` under its own label, as `server/auth/user-secrets.ts` does,
 * so it is not the session-token key and it is the same in every container. Without the secret no proof is
 * issued, and every request falls back to the analysis route's own numbering check.
 *
 * The signed payload names the residue, so a proof cannot be moved onto another one. It carries the cache
 * schema version, so a version bump retires old proofs, and it expires after 30 days.
 */
import crypto from "node:crypto";
import { z } from "zod";
import { CACHE_SCHEMA_VERSION } from "../infra/cache-keys.ts";
import type { Residue, ResidueProof } from "../../../src/shared/verifiedResidue.ts";
import { parseVariantCoordinate } from "../../../src/shared/variantCoordinate.ts";

const FORMAT = "np1";
export const NUMBERING_PROOF_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/** The residue a proof must name to be accepted. */
export type ResidueIdentity = Pick<Residue, "accession" | "position" | "wildType" | "mutant">;

export type NumberingProofCheck =
  | { status: "valid"; proof: ResidueProof }
  | { status: "absent" | "invalid" | "expired" | "stale-schema" | "other-residue" };

/** What a signed body must look like. A signature proves who wrote it, not that its shape is current. */
const proofPayloadSchema = z.object({
  accession: z.string(),
  position: z.number().int(),
  wildType: z.string(),
  mutant: z.string(),
  proof: z.enum(["genomic", "declared-protein", "canonical-vs-mane", "user-confirmed"]),
  schema: z.string(),
  issuedAt: z.number().finite(),
});
type ProofPayload = z.infer<typeof proofPayloadSchema>;

/** A proof dated later than this many milliseconds from now is refused: this server never issues one. */
const CLOCK_DIFFERENCE_ALLOWED_MS = 5 * 60 * 1000;

let cachedKey: { secret: string; key: Buffer } | null = null;

function proofKey(): Buffer | null {
  const secret = process.env.APP_SESSION_SECRET?.trim();
  if (!secret) return null;
  if (cachedKey?.secret === secret) return cachedKey.key;
  const key = Buffer.from(crypto.hkdfSync("sha256", secret, "mse-numbering-proof", FORMAT, 32));
  cachedKey = { secret, key };
  return key;
}

function sign(key: Buffer, body: string): string {
  return crypto.createHmac("sha256", key).update(`${FORMAT}.${body}`).digest("base64url");
}

/** A proof for a verified residue, or null for an unverified one or when the server cannot sign. */
export function issueNumberingProof(residue: Residue, now = Date.now()): string | null {
  const key = proofKey();
  if (!key || residue.proof === "unverified") return null;
  const payload: ProofPayload = {
    accession: residue.accession,
    position: residue.position,
    wildType: residue.wildType,
    mutant: residue.mutant,
    proof: residue.proof,
    schema: CACHE_SCHEMA_VERSION,
    issuedAt: now,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${FORMAT}.${body}.${sign(key, body)}`;
}

/** The signed payload, or null when the token is malformed or its signature does not match. */
function readSignedPayload(token: string, key: Buffer): ProofPayload | null {
  const [format, body, signature, ...rest] = token.split(".");
  if (format !== FORMAT || !body || !signature || rest.length > 0) return null;
  const expected = Buffer.from(sign(key, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  // The signature matched, so the body is JSON from a server that holds the key.
  const parsed = proofPayloadSchema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
  return parsed.success ? parsed.data : null;
}

function namesResidue(payload: ProofPayload, residue: ResidueIdentity): boolean {
  return (
    payload.accession.toUpperCase() === residue.accession.toUpperCase() &&
    payload.position === residue.position &&
    payload.wildType === residue.wildType &&
    payload.mutant === residue.mutant
  );
}

/** Checks a proof sent back by the browser against the residue the request is about. */
export function verifyNumberingProof(
  token: unknown,
  residue: ResidueIdentity,
  now = Date.now(),
  schema = CACHE_SCHEMA_VERSION
): NumberingProofCheck {
  if (typeof token !== "string" || token === "") return { status: "absent" };
  const key = proofKey();
  const payload = key && token.length <= 1024 ? readSignedPayload(token, key) : null;
  if (!payload) return { status: "invalid" };
  if (payload.schema !== schema) return { status: "stale-schema" };
  if (payload.issuedAt - now > CLOCK_DIFFERENCE_ALLOWED_MS) return { status: "invalid" };
  if (now - payload.issuedAt > NUMBERING_PROOF_LIFETIME_MS) return { status: "expired" };
  if (!namesResidue(payload, residue)) return { status: "other-residue" };
  return { status: "valid", proof: payload.proof };
}

/**
 * The proof for a translated answer: its canonical notation (`p.Lys272Asn`) on the canonical accession.
 * Null when the answer is unverified, names no accession, or its notation is not a single residue.
 */
export function proofForTranslation(
  accession: string,
  canonicalVariant: string,
  proof: ResidueProof
): string | null {
  if (!accession || proof === "unverified") return null;
  try {
    const { pos, wt1, mut1 } = parseVariantCoordinate(canonicalVariant, { uniprotId: accession });
    return issueNumberingProof({ accession, position: pos, wildType: wt1, mutant: mut1, proof });
  } catch {
    // The route has already validated the notation; a form the parser cannot read simply gets no proof.
    return null;
  }
}
