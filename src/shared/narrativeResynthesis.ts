/**
 * narrativeResynthesis.ts — the parts of re-synthesizing a narrative that more than one surface, and
 * more than one hook instance, must agree on.
 *
 * WHY THIS EXISTS
 * ---------------
 * Re-synthesis is reachable from the Report inspector, the Residue Shifts inspector and the Insights
 * rail. Every one of those is a separate `useNarrativeResynthesis()` instance, and each instance used
 * to own two pieces of shared state privately:
 *
 *   1. its own in-flight promise, so two surfaces could run two syntheses of the same variant at
 *      once — two provider bills, and whichever answered last won the store;
 *   2. a `finally` that cleared the store's `isNarrativeLoading` flag unconditionally, so an older
 *      request finishing after a newer one had started cleared the newer one's spinner and told the
 *      reader synthesis had stopped while it was still running.
 *
 * `inFlightRef` per hook cannot fix (1) and per-hook `finally` cannot fix (2): both are properties of
 * the *set* of instances, not of one. So the registry below is module-scoped — the smallest scope that
 * contains the fact.
 *
 * It also owns the merge, because the two install paths had drifted: the hook spread the response over
 * the previous insights (keeping fields the response does not carry, including AI-authored ones) while
 * the pipeline path named each field it kept (dropping `model` and `source`). One synthesis, two
 * renderings, decided by which control the reader pressed. `mergeNarrativeFields` is now the only
 * writer, so the rule — *a degraded install never inherits AI provenance, and an AI-authored field is
 * never inherited across a pass* — is stated once and tested once.
 *
 * Deliberately dependency-free (enforced by `scripts/check-boundaries.ts`).
 */
import { withNarrativeEvidenceStamp, type NarrativeEvidenceStamp } from "./narrativeEvidence.ts";

// ---------------------------------------------------------------------------
// Narrative activity — who owns the loading flag
// ---------------------------------------------------------------------------

let activitySequence = 0;
const outstandingActivities = new Set<number>();

/**
 * Claim an activity token. The caller must pair it with `endNarrativeActivity` in a `finally`.
 *
 * Every writer of the store's narrative flag takes a token: the automatic pass
 * (`narrativeService`), and the owner of a resynthesis flight. A *joiner* falls outside this on
 * purpose — the owner's token already describes the work the joiner is waiting for, and a joiner that
 * took a token would keep the flag raised after its own release with nothing left to clear it.
 */
export function beginNarrativeActivity(): number {
  const token = ++activitySequence;
  outstandingActivities.add(token);
  return token;
}

/**
 * Release a token. Returns whether the narrative flag may now be cleared — true only when NOTHING is
 * outstanding.
 *
 * This is the fix for the stale `finally`: a request that finishes while a newer one is still running
 * gets `false` and leaves the flag alone. Testing "am I the newest token" instead would clear the flag
 * whenever the newest request happened to finish first, which reads as "narrative synthesis has
 * stopped" while an older request is still on the wire.
 */
export function endNarrativeActivity(token: number): boolean {
  outstandingActivities.delete(token);
  return outstandingActivities.size === 0;
}

export function narrativeActivityOutstanding(): boolean {
  return outstandingActivities.size > 0;
}

/** Test seam: module scope outlives a test file's cases otherwise. */
export function resetNarrativeActivity(): void {
  outstandingActivities.clear();
}

// ---------------------------------------------------------------------------
// Shared flights — one synthesis per identity+evidence, whoever asks
// ---------------------------------------------------------------------------

export interface NarrativeFlightHandle {
  /** The one promise for this key. Resolves when the owner's work settles; never rejects. */
  promise: Promise<void>;
  /** True for the caller that started the work, false for one that joined an existing flight. */
  owner: boolean;
  signal: AbortSignal;
  /**
   * Detach this caller. Aborts the request only when the LAST caller detaches mid-flight, so one
   * surface unmounting cannot cancel a synthesis another surface is still waiting for.
   */
  release(): void;
}

interface NarrativeFlightRecord {
  promise: Promise<void>;
  controller: AbortController;
  subscribers: number;
  settled: boolean;
  /**
   * The activity token this flight holds.
   *
   * Held by the FLIGHT, not by each participant: one synthesis is one activity, whatever number of
   * surfaces are waiting on it. A token per participant would let a joiner's release keep the flag
   * raised after the only real work had finished.
   */
  activityToken: number;
}

const flights = new Map<string, NarrativeFlightRecord>();

/**
 * The coalescing key: identity plus the evidence revision.
 *
 * The revision is in the key so two asks that would produce *different* narratives never share one
 * request. Joining a flight for older evidence would install prose written from an evidence set the
 * reader has already moved past, and stamping it as such is only honest if the request was actually
 * made for that set.
 *
 * The RUN is in the key for the same reason, one level up: re-analysis of one variant produces a new run
 * whose evidence can be byte-identical to the previous run's (same ClinVar record, same ΔΔG, same
 * sequence). Without the run id those two have the same identity AND the same revision, so run B would
 * join run A's flight — and then A's install refuses B (the writer's identity guard compares
 * `pipelineRunId`), or A's run signal aborts the shared call. Either way B is left with no narrative:
 * the spinner resolves, nothing arrives, and the run that asked second never gets a synthesis of its
 * own. Two runs are two syntheses, whichever of them asked first.
 *
 * A payload that declares no run id still coalesces with another payload that declares none — the
 * segment is simply empty — so a result without run metadata keeps exactly the behaviour it had.
 */
export function narrativeFlightKey(
  identity: { gene?: string | null; variant?: string | null; uniprotId?: string | null },
  revision: string,
  pipelineRunId?: string | null
): string {
  const gene = (identity.gene || "").trim().toUpperCase();
  const variant = (identity.variant || "").trim().toLowerCase();
  const uniprot = (identity.uniprotId || "").trim().toUpperCase();
  const run = typeof pipelineRunId === "string" ? pipelineRunId.trim() : "";
  return `${gene}|${variant}|${uniprot}|${run}|${revision}`;
}

/**
 * Start, or join, the synthesis for `key`.
 *
 * `work` receives the flight's own signal and MUST settle rather than reject: its promise is shared
 * with every joiner, and a rejection raised by one caller's provider error is not something the other
 * waiters asked for. The registry logs a stray rejection and resolves the shared promise regardless.
 */
export function acquireNarrativeFlight(
  key: string,
  work: (signal: AbortSignal) => Promise<void>
): NarrativeFlightHandle {
  const existing = flights.get(key);
  if (existing) {
    existing.subscribers += 1;
    return makeHandle(existing, false);
  }

  const controller = new AbortController();
  const record: NarrativeFlightRecord = {
    promise: Promise.resolve(),
    controller,
    subscribers: 1,
    settled: false,
    activityToken: beginNarrativeActivity(),
  };

  record.promise = (async () => {
    try {
      await work(controller.signal);
    } catch (err) {
      console.error(`[NarrativeFlight] synthesis for ${key} rejected`, err);
    } finally {
      record.settled = true;
      endNarrativeActivity(record.activityToken);
      if (flights.get(key) === record) flights.delete(key);
    }
  })();

  flights.set(key, record);
  return makeHandle(record, true);
}

function makeHandle(record: NarrativeFlightRecord, owner: boolean): NarrativeFlightHandle {
  let released = false;
  return {
    promise: record.promise,
    owner,
    signal: record.controller.signal,
    release() {
      if (released) return;
      released = true;
      record.subscribers = Math.max(0, record.subscribers - 1);
      if (record.subscribers === 0 && !record.settled) {
        try {
          record.controller.abort();
        } catch {
          // An AbortController whose signal is already aborted throws nothing; defensive.
        }
      }
    },
  };
}

/** Test seam, and a diagnostic: how many syntheses are on the wire right now. */
export function narrativeFlightsInFlight(): number {
  return flights.size;
}

/** Test seam: drop every flight without aborting it, releasing the activity each one holds. */
export function resetNarrativeFlights(): void {
  for (const record of flights.values()) {
    endNarrativeActivity(record.activityToken);
  }
  flights.clear();
}

// ---------------------------------------------------------------------------
// Installing a narrative
// ---------------------------------------------------------------------------

/**
 * The result fields a narrative install OWNS.
 *
 * Everything else on the result — the structures, the energetics, the population evidence, the
 * service statuses, and whatever deep-model stages add while a synthesis is in flight — belongs to the
 * run, and an install must copy it forward from the LATEST result rather than from the snapshot the
 * request was built from. That snapshot overwrite is what let a slow synthesis land an older result on
 * top of newer evidence.
 */
export const NARRATIVE_OWNED_RESULT_FIELDS = [
  "analysis",
  "isFallback",
  "fallbackReason",
  "fallbackMessage",
  "fallbackRetryable",
  "providerDetail",
  "attemptedModels",
] as const;

/**
 * The narrative stage's outcome, in the pipeline's own stage vocabulary
 * (`metadata.pipelineStages` — see `contracts.ts`).
 *
 * `running` is written when a real synthesis starts; the terminal outcomes come from the ACTUAL result:
 *
 *   complete  an AI narrative was installed;
 *   degraded  the route returned a rule-based report (a provider fallback: overload, quota, a rejected
 *             key, a cancelled request) — the report exists and is usable, the synthesis did not run;
 *   error     the request produced nothing at all (a transport failure or a timeout), so the stage
 *             itself failed.
 *
 * That is the distinction a reader needs and the one the console used to lose: "the model was busy" and
 * "the request never arrived" are different facts, and neither is "the narrative is fine".
 */
export type NarrativeStageOutcome = "running" | "complete" | "degraded" | "error";

/**
 * Record the narrative stage's outcome on a result, preserving sibling stages and every other metadata
 * field.
 *
 * ONE writer for the stage, because `metadata.pipelineStages` is shared: the core, landscape, structural
 * and literature stages are written by other modules, and a narrative install that replaced the whole map
 * would erase the record of work that did happen. The narrative's own evidence stamp
 * (`metadata.narrativeEvidence`) survives for the same reason.
 *
 * Deliberately NOT part of the narrative evidence contract: the stage outcome describes how the synthesis
 * went, and the evidence revision describes what it was given. Hashing the outcome would make the
 * revision change as a consequence of writing it — an install that invalidated itself, and a narrative
 * that reported itself outdated the instant it landed.
 */
export function withNarrativeStageOutcome<T extends { metadata?: any }>(
  result: T,
  outcome: NarrativeStageOutcome
): T {
  return {
    ...result,
    metadata: {
      ...(result?.metadata ?? {}),
      pipelineStages: { ...(result?.metadata?.pipelineStages ?? {}), narrative: outcome },
    },
  };
}

/** The narrative-authored fields of `insights`. */
export interface NarrativeInstallFields {
  analysis?: string | null;
  isFallback: boolean;
  fallbackReason?: string | null;
  fallbackMessage?: string | null;
  fallbackRetryable?: boolean | null;
  providerDetail?: string | null;
  attemptedModels?: string[] | null;
  /** The response's `insights` (already reconciled server-side), or null when there was none. */
  insights?: Record<string, any> | null;
  /** How this install ends the narrative stage (see `NarrativeStageOutcome`). */
  stageOutcome: Exclude<NarrativeStageOutcome, "running">;
}

/** The route's narrative response body, as far as this client understands it. */
export interface NarrativeResponsePayload {
  analysis?: string | null;
  isFallback?: boolean | null;
  fallbackReason?: string | null;
  fallbackMessage?: string | null;
  fallbackRetryable?: boolean | null;
  providerDetail?: string | null;
  attemptedModels?: string[] | null;
  insights?: Record<string, any> | null;
}

/**
 * Turn a response body into install fields.
 *
 * `degraded` is the caller's verdict from the shared vocabulary (`isFallbackNarrative` /
 * `narrativeFallback`), not a second reading of `isFallback` here: the client derives degradation from
 * the flag, the reason code and the prose, and a payload that fails to parse arrives with prose and no
 * flag at all.
 */
export function narrativeFieldsFromResponse(
  payload: NarrativeResponsePayload,
  degraded: boolean
): NarrativeInstallFields {
  return {
    analysis: payload?.analysis ?? "",
    isFallback: degraded,
    fallbackReason: payload?.fallbackReason ?? undefined,
    fallbackMessage: payload?.fallbackMessage ?? undefined,
    fallbackRetryable: payload?.fallbackRetryable ?? undefined,
    providerDetail: payload?.providerDetail ?? undefined,
    attemptedModels: payload?.attemptedModels ?? undefined,
    insights: degraded ? stripProvenance(payload?.insights) : payload?.insights ?? null,
    // A response always means the stage produced something: a model's narrative, or the route's
    // rule-based report. Only the absence of a response is an `error`.
    stageOutcome: degraded ? "degraded" : "complete",
  };
}

/**
 * Turn a transport-level failure into install fields.
 *
 * The report stays a clinical document: the prose names the degradation, and the provider's own error
 * text travels in `providerDetail` (diagnostics), never inside the narrative a curator reads.
 *
 * The stage ends as `error`, not `degraded`: nothing came back, so the narrative step itself failed. A
 * provider that answered with a rule-based report is the `degraded` case
 * (`narrativeFieldsFromResponse`), and the two must not be collapsed — one is a report the run produced
 * without a model, the other is a step that never produced a report.
 */
export function narrativeFieldsFromTransportFailure(providerDetail: string): NarrativeInstallFields {
  return {
    analysis: [
      "### Clinical Narrative Unavailable",
      "",
      "The narrative synthesis request did not complete, so this report contains the " +
        "database-derived evidence and rule-based ACMG/AMP assessment only.",
      "",
      "Use **Re-synthesize** to retry, or check the **Console** tab for the underlying request error.",
    ].join("\n"),
    isFallback: true,
    fallbackReason: "SERVICE_UNAVAILABLE",
    fallbackMessage: "The narrative request did not complete. The rule-based evidence below is unaffected.",
    fallbackRetryable: true,
    providerDetail,
    attemptedModels: undefined,
    insights: null,
    stageOutcome: "error",
  };
}

/**
 * Drop AI provenance from a degraded response's insights.
 *
 * The route already `delete`s `model` and stamps `source: "rule_based"` on a fallback, but it does so
 * only `if (analysisResult.insights)` — and it returns an insights object either way, so a payload can
 * reach here with a rule-based body and no provenance at all. Clearing here as well means the rule
 * cannot depend on a branch in another process that the two sides have to keep in step.
 *
 * `plausibility` is cleared for the same reason the route's degraded prose says "Not synthesized": it
 * is the one field the Insights card renders as "AI-Generated Plausibility Reasoning", so leaving a
 * previous pass's paragraph in place prints AI prose under a rule-based status strip.
 */
function stripProvenance(insights: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!insights || typeof insights !== "object") return null;
  const { model: _model, plausibility: _plausibility, ...rest } = insights;
  void _model;
  void _plausibility;
  return { ...rest, source: "rule_based", plausibility: "", model: undefined };
}

/**
 * Merge a narrative install into the LATEST result.
 *
 * `previousResult` must be read at write time (inside the store updater), never captured before the
 * request: the whole point is that evidence which arrived while the synthesis was in flight survives
 * it. Only `NARRATIVE_OWNED_RESULT_FIELDS` and the narrative-authored halves of `insights` are
 * replaced.
 */
export function mergeNarrativeFields(
  previousResult: any,
  fields: NarrativeInstallFields,
  stamp: NarrativeEvidenceStamp
): any {
  const previous = previousResult ?? {};
  const degraded = fields.isFallback === true;

  const merged: any = { ...previous };
  // An install never empties the report: a payload with no prose (a response that failed to parse)
  // leaves the previous document in place rather than replacing it with a blank page.
  merged.analysis =
    typeof fields.analysis === "string" && fields.analysis.length > 0 ? fields.analysis : previous.analysis;
  merged.isFallback = degraded;
  merged.fallbackReason = fields.fallbackReason;
  merged.fallbackMessage = fields.fallbackMessage;
  merged.fallbackRetryable = fields.fallbackRetryable;
  merged.providerDetail = fields.providerDetail;
  merged.attemptedModels = fields.attemptedModels;
  merged.insights = mergeNarrativeInsights({
    previousInsights: previous.insights,
    payloadInsights: degraded ? stripProvenance(fields.insights) : fields.insights,
    degraded,
    ruleBasedInsights: previous.ruleBasedInsights,
  });

  /*
   * The narrative STAGE ends here, and it ends from the actual result rather than from the request's
   * intent: `complete` for a model's narrative, `degraded` for the route's rule-based report, `error`
   * for a request that produced nothing. Sibling stages (`core`, `landscape`, `structural`, `literature`)
   * and the evidence stamp are preserved by `withNarrativeStageOutcome`, so recording this one stage
   * cannot erase the record of work that did happen — including the `degraded` a core-only cache
   * retention wrote earlier, which a successful synthesis must now replace with `complete`.
   */
  return withNarrativeStageOutcome(withNarrativeEvidenceStamp(merged, stamp), fields.stageOutcome);
}

/**
 * The narrative-authored half of `insights`, merged onto the previous pass's object.
 *
 * Two rules, and both are about not mixing two syntheses:
 *
 *   • a DEGRADED install never carries AI provenance — `plausibility` empties, `model` goes, and
 *     `source` reads `rule_based`, whatever the payload said;
 *   • an AI-AUTHORED field is never INHERITED. A response that does not carry `plausibility` (its
 *     structured fields failed to validate, so the route returned prose plus reconciled criteria and
 *     nothing else) must not print the previous pass's plausibility paragraph beside the new prose.
 *     The comparison is `??` rather than `||` for the same reason: an empty string is a statement.
 *
 * Fields that describe the RUN rather than the model — `pathogenicity`, the verdict and the criteria
 * list, which the route reconciles against the rule engine — are preserved, because losing them would
 * strip an ACMG list the report still owes the reader.
 *
 * `acmgCriteria` falls back to an EMPTY list rather than to the rule engine's raw list: the shared view
 * (`acmgCriteriaView`) already prefers a non-empty merged list and falls back to
 * `ruleBasedInsights.acmgCriteria` when it is empty, so an empty list renders the engine's own codes
 * and never a previous synthesis's AI suggestions.
 */
export function mergeNarrativeInsights(input: {
  previousInsights?: Record<string, any> | null;
  payloadInsights?: Record<string, any> | null;
  degraded: boolean;
  ruleBasedInsights?: Record<string, any> | null;
}): Record<string, any> {
  const previous = input.previousInsights ?? {};
  const incoming = input.payloadInsights ?? {};
  const ruleBased = input.ruleBasedInsights ?? {};

  return {
    ...previous,
    biochemicalShift: incoming.biochemicalShift ?? "",
    structuralImpact: incoming.structuralImpact ?? "",
    plausibility: incoming.plausibility ?? "",
    acmgCriteria: incoming.acmgCriteria ?? [],
    acmgVerdict: incoming.acmgVerdict ?? ruleBased.acmgVerdict ?? "",
    partialEvidence: incoming.partialEvidence ?? ruleBased.partialEvidence,
    pathogenicity: incoming.pathogenicity ?? previous.pathogenicity,
    model: input.degraded ? undefined : incoming.model,
    source: input.degraded ? "rule_based" : incoming.source,
  };
}
