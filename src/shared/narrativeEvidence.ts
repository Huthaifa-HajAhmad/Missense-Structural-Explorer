/**
 * narrativeEvidence.ts — one versioned contract for "which evidence a narrative synthesis was given".
 *
 * WHY THIS EXISTS
 * ---------------
 * Two client paths ask the narrative route for a synthesis, and until now each one hand-wrote the
 * list of evidence fields it forwarded:
 *
 *   `src/services/pipeline/narrativeService.ts`   the automatic pass the pipeline runs
 *   `src/hooks/useNarrativeResynthesis.ts`        the explicit Re-synthesize control
 *
 * The route hashes that evidence into its cache key, so the two lists are not a cosmetic duplication:
 * a field added to one path and not the other gives the SAME run two different keys (a cache miss for
 * no reason) and — worse in the other direction — lets a narrative synthesized from one evidence set be
 * served for another. They had already drifted (`aouFrequency` was accepted by the request schema,
 * read by the route's frequency sentence, and sent by neither path).
 *
 * The concrete defect this module closes is in the hash itself. The route hashed
 * `{clinvar, predictorData, conservationData, stringInteractions, gnomadConstraint, gnomadFrequency,
 * uniprotFeatures, sequence}` — evidence VALUES only, never the run's per-source OUTCOMES. A ClinVar
 * TIMEOUT and a ClinVar query that was never made both arrive as `clinvar: null`, so they hashed
 * identically, and the two produce *different* prompt text: `clinvarPresence` reads the status and
 * reports `unread` ("the query did not complete; draw no conclusion") for the first and `unqueried`
 * for the second. A narrative written for the failed query was therefore servable to a run that had
 * never asked — the cache asserting the model was told something it was not told.
 *
 * So: the contract is declared once, here, and BOTH the client payload and the server hash are
 * derived from it. `serviceStatus` is part of it, which is what makes "failed" and "absent" different
 * evidence. The contract carries a VERSION, and the version is inside the canonical string, so a
 * change to what the narrative is given invalidates every cached narrative by construction instead
 * of by someone remembering to bump a key.
 *
 * WHAT IT ALSO PROVIDES (the honest fallback for deep-model evidence)
 * -----------------------------------------------------------------
 * `NARRATIVE_DEEP_EVIDENCE.integrated` is `false`, and that is a measurement, not a placeholder: the
 * narrative prompt carries no FoldX/DynaMut2/ThermoMPNN/ESM evaluation, so no synthesis can have
 * used one. Rather than let a report imply otherwise, a narrative now records the evidence revision
 * it was written from (`NarrativeEvidenceStamp`, stamped onto `result.metadata.narrativeEvidence`),
 * and `narrativeFreshness`/`narrativeDeepEvidenceStatus` report — accurately, from the result object —
 * whether that narrative still describes the evidence in hand and whether deep-model evidence exists
 * that it does not include.
 *
 * Deliberately dependency-free (enforced by `scripts/check-boundaries.ts`): `src/shared/` may not
 * import outside itself, and this module is imported by the browser bundle and the server alike.
 */
import {
  DEEP_EVIDENCE_SOURCE_LABELS,
  canonicalDeepModelEvidence,
  deepModelEvidenceFor,
  type DeepEvidenceContext,
  type DeepModelEvidence,
} from "./deepModelEvidence.ts";

/**
 * The narrative EVIDENCE contract's version.
 *
 * BUMP THIS WHENEVER `NARRATIVE_EVIDENCE_FIELDS` CHANGES, when a field's meaning changes, or when the
 * revision's normalization changes. It is interpolated into the canonical string, so a bump changes
 * every evidence revision and the server's whole narrative cache key — which is the point: a cached
 * narrative describes the evidence a previous contract defined.
 *
 * Version 1 was the first contract to include the run's `serviceStatus`, and therefore the first that
 * could tell a failed source from an absent one.
 *
 * Version 2 adds the DEEP-MODEL evidence block (see `src/shared/deepModelEvidence.ts`): a synthesis now
 * records whether it was given the stability and language-model observations, so a narrative written
 * before an engine settled cannot be served as though it had seen it.
 *
 * Version 3 adds `aouLookup`. `buildFrequencyEvidence` reads that record for the All of Us absence
 * sentence and its source label (`aouAbsenceReason`, `aouSourceLabel`), so it belongs with the evidence
 * rather than beside it: the contract is the union of what the two narrative kinds read, and
 * under-inclusion is the only dangerous direction. The AI path does not receive the field today, so no
 * cached synthesis can yet differ from another that shares its revision — the rule is kept so that it
 * cannot start to. Both sides must hash it (the client through `planNarrativeSynthesis`, the route
 * through its own field list), or one run acquires two identities.
 */
// v4 separates the client biological evidence revision from the server's literature snapshot.
// The route adds the snapshot digest to its cache key, never to a client-provided revision.
export const NARRATIVE_EVIDENCE_CONTRACT_VERSION = 4;

/**
 * The evidence the narrative synthesis is given, in the order the request states it.
 *
 * Every entry is a key on the narrative request (`server/routes/variant/narrative.ts` validates all of
 * them) and a key the shared contract hashes. `serviceStatus` is not in this list because it is the
 * run's *outcome map* rather than a source's value; it is carried by the contract as its own field so a
 * failed source cannot be hashed as an absent one.
 */
export const NARRATIVE_EVIDENCE_FIELDS = [
  "clinvar",
  "predictorData",
  "conservationData",
  "stringInteractions",
  "gnomadConstraint",
  "gnomadFrequency",
  "aouFrequency",
  "aouLookup",
  "uniprotFeatures",
  "sequence",
] as const;

export type NarrativeEvidenceField = (typeof NARRATIVE_EVIDENCE_FIELDS)[number];

/** Loose by design: callers hand in a result object, a request body, or a test fixture. */
export type NarrativeEvidenceSourceInput = Partial<Record<NarrativeEvidenceField, unknown>> & {
  serviceStatus?: Record<string, string> | null;
  /**
   * The deep-model block, in the shape `buildDeepModelEvidence` produces (and the route's schema
   * validates). Canonicalized into its own contract slot, because a value-hash of the observations is
   * what makes "the narrative was written with the ΔΔG on screen" checkable.
   */
  deepEvidence?: DeepModelEvidence | null;
};

export interface NarrativeEvidenceContract {
  contractVersion: number;
  /** Normalized evidence: `undefined` becomes `null`, so "omitted" and "explicitly absent" agree. */
  evidence: Record<NarrativeEvidenceField, unknown>;
  /** The run's per-source outcomes, keys sorted, empty when the run recorded none. */
  serviceStatus: Record<string, string>;
  /** The canonical deep-model block, or null when the synthesis was given none. */
  deepEvidence: string | null;
}

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------

/**
 * A JSON projection with a stable key order and no `undefined`.
 *
 * Two producers must agree here or the contract is decorative: the client canonicalizes the payload
 * it *sends*, the server canonicalizes the body it *receives*, and the two must produce one string
 * for one request. Sorting keys makes object insertion order irrelevant (the client builds the
 * payload in a fixed order, JSON.parse preserves the wire order, and neither is guaranteed), and
 * dropping `undefined` makes the result identical to what a JSON round trip yields.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      out[key] = canonicalize(source[key]);
    }
    return out;
  }
  return value;
}

/** Normalize one input into the contract: every declared field present, `undefined` → `null`. */
export function buildNarrativeEvidenceContract(
  input: NarrativeEvidenceSourceInput | null | undefined
): NarrativeEvidenceContract {
  const evidence = {} as Record<NarrativeEvidenceField, unknown>;
  for (const field of NARRATIVE_EVIDENCE_FIELDS) {
    const value = input?.[field];
    evidence[field] = value === undefined ? null : value;
  }

  const serviceStatus: Record<string, string> = {};
  const statuses = input?.serviceStatus;
  if (statuses && typeof statuses === "object") {
    for (const key of Object.keys(statuses).sort()) {
      const value = (statuses as Record<string, unknown>)[key];
      // A non-string status is not a status: it is dropped rather than stringified, so a malformed
      // map cannot invent a source outcome that would then hash as a "final" answer.
      if (typeof value === "string" && value.length > 0) serviceStatus[key] = value;
    }
  }

  /*
   * The deep-model block is canonicalized rather than hashed raw: the same observations in a different
   * array order are the same evidence, and a client that reorders them must still hit the narrative its
   * own run wrote. `canonicalDeepModelEvidence` also drops an observation with an id the app does not
   * know, so an unexpected extra row changes nothing.
   */
  const deepInput = input?.deepEvidence;
  const deepEvidence =
    deepInput && typeof deepInput === "object" && Array.isArray((deepInput as DeepModelEvidence).observations)
      ? canonicalDeepModelEvidence(deepInput as DeepModelEvidence)
      : null;

  return { contractVersion: NARRATIVE_EVIDENCE_CONTRACT_VERSION, evidence, serviceStatus, deepEvidence };
}

/**
 * The string the evidence hash is computed over — the ONLY input to both the server's cache key and
 * the client-visible revision.
 *
 * The version leads the string so a contract bump invalidates previous narratives even when the
 * evidence is byte-identical.
 */
export function canonicalNarrativeEvidence(contract: NarrativeEvidenceContract): string {
  return `narrative-evidence/v${contract.contractVersion}:${canonicalJson({
    evidence: contract.evidence,
    serviceStatus: contract.serviceStatus,
    deepEvidence: contract.deepEvidence,
  })}`;
}

// ---------------------------------------------------------------------------
// Revision (the identity a narrative records)
// ---------------------------------------------------------------------------

/**
 * A 128-bit identity digest of the contract. NOT a cryptographic digest and not a security boundary:
 * it answers "is this the same evidence set?" for one narrative on one client, and it must be
 * computable in the same tick on the browser and the server, synchronously, with no dependency.
 *
 * The server's CACHE KEY still uses SHA-256 (`server/routes/variant/narrative.ts`) over the same
 * canonical string; only this client-visible identity uses the digest below, so the two facts never
 * have to be the same number. Two independent seeds with a final avalanche mixing step (rather than
 * one FNV pass) is what keeps the halves independent — a second FNV pass over the same text with a
 * different offset basis is recoverable from the first, and would have made this a 64-bit digest
 * wearing a 128-bit label.
 */
const MIX_MASK = 0xffffffffffffffffn;
const MIX_PRIME = 0x100000001b3n;

function mix64(text: string, seed: bigint): bigint {
  let hash = seed;
  for (let index = 0; index < text.length; index++) {
    hash = (hash ^ BigInt(text.charCodeAt(index))) & MIX_MASK;
    hash = (hash * MIX_PRIME) & MIX_MASK;
  }
  hash = (hash ^ (hash >> 33n)) & MIX_MASK;
  hash = (hash * 0xff51afd7ed558ccdn) & MIX_MASK;
  hash = (hash ^ (hash >> 33n)) & MIX_MASK;
  hash = (hash * 0xc4ceb9fe1a85ec53n) & MIX_MASK;
  return (hash ^ (hash >> 33n)) & MIX_MASK;
}

export function narrativeEvidenceDigest(contract: NarrativeEvidenceContract): string {
  const canonical = canonicalNarrativeEvidence(contract);
  const first = mix64(canonical, 0x2545f4914f6cdd1dn).toString(16).padStart(16, "0");
  const second = mix64(canonical, 0x9e3779b97f4a7c15n).toString(16).padStart(16, "0");
  return `${first}${second}`;
}

/** The value a narrative records and a later reader compares: version + digest, one string. */
export function narrativeEvidenceRevision(contract: NarrativeEvidenceContract): string {
  return `nev${contract.contractVersion}:${narrativeEvidenceDigest(contract)}`;
}

// ---------------------------------------------------------------------------
// Where the evidence lives on an analysis result
// ---------------------------------------------------------------------------

/**
 * The ONE mapping from an analysis result to narrative evidence.
 *
 * Both client paths and the freshness check read evidence through this function, so "which field
 * holds the sequence" cannot be answered three ways. `serviceStatus` is read from the result body
 * first and `metadata` second because the analysis route puts it in both and a cached or replayed
 * bundle may carry only one.
 */
export function narrativeEvidenceSourceFromResult(
  result: any,
  context?: DeepEvidenceContext
): NarrativeEvidenceSourceInput {
  return {
    clinvar: result?.clinvar ?? null,
    predictorData: result?.predictorData ?? null,
    conservationData: result?.conservationData ?? null,
    stringInteractions: result?.stringInteractions ?? null,
    gnomadConstraint: result?.gnomadConstraint ?? null,
    gnomadFrequency: result?.gnomadFrequency ?? null,
    aouFrequency: result?.aouFrequency ?? null,
    aouLookup: result?.aouLookup ?? null,
    uniprotFeatures: result?.uniprotFeatures ?? null,
    sequence: result?.metadata?.sequence ?? result?.sequence ?? null,
    serviceStatus: result?.serviceStatus ?? result?.metadata?.serviceStatus ?? null,
    /*
     * The deep-model block, projected here rather than passed in, so a caller cannot plan a request with
     * one deep-evidence set and check its freshness against another. The projection is a pure function
     * of the result plus the supplement the result does not carry, which is why `context` exists.
     */
    deepEvidence: deepModelEvidenceFor(result, context),
  };
}

// ---------------------------------------------------------------------------
// The synthesis request both paths build
// ---------------------------------------------------------------------------

export interface NarrativeSynthesisIdentity {
  gene: string;
  variant: string;
  uniprotId: string;
}

export interface NarrativeSynthesisRequestOptions {
  userDirections?: string | null;
  acmgWeighting?: string | null;
  /**
   * The deep-model observations to give the synthesis — `buildDeepModelEvidence(...)`, or the
   * convenience `deepModelEvidenceFor(result, context)`.
   *
   * Optional so a caller with no deep evidence still builds a valid request; `null` is the honest
   * value then, and it hashes differently from an empty block.
   */
  deepEvidence?: DeepModelEvidence | null;
}

export interface NarrativeSynthesisRequestPlan {
  /** Exactly the body both client paths put on the wire. */
  request: Record<string, unknown>;
  /** The versioned evidence identity of that body. */
  contract: NarrativeEvidenceContract;
  /** `nev<version>:<digest>` — what the narrative this request returns records. */
  revision: string;
}

/**
 * Build the narrative request from an identity and an evidence source.
 *
 * This is the `src/shared` half of the "reusable by initial narrative and resynthesis" requirement:
 * `narrativeService` and `useNarrativeResynthesis` differ in when they ask, in how they merge the
 * answer, and in nothing else — the request is one function.
 *
 * `userDirections` and `acmgWeighting` are NOT part of the evidence contract (they are the reader's
 * instructions and the weighting model, both already separate segments of the server's cache key);
 * they travel in the request beside it.
 */
export function planNarrativeSynthesis(
  identity: NarrativeSynthesisIdentity,
  source: NarrativeEvidenceSourceInput,
  options: NarrativeSynthesisRequestOptions = {}
): NarrativeSynthesisRequestPlan {
  // The block may arrive on the source (the usual path: `narrativeEvidenceSourceFromResult` projects it)
  // or as an explicit option (a caller that built it from a different snapshot). One value either way,
  // and it is the SAME value the contract hashes.
  const deepEvidence = options.deepEvidence ?? source.deepEvidence ?? null;
  const contract = buildNarrativeEvidenceContract({ ...source, deepEvidence });
  return {
    request: {
      gene: identity.gene,
      variant: identity.variant,
      uniprotId: identity.uniprotId,
      userDirections: options.userDirections || undefined,
      acmgWeighting: options.acmgWeighting,
      ...contract.evidence,
      serviceStatus: Object.keys(contract.serviceStatus).length > 0 ? contract.serviceStatus : null,
      deepEvidence,
    },
    contract,
    revision: narrativeEvidenceRevision(contract),
  };
}

// ---------------------------------------------------------------------------
// The stamp a synthesized narrative carries
// ---------------------------------------------------------------------------

/**
 * What a narrative records about its own synthesis, stamped onto `result.metadata.narrativeEvidence`.
 *
 * `metadata` is `z.object({...}).passthrough()` in the analysis response schema, so this field
 * survives every parse the payload passes through; the accessors below are what keep the untyped
 * write in one place.
 */
export interface NarrativeEvidenceStamp {
  contractVersion: number;
  /** The evidence revision the prose was written from (`planNarrativeSynthesis().revision`). */
  revision: string;
  /** When the synthesis returned, ms since epoch. */
  synthesizedAt: number;
  /** The run the request was made for (`metadata.pipelineRunId`), when the run declared one. */
  pipelineRunId?: string | null;
  /**
   * Declared, not inferred: whether the synthesis that produced this prose was given the deep-model
   * block. A stamp is a historical record, so it keeps the answer of the run that wrote it even after
   * `NARRATIVE_DEEP_EVIDENCE.integrated` changes — an older narrative must not be re-described as
   * having seen evidence that did not exist when it was written.
   */
  deepEvidenceIntegrated: boolean;
}

export function readNarrativeEvidenceStamp(result: any): NarrativeEvidenceStamp | null {
  const stamp = result?.metadata?.narrativeEvidence;
  if (!stamp || typeof stamp !== "object") return null;
  if (typeof stamp.revision !== "string" || stamp.revision.length === 0) return null;
  if (typeof stamp.contractVersion !== "number") return null;
  return stamp as NarrativeEvidenceStamp;
}

/** Returns a copy of the result with the stamp recorded in `metadata`. */
export function withNarrativeEvidenceStamp<T extends { metadata?: any }>(
  result: T,
  stamp: NarrativeEvidenceStamp
): T {
  return { ...result, metadata: { ...(result?.metadata ?? {}), narrativeEvidence: stamp } };
}

/**
 * Whether the narrative on a result still describes the evidence the result now holds.
 *
 * `unrecorded` covers both "no narrative yet" and "a narrative from before this contract existed, so
 * nothing recorded which evidence it was written from". Freshness is deliberately about the EVIDENCE,
 * not about authorship: `deriveNarrativeAuthorship`/`isFallbackNarrative` answer who wrote the prose,
 * and a rule-based report installed from the evidence in hand is `current` because its statements still
 * describe this run. A status surface that reads this must decide for itself whether to offer a retry —
 * `unrecorded` is not a claim that synthesis failed.
 */
export type NarrativeFreshness = "unrecorded" | "current" | "outdated";

/**
 * @param context the deep-evidence supplement the analysis result does not carry (the client's
 * biophysics state, or the biophysical response's own `energetics`/`ddG`). It MUST be the same kind of
 * context the synthesis was planned with, or a `current` narrative reads as `outdated`: the caller that
 * plans a request with `deepModelEvidenceFor(result, context)` checks it with the same context.
 */
export function narrativeFreshness(result: any, context?: DeepEvidenceContext): NarrativeFreshness {
  const stamp = readNarrativeEvidenceStamp(result);
  if (!stamp) return "unrecorded";
  if (stamp.contractVersion !== NARRATIVE_EVIDENCE_CONTRACT_VERSION) return "outdated";
  const current = narrativeEvidenceRevision(
    buildNarrativeEvidenceContract(narrativeEvidenceSourceFromResult(result, context))
  );
  return stamp.revision === current ? "current" : "outdated";
}

/**
 * The run this result belongs to, as the pipeline declares it (`metadata.pipelineRunId`).
 *
 * Used for one thing: refusing to install a narrative produced for run A on top of run B of the same
 * variant. Variant equality alone is not that test — re-running the same variant produces a new run
 * with new evidence, and the previous run's prose must not be written over it.
 */
export function pipelineRunIdOf(result: any): string | null {
  const value = result?.metadata?.pipelineRunId ?? result?.pipelineRunId;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

// ---------------------------------------------------------------------------
// Deep-model evidence: integrated, and reported rather than implied
// ---------------------------------------------------------------------------

/**
 * WHAT THE NARRATIVE IS GIVEN FROM THE DEEP MODELS.
 *
 * `integrated: true` means the observations below actually reach the prompt: `deepEvidencePromptBlock`
 * renders them into `performGeminiAnalysis`'s prompt, the route validates the payload with
 * `deepModelEvidenceSchema` before forwarding it, and `context`/`NARRATIVE_EVIDENCE_CONTRACT_VERSION`
 * make the fact checkable rather than claimed. The `sources` list is the projection's own label map, so
 * the Insights rail cannot advertise a model the prompt block does not print.
 *
 * It is still NOT a claim that these predictions are evidence of disease: the prompt block states, in
 * the model's own instructions, that they are correlated computational observations and that no ACMG
 * criterion may be created from them. `deepEvidenceIntegrated` on each stamp records what the run that
 * wrote a given narrative was actually given.
 */
export const NARRATIVE_DEEP_EVIDENCE = {
  integrated: true,
  sources: DEEP_EVIDENCE_SOURCE_LABELS,
} as const;

export interface NarrativeDeepEvidenceStatus {
  /** Whether a synthesis is given these observations at all (see `NARRATIVE_DEEP_EVIDENCE`). */
  integrated: boolean;
  /**
   * The models whose results this run carries and the prompt therefore NAMES, by the projection's own
   * labels. Includes engines that returned nothing: the prompt block lists those explicitly so the
   * model cannot infer a value for them.
   */
  present: string[];
  /** Present observations a synthesis would still not describe — always empty while integrated. */
  excluded: string[];
}

export function narrativeDeepEvidenceStatus(
  result: any,
  context?: DeepEvidenceContext
): NarrativeDeepEvidenceStatus {
  const evidence = deepModelEvidenceFor(result, context);
  // `present` is what the PROMPT carries, so it is the block's own predicate and not a second guess at
  // "does this result look like it has deep evidence".
  const present = evidence.observations.map(observation => observation.source);
  return {
    integrated: NARRATIVE_DEEP_EVIDENCE.integrated,
    present,
    excluded: NARRATIVE_DEEP_EVIDENCE.integrated ? [] : present,
  };
}
