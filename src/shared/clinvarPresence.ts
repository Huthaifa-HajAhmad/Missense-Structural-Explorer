/**
 * clinvarPresence.ts — one classification of "what does this run know about ClinVar for this variant".
 *
 * WHY THIS EXISTS
 * ---------------
 * Four surfaces decided ClinVar's state four different ways, and they disagreed on real runs:
 *
 *   `server/services/llm/gemini.ts`      `uid != null && classification !== "Not found in ClinVar"`
 *   `src/shared/frequencyEvidence.ts`    `/not found/i` on the classification string
 *   `src/components/report/reportStatus.ts`  `.toLowerCase().includes("not found")` on the string
 *   the Insights card / Population rail  `uid != null`
 *
 * Two of those read only the classification string, which cannot distinguish three different
 * situations that all arrive as "no classification": the query failed, the query succeeded and
 * ClinVar holds nothing, and ClinVar holds a submission that records no classification value. The
 * string is absent in all three.
 *
 * The consequence was a live contradiction. On a ClinVar TIMEOUT the narrative prompt said "ClinVar
 * was not queried for this run" and "There is NO ClinVar classification for this variant. This is an
 * ABSENCE OF A RECORD" — a negative clinical claim manufactured from a failed request, written into
 * prose by the model — while the Population rail on the same screen said "The ClinVar query timed
 * out, so this variant's classification could not be read." That is the exact defect
 * `frequencyEvidence.ts` documents and refuses; the prompt reintroduced it one layer down.
 *
 * So the state is derived once, here, from both the record AND the run's per-source status, and every
 * surface consumes this instead of testing for a string.
 *
 * `unread` is the state that matters most: it is the one no classification string can express, and
 * the one every surface must decline to draw a conclusion from.
 *
 * Deliberately dependency-free: `src/shared/` may not import outside itself.
 */

/** The shape both the server's `ClinVarData` and the persisted payload satisfy. */
export interface ClinvarRecordLike {
  classification?: string | null;
  uid?: string | null;
}

/**
 * Per-source fetch outcomes, as `core-data-fetcher.ts` records them in `serviceStatus`.
 *
 * Kept as a loose string map rather than a union because it travels through `z.record(z.string(),
 * z.string())` and a status this module has not seen must be treated as UNKNOWN (declining to make a
 * claim), never as success.
 */
export type ServiceStatusMap = Record<string, string> | null | undefined;

export type ClinvarPresence =
  /** A submission with a usable classification. The only state a classification may be quoted from. */
  | "held"
  /** A submission exists but records no classification value. */
  | "unclassified"
  /** The query succeeded and ClinVar holds nothing for this variant. A real negative. */
  | "recorded-negative"
  /** The query failed, was refused, or is still running. NOT a negative — draw no conclusion. */
  | "unread"
  /** No query was made in this run. NOT a negative either. */
  | "unqueried";

/** Statuses that mean the run did NOT obtain a ClinVar answer. */
const UNREAD_STATUSES = new Set(["timeout", "error", "unsupported-build", "not-configured", "blocked", "pending"]);

/** Statuses that mean the query completed. */
const COMPLETED_STATUSES = new Set(["ok", "not_found"]);

/** A classification value that carries no assertion — a submission that records nothing. */
function hasUsableClassification(classification: string | null | undefined): boolean {
  if (typeof classification !== "string") return false;
  const trimmed = classification.trim();
  if (!trimmed) return false;
  if (/^unknown$/i.test(trimmed)) return false;
  return !/not found/i.test(trimmed);
}

/**
 * Classify the run's ClinVar knowledge.
 *
 * Order is the design. The failure states are tested BEFORE the record, because a status of `timeout`
 * means the record in hand (if any) is stale and must not be quoted as a result; and the negative is
 * tested before the record so the sentinel `"Not found in ClinVar"` — which some producers store in
 * `classification` rather than omitting it — is never mistaken for a classification.
 */
export function clinvarPresence(
  clinvar: ClinvarRecordLike | null | undefined,
  serviceStatus?: ServiceStatusMap,
): ClinvarPresence {
  const status = serviceStatus?.clinvar;

  if (status && UNREAD_STATUSES.has(status)) return "unread";

  const classification = clinvar?.classification;

  if (classification && /not found/i.test(classification)) return "recorded-negative";
  if (status === "not_found") return "recorded-negative";

  if (hasUsableClassification(classification)) return "held";

  // A record that exists but carries no classification value. Distinguished from `recorded-negative`
  // because a submitter DID engage — "no submitter has classified it" would be false here.
  if (clinvar?.uid != null && String(clinvar.uid).length > 0) return "unclassified";

  // The query completed and returned nothing classifiable.
  if (status && COMPLETED_STATUSES.has(status)) return "recorded-negative";

  return "unqueried";
}

/**
 * Whether a classification may be quoted to a reader (or to a model) at all.
 *
 * Only `held`. Every other state is an absence, and `unread`/`unqueried` are absences of EVIDENCE
 * rather than evidence of absence — which is why they must never be rendered as "not in ClinVar".
 */
export function clinvarClassificationIsQuotable(presence: ClinvarPresence): boolean {
  return presence === "held";
}

/**
 * The sentence a surface uses when it has no classification to quote.
 *
 * Returned as a map of state to wording so the prompt and the UI state the same thing, and so a
 * surface cannot invent its own phrasing for `unread` — the state where phrasing is the whole risk.
 */
export const CLINVAR_ABSENCE_SENTENCE: Record<Exclude<ClinvarPresence, "held">, string> = {
  unclassified:
    "ClinVar holds a submission for this variant, but it records no classification value, so no classification can be quoted.",
  "recorded-negative":
    "ClinVar holds no submission for this variant — no submitter has classified it. This is a recorded absence, not an assertion of uncertain significance, and not evidence of benignity.",
  unread:
    "The ClinVar query did not complete for this run, so this variant's classification could not be read. This is a failure to obtain the record, NOT an absence of one: do not conclude that ClinVar holds nothing, and do not quote or infer a classification.",
  unqueried:
    "ClinVar was not queried for this run, so nothing is known about whether it holds this variant. Draw no conclusion about ClinVar either way.",
};
