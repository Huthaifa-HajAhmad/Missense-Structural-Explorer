/**
 * core-identity.ts — the scientific identity of one core analysis request.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS ANSWERS
 * ─────────────────────────────────────────────────────────────────────────────
 * Two questions that used to be answered by accident:
 *
 *  1. "May these two concurrent requests share ONE core fetch?" (`flightKey`)
 *     Sharing is only safe when both requests would model the SAME thing with the SAME providers.
 *     The identity therefore covers the residue being modelled (gene, canonical substitution,
 *     sequence — by hash, not by value), the coordinate trail and its build, the ACMG weighting,
 *     the numbering decision, the provider/model configuration, and the AUTH CAPABILITY (a run made
 *     with a BioHub token reaches ESM3; one made without it reaches `token_required` — the two are
 *     different evidence, and a shared run would show one request the other's answer).
 *
 *  2. "May this PERSISTED payload be reused for this request?" (`checkPayloadCompatibility`)
 *     Rows live for 30 days and replay verbatim, so a payload written under one capability set,
 *     build, weighting or model choice can be read back under another. The database has no column
 *     for that (adding one is a destructive migration on a live table), so the identity is recorded
 *     INSIDE the payload, under `_internal` — the same place `_internal.pdbMapping` already lives,
 *     and the block both wire routes strip before responding.
 *
 *     A record that is ABSENT cannot be verified at all — the row may have been written for another
 *     build trail, weighting or provider configuration — so it is REFUSED and refetched once, and the
 *     refetch stamps it. That is a one-time recompute per unstamped row, not a cache wipe: the reader
 *     gets freshly fetched evidence (progressively on the stream route) rather than an empty card,
 *     and the row it replaces is verifiable from then on. The pre-existing staleness predicate still
 *     governs stamped rows as well; this guard only ever adds a refusal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO KEY MATERIAL LEAVES THIS MODULE
 * ─────────────────────────────────────────────────────────────────────────────
 * Credentials are reduced to two things, and neither is reversible or exportable:
 *
 *   • a FINGERPRINT — `sha256("credential:" + value)`, first 16 hex chars — which lives only in the
 *     in-memory `flightKey`. It exists so two different personal tokens never share a run; it is
 *     never persisted and never reaches a response.
 *   • a BOOLEAN — "a credential of this kind was present" — which is the only capability fact that
 *     goes into a payload. A persisted payload can therefore say "this run had no BioHub token"
 *     without carrying any material that would let a reader test a token guess offline.
 *
 * Endpoint URLs are persisted as a KEYED digest (HMAC with a deployment/process key), never as the
 * URL: a custom GPN/AlphaGenome endpoint can carry credentials or a tenant token in its query string,
 * and a bare hash of it would be an offline oracle for a guessed URL. The digest still separates URL
 * A from URL B — including two URLs that differ only in their query — because a different endpoint is
 * a different evidence source.
 */
import crypto from "crypto";
import type { ParsedVariantContext } from "../../routes/variant/variant-parser.ts";

/** Which identity a payload is being judged against. Structural runs add model choices. */
export type IdentityScope = "core" | "structural";

export interface CoreCapabilitySummary {
  /** A Hugging Face token was available to this run (GPN-Star, ESM-2, VESM, SaProt). */
  hf: boolean;
  /** A BioHub / EvolutionaryScale token was available (ESM3, ESMC). */
  biohub: boolean;
  /** An AlphaGenome key was available (live AVI score). */
  alphagenome: boolean;
}

/**
 * Which provider endpoints the run actually called: `null` for the default endpoint of that service,
 * otherwise a salted digest (see {@link endpointIdentity}).
 *
 * A boolean "a custom endpoint was used" is NOT enough, and was the hole this closes: two different
 * custom GPN URLs — including two URLs of the same host that differ only in their query — are
 * different evidence sources, so a row written against endpoint A must not be replayed for endpoint B.
 */
export interface CoreEndpointIdentity {
  gpn: string | null;
  alphagenome: string | null;
}

export interface CoreModelChoice {
  /** SaProt checkpoint the caller asked for; changes which numbers a structural run reports. */
  saprotEngine: string | null;
}

/**
 * The identity record written into a payload under `_internal`.
 *
 * Deliberately four short digests rather than the dimensions themselves: a persisted payload is
 * replayable for a month and readable by anyone with the database, so it records which identity
 * produced it without restating how the residue was modelled.
 *
 * The `capabilityHash` means "the providers and model choices this run used", and WHICH model
 * choices are included depends on the scope: the core block covers the evidence providers only (so
 * switching SaProt checkpoints does not invalidate a core payload that is engine-independent),
 * while the structural block adds the model choice (so a structural result computed with the 650M
 * checkpoint is never read back as this request's 35M evidence).
 */
export interface PayloadIdentityRecord {
  version: 1;
  /** Science: residue, sequence, coordinate trail, build, weighting, numbering decision. */
  scienceHash: string;
  /** Provider/model configuration and the coarse capability set, for the record's own scope. */
  capabilityHash: string;
  /** Sequence digest, kept beside the science digest so a mismatch can be named. */
  sequenceHash: string | null;
}

export interface CoreIdentity {
  /**
   * The singleflight key. Includes credential fingerprints, so it is process-local by construction:
   * it must never be logged, persisted, or returned.
   */
  flightKey: string;
  scienceHash: string;
  /** Provider-configuration digest WITHOUT the structural model choice (the core payload's scope). */
  capabilityHash: string;
  /** Provider-configuration digest INCLUDING the structural model choice (the structural payload's scope). */
  structuralCapabilityHash: string;
  sequenceHash: string | null;
  model: CoreModelChoice;
  capability: CoreCapabilitySummary;
  endpoints: CoreEndpointIdentity;
}

function digest(prefix: string, value: string): string {
  return crypto.createHash("sha256").update(`${prefix}:${value}`).digest("hex");
}

function hashValue(value: unknown): string {
  return digest("identity", JSON.stringify(value)).slice(0, 32);
}

/**
 * The key for {@link endpointIdentity}.
 *
 * Resolved ONCE per process, from a configured salt or the deployment's session secret. When neither
 * exists (a development or test process) a random key is generated, which means rows written for a
 * CUSTOM endpoint are refused after a restart — a refetch, and the safe direction. Rows that use the
 * default endpoints are untouched by this, because they carry no endpoint dimension at all.
 */
const ENDPOINT_DIGEST_KEY: Buffer = (() => {
  const configured = (process.env.CACHE_IDENTITY_SALT || process.env.APP_SESSION_SECRET || "").trim();
  if (configured.length > 0) return Buffer.from(`cache-identity:${configured}`, "utf8");
  return crypto.randomBytes(32);
})();

/**
 * A caller-supplied provider endpoint as a KEYED digest.
 *
 * The URL itself must not be recoverable from a persisted row: a private GPN endpoint can carry
 * credentials or a tenant token in its query string, and rows live for thirty days. A bare
 * `sha256(url)` is not enough either — it is an offline oracle, so anyone holding the row could test
 * a guessed URL against it. HMAC with a process/deployment key closes that.
 *
 * What must survive is only the DISCRIMINATION: two different URLs — including two that differ only
 * in their query — are different evidence sources, so they must not share a capability digest. The
 * keyed digest keeps exactly that property and nothing else.
 */
function endpointIdentity(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;
  return crypto
    .createHmac("sha256", ENDPOINT_DIGEST_KEY)
    .update(`provider-endpoint:${trimmed}`)
    .digest("hex")
    .slice(0, 32);
}

/** A credential reduced to a comparison tag. Never leaves the process. */
function credentialFingerprint(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string" || value.length === 0) return null;
  return digest("credential", value).slice(0, 16);
}

/**
 * The sequence digest.
 *
 * Upper-cased and trimmed because the same protein arrives with incidental whitespace from a FASTA
 * fetch, and case carries no information in an amino-acid sequence. Hashed rather than embedded:
 * a 400-residue string in every identity would be a payload-sized key.
 */
function sequenceFingerprint(sequence: string | null | undefined): string | null {
  if (!sequence || typeof sequence !== "string") return null;
  const normalized = sequence.trim().toUpperCase();
  if (normalized.length === 0) return null;
  return digest("sequence", normalized).slice(0, 16);
}

/**
 * Everything that changes WHAT is modelled.
 *
 * Order is fixed by the object literal, and each dimension is a scalar, so two contexts that model
 * the same residue produce the same digest — the JSON serialisation is stable by construction
 * rather than by hoping the caller's object key order matches.
 */
function scienceDimensions(context: ParsedVariantContext): Record<string, unknown> {
  return {
    gene: (context.gene ?? "").trim().toUpperCase(),
    uniprotId: (context.uniprotId ?? "").trim().toUpperCase(),
    /**
     * The canonical substitution the pipeline was asked for. Not normalized beyond trimming: a
     * spelling difference must fail the match (it would recompute, which is safe), never pass it
     * (which would attribute one residue's evidence to another).
     */
    variant: (context.variant ?? "").trim(),
    pos: Number.isFinite(context.pos) ? context.pos : null,
    residueIndex: context.residueIndex ?? null,
    wildType: context.wildType ?? null,
    mutant: context.mutant ?? null,
    wt1Letter: context.wt1Letter ?? null,
    mut1Letter: context.mut1Letter ?? null,
    sequenceHash: sequenceFingerprint(context.sequence),
    acmgWeighting: context.acmgWeighting ?? "standard",
    assembly: context.assembly ?? null,
    genomicCoordinates: context.genomicCoordinates ?? null,
    liftedGenomicCoordinates: context.liftedGenomicCoordinates ?? null,
    resolvedAssembly: context.resolvedAssembly ?? null,
    /**
     * The reader's answer to the ambiguity prompt. "These numbers ARE canonical" selects a different
     * residue than the derived reading, so it is an input to the model, not a disclosure.
     */
    numberingDisambiguated: Boolean(context.numberingDisambiguated)
  };
}

/**
 * The coarse capability set — presence flags, and only those.
 *
 * Read from the context, which the parser has already resolved (request header, body, then the
 * server's own environment), so this agrees with what the fetchers actually receive. There is no
 * second lookup of `process.env` here on purpose: `hfToken` in particular is deliberately NULL when
 * the caller pinned a custom GPN endpoint (the public GPN path is then the intended one), and
 * re-reading the environment would report a capability the run did not have.
 *
 * Endpoints are NOT here: "some custom endpoint was used" cannot distinguish URL A from URL B, which
 * is why they travel as {@link CoreEndpointIdentity} digests instead.
 */
function capabilitySummary(context: ParsedVariantContext): CoreCapabilitySummary {
  return {
    hf: Boolean(context.hfToken),
    biohub: Boolean(context.biohubToken),
    alphagenome: Boolean(context.alphagenomeApiKey)
  };
}

function modelChoice(context: ParsedVariantContext): CoreModelChoice {
  return { saprotEngine: context.saprotEngine ?? null };
}

/**
 * Provider credentials, reduced to process-local fingerprints.
 *
 * Two different personal tokens must not share a run, and a token must never be persistable — so the
 * fingerprint exists only inside the in-memory flight key (`credentialFingerprint`, a plain digest;
 * fine there, because nothing that computes it is ever written down).
 */
function providerFingerprints(context: ParsedVariantContext): Record<string, string | null> {
  return {
    hfToken: credentialFingerprint(context.hfToken),
    biohubToken: credentialFingerprint(context.biohubToken),
    alphagenomeKey: credentialFingerprint(context.alphagenomeApiKey),
    gpnEndpoint: credentialFingerprint(context.gpnApiUrl),
    alphagenomeEndpoint: credentialFingerprint(context.alphagenomeApiUrl)
  };
}

/** The full identity of one core analysis request. */
export function coreIdentityOf(context: ParsedVariantContext): CoreIdentity {
  const scienceHash = hashValue(scienceDimensions(context));
  const capability = capabilitySummary(context);
  const model = modelChoice(context);
  /** Which provider endpoints the run would call — keyed digests, never the URLs (see `endpointIdentity`). */
  const endpoints: CoreEndpointIdentity = {
    gpn: endpointIdentity(context.gpnApiUrl),
    alphagenome: endpointIdentity(context.alphagenomeApiUrl)
  };

  return {
    scienceHash,
    sequenceHash: sequenceFingerprint(context.sequence),
    /**
     * Persistable: the presence flags (different strings of the same kind of token run the same
     * evidence path) PLUS the endpoint digests (a different endpoint is a different source, so it
     * must not be shared or replayed).
     */
    capabilityHash: hashValue({ capability, endpoints }),
    /** The same, plus the structural model choice (which changes what the deep models compute). */
    structuralCapabilityHash: hashValue({ capability, endpoints, model }),
    /**
     * Shares a run across the SaProt checkpoint — deliberately, and this is the one place the model
     * choice is EXCLUDED from a sharing key.
     *
     * The CORE graph does not run SaProt (it is a `structural-model-fetcher` model), so two requests
     * that differ only in `saprotEngine` are the same core evidence. Including it here split them, and
     * the client makes that split systematic: the structural tab forwards `saprotEngine`, the core and
     * stream requests do not, so every non-default checkpoint produced two flight keys and two full
     * core fetches for the same variant. The checkpoint still travels in
     * `structuralCapabilityHash`, so the persisted STRUCTURAL identity keeps splitting model choices —
     * which is where the choice actually changes the evidence.
     */
    flightKey: hashValue({
      scienceHash,
      capability,
      endpoints,
      /** Process-local only. Two distinct personal tokens never share an in-flight run. */
      credentials: providerFingerprints(context)
    }),
    model,
    capability,
    endpoints
  };
}

/**
 * The identity record to persist beside a payload (safe: digests and booleans only).
 *
 * `scope` decides whether the structural model choice is part of the digest — see
 * {@link PayloadIdentityRecord}.
 */
export function payloadIdentityRecordOf(
  context: ParsedVariantContext,
  scope: IdentityScope = "core"
): PayloadIdentityRecord {
  const identity = coreIdentityOf(context);
  return {
    version: 1,
    scienceHash: identity.scienceHash,
    capabilityHash: scope === "structural" ? identity.structuralCapabilityHash : identity.capabilityHash,
    sequenceHash: identity.sequenceHash
  };
}

/** The structural record: the same shape, written under `_internal.structuralIdentity`. */
export function structuralIdentityRecordOf(context: ParsedVariantContext): PayloadIdentityRecord {
  return payloadIdentityRecordOf(context, "structural");
}

export interface PayloadCompatibility {
  compatible: boolean;
  /** Whether the payload recorded an identity at all. False means it predates the guard and is REFUSED. */
  recorded: boolean;
  /** Which dimension refused the payload, or why it was accepted. Never contains credential material. */
  reason: string | null;
}

/** Reads the identity a payload recorded for one scope, tolerating a partially written record. */
export function recordedIdentityOf(payload: any, scope: IdentityScope): PayloadIdentityRecord | null {
  const record = payload?._internal?.[scope === "structural" ? "structuralIdentity" : "coreIdentity"];
  if (!record || typeof record !== "object") return null;
  if (typeof record.scienceHash !== "string" || typeof record.capabilityHash !== "string") return null;
  return {
    version: 1,
    scienceHash: record.scienceHash,
    capabilityHash: record.capabilityHash,
    sequenceHash: typeof record.sequenceHash === "string" ? record.sequenceHash : null
  };
}

/**
 * Whether a persisted payload may be reused for this request.
 *
 * Order matters: the STAMP is checked first — a row that records no identity cannot be verified at
 * all, so it is refused and refetched once, and the refetch stamps it. This is not the same as
 * "blanking the cache": the row is replaced by a freshly computed payload (progressively, on the
 * stream route), so the reader sees real evidence, not an empty card, and each row pays the refetch
 * exactly once. An unstamped row is unresolvable rather than merely old: it may have been written for
 * another build trail, weighting or provider configuration, and the guard has nothing to compare.
 *
 * Then the SCIENCE digest, because a payload about a different residue must be refused whatever its
 * capability set says. Then the capability digest — a payload computed without a token, or against a
 * different endpoint, is not evidence about the variant under a run that has one (this generalises the
 * per-source staleness rules the orchestrator already applies for GPN-Star, ESM3 and AlphaGenome).
 */
export function checkPayloadCompatibility(
  payload: any,
  context: ParsedVariantContext,
  scope: IdentityScope = "core"
): PayloadCompatibility {
  const recorded = recordedIdentityOf(payload, scope);
  if (!recorded) {
    return {
      compatible: false,
      recorded: false,
      reason:
        "persisted payload carries no server context identity, so it cannot be verified against " +
        "this request; refetching once, and the refetch stamps it"
    };
  }

  const identity = coreIdentityOf(context);
  const expectedCapabilityHash =
    scope === "structural" ? identity.structuralCapabilityHash : identity.capabilityHash;

  if (recorded.scienceHash !== identity.scienceHash) {
    return {
      compatible: false,
      recorded: true,
      reason:
        "persisted payload was computed for a different residue, sequence, coordinate trail, build, " +
        "numbering decision or ACMG weighting than this request"
    };
  }

  if (recorded.capabilityHash !== expectedCapabilityHash) {
    return {
      compatible: false,
      recorded: true,
      reason:
        scope === "structural"
          ? "persisted payload was computed under a different provider/auth capability set or a " +
            "different structural model choice than this request"
          : "persisted payload was computed under a different provider/auth capability set than this request"
    };
  }

  return { compatible: true, recorded: true, reason: "context identity matches the persisted payload" };
}
