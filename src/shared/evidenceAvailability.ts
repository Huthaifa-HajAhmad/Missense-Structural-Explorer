/**
 * evidenceAvailability.ts — why an evidence source has no value, and whether anyone can fix it.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The pipeline can decline to produce a score for at least five different reasons, and they demand
 * opposite responses from the user:
 *
 *   • the coordinate's genome build is not one the source serves   → nothing anyone can do
 *   • the source holds no record of this variant                   → nothing anyone can do
 *   • no credential is configured, or the one supplied was refused → go to Settings
 *   • the provider is down, slow, or answered badly                → retry later
 *   • it is still running                                          → wait
 *
 * Before this module, each surface decided which of those to *say* at render time, from whatever was
 * locally in scope. That produced the family of defects this module exists to end: an AlphaGenome
 * panel reporting "Awaiting API key for exact rank" when the key was configured and verified and the
 * real reason was a GRCh38-only gate refusing a GRCh37 coordinate (standby RCA §1, unmapping defect
 * F-13/F-14); a splicing card collapsing the two absences into a hand-written ternary, which
 * silently mislabelled every provider error as a missing binary.
 *
 * The root cause was never a wrong string. It is that **absence was not a typed concept**, so a
 * surface could render *some* absence word without ever being asked which absence it meant.
 *
 * WHAT IT GUARANTEES
 * ------------------
 * 1. `userActionable` is computed, not asserted. A surface offers "Configure an API key" only when
 *    the resolver says a credential is what is missing.
 * 2. Every label is `ENGINE_STATE_LABELS[...]` from `engineStatus.ts`. This module adds **no new
 *    user-facing vocabulary** — it is a routing layer over the canonical one. That is enforced, not
 *    merely claimed: this file is listed in `GUARDED_SURFACES`
 *    (`src/components/__tests__/energeticsLabels.guard.test.ts`), so a status literal added here
 *    fails CI.
 * 3. A real value outranks every absence signal (`engineStatus.ts`'s own rule: a value is
 *    information even when a flag says the run was imperfect). And a measured `0` is a value —
 *    conflating zero with absent is what made 18 SHAP cards read as unmeasured when the model had
 *    attributed exactly nothing to that layer.
 * 4. **Evidence strength is ordered, and the order is the design.** A provider's own definitive
 *    statement about a variant outranks a client-side settings flag, because the flag is a
 *    local belief and the message is a remote fact. Getting that backwards is how a permanent
 *    coverage miss gets advertised as a credential problem — the same defect this module exists to
 *    end, arriving from the opposite direction. See the branch comments.
 *
 * EVIDENCE STRENGTH, strongest first:
 *   a value → in flight → a recorded build refusal → the provider's own coverage statement
 *   → the provider's own credential statement → the local configuration flag → a provider fault
 *   → no result.
 *
 * BOUNDARY CONTRACT
 * -----------------
 * Imported by `src/` surfaces. Pure: imports only from `src/shared/` (enforced by
 * scripts/check-boundaries.ts). Consumes `conservationData.assemblyRefusals`, which the server
 * populates via `describeAssemblyRefusal` (see assembly.ts).
 */
import { ENGINE_STATE_LABELS, type EngineState, type EngineTone } from "./engineStatus.ts";
import type { AssemblyRefusalSource } from "./assembly.ts";

/** The five ways a source can have no value, plus the one way it does. */
export type EvidenceAvailabilityState =
  | "available"
  | "pending"
  | "not-covered"
  | "not-configured"
  | "upstream-error"
  | "no-result";

/**
 * Each state's canonical engine state, so its label and tone come from `engineStatus.ts` rather
 * than from a string written here. `not-configured` maps to `not-installed` ("Not available here"),
 * which is that state's documented meaning: not provisioned in this deployment, operator-fixable.
 */
const STATE_TO_ENGINE_STATE: Record<EvidenceAvailabilityState, EngineState> = {
  available: "computed",
  pending: "running",
  "not-covered": "not-covered",
  "not-configured": "not-installed",
  "upstream-error": "upstream-error",
  "no-result": "no-result",
};

/**
 * Tone per state. `STATE_TONES` in engineStatus.ts is module-private, so this restates the same
 * intent rather than the same strings — labels stay single-sourced, which is the part the guard
 * actually polices. `not-covered` is `muted`, not `warn`: a source declining a build it never
 * claimed to support is not a fault, and colouring it as one invites the user to go fix it.
 */
const STATE_TONES: Record<EvidenceAvailabilityState, EngineTone> = {
  available: "good",
  pending: "neutral",
  "not-covered": "muted",
  "not-configured": "muted",
  "upstream-error": "warn",
  "no-result": "warn",
};

/**
 * The provider said this variant is outside its index.
 *
 * Deliberately the SAME narrow test the server applies — `message.includes("not indexed")`, see
 * `analysis-orchestrator.ts` and `alphagenome-bridge.ts` — rather than a broader family of
 * "no record / not found" phrasings. An earlier revision matched `no (?:record|entry)` and
 * `not (?:found|present)`, which is unsafe in two ways at once:
 *
 *   • a transient provider text such as "no record of this job id yet, poll again" was read as a
 *     permanent coverage miss, telling the user "no setting changes this" when a retry would work;
 *   • the UI and the cache predicate then disagreed about the same payload, so the panel said
 *     "Not covered" while the server discarded and re-ran the analysis on every view — the exact
 *     thrash the cache fix was written to stop.
 *
 * Matching the server exactly makes both impossible, and makes the two readers provably agree.
 */
const PROVIDER_REPORTS_NOT_INDEXED = "not indexed";

/**
 * The provider rejected, or could not find, the credential. These are actionable — unlike a
 * coverage miss — but the action is Settings, not "try again".
 *
 * Each alternand corresponds to a string this codebase actually produces:
 * `alphagenome-client.ts` ("… API Key is invalid or expired.", "… lacks permission to query
 * Atlas."), `alphagenome-bridge.ts` ("… Key Required / Standby", "… endpoint not configured").
 * Without this branch a 401 or a PERMISSION_DENIED fell through to `upstream-error` and offered a
 * retry, which cannot fix a bad key — the user re-evaluates forever.
 */
const PROVIDER_REPORTS_CREDENTIAL_FAULT =
  /key required|api key is (?:invalid|expired)|invalid or expired|lacks permission|endpoint not configured|not configured/i;

/** Non-blank in the sense that matters: there is something to render. */
function text(v: string | null | undefined): string | null {
  return v && v.trim().length > 0 ? v : null;
}

/**
 * A source's own reported status.
 *
 * Widened beyond AlphaGenome's three values deliberately. The first revision typed this as
 * `"live" | "unavailable" | "pending" | null`, which is AlphaGenome's contract — so GPN-Star, whose
 * `gpnStarStatus` also carries `"token_required"` (`contracts.ts`), could not call this module at
 * all and would have had to re-grow the hand-written ternary the module exists to replace. A module
 * that only accepts one source's vocabulary recreates the defect one source later.
 *
 * The known values are enumerated for autocomplete and refactoring; the `(string & {})` arm keeps
 * the union open to statuses this file has not met yet without collapsing to plain `string`.
 */
export type SourceStatus =
  | "live"
  | "unavailable"
  | "pending"
  | "token_required"
  | "complete"
  | "error"
  | (string & {});

export interface EvidenceAvailabilityInput {
  /**
   * The measured value, or `null`/`undefined` when there is none.
   *
   * This is a VALUE, not a boolean, on purpose. The first revision took `hasValue: boolean` and two
   * call sites immediately derived it differently from the same payload — one counted any non-null
   * score, the other required `status === "live"` as well — so two panels could make opposite claims
   * about one variant. Passing the value makes that disagreement unrepresentable, and it is what
   * lets "a measured 0 is a value" be enforced here rather than entrusted to each caller.
   *
   * `NaN` is not a value: a non-numeric score is a broken measurement, not a zero.
   */
  value?: number | null | undefined;
  /** The source's own status from the payload, when it produced one at all. */
  status?: SourceStatus | null;
  /**
   * The recorded build-gate refusal for this source, if any. Truthy means the pipeline declined to
   * ask, which is a different fact from "asked and got nothing".
   */
  refusal?: string | null;
  /**
   * Whether a credential or endpoint is configured for this source. Pass `undefined` when the
   * surface genuinely cannot know: the resolver then never infers "not-configured" from the flag
   * alone, because guessing at configuration is how the original false cause was produced. It is
   * also the *weakest* signal here — the server may hold a key the browser has never seen.
   */
  configured?: boolean;
  /** The provider's message, when it returned one. */
  message?: string | null;
  /** A request is in flight for this source. */
  pending?: boolean;
}

export interface EvidenceAvailability {
  state: EvidenceAvailabilityState;
  /** Canonical label from `ENGINE_STATE_LABELS`. `null` when a value is present — render the value. */
  label: string | null;
  /** The most specific explanation available, or `null`. Safe to render verbatim. */
  reason: string | null;
  tone: EngineTone;
  /** Whether the user can do anything about the absence. Gate every call-to-action on this bit. */
  userActionable: boolean;
  /** Where to send the user, or `null` when there is nowhere to go. */
  action: "configure-credentials" | "retry" | null;
  /** True when a value exists and the surface should render it. */
  hasValue: boolean;
}

/**
 * Decide what to tell the user about an absent evidence value.
 *
 * Branch order encodes evidence strength and is not arbitrary — see "EVIDENCE STRENGTH" at the top
 * of this file. Each step down is a weaker source of truth about why nothing is here.
 */
export function resolveEvidenceAvailability(input: EvidenceAvailabilityInput): EvidenceAvailability {
  const { value = null, status = null, refusal = null, configured, message = null, pending = false } = input;

  const hasValue = value !== null && value !== undefined && !Number.isNaN(value);
  const providerMessage = text(message);
  const recordedRefusal = text(refusal);

  const build = (
    state: EvidenceAvailabilityState,
    reason: string | null,
    userActionable: boolean,
    action: EvidenceAvailability["action"],
  ): EvidenceAvailability => ({
    state,
    label: state === "available" ? null : ENGINE_STATE_LABELS[STATE_TO_ENGINE_STATE[state]],
    reason,
    tone: STATE_TONES[state],
    userActionable,
    action,
    hasValue,
  });

  // 1. A value is a value. Nothing below may outrank it, including a failure flag.
  if (hasValue) return build("available", null, false, null);

  // 2. In flight, with a route to completion.
  if (pending || status === "pending") return build("pending", null, false, null);

  // 3. The build gate declined the coordinate. Nothing anyone can do.
  if (recordedRefusal) return build("not-covered", recordedRefusal, false, null);

  // 4. The provider states the variant is outside its index. Also nothing anyone can do — and this
  //    MUST precede the configuration check below. A client-side `configured` flag is a local
  //    belief; the provider's own sentence about this variant is a remote fact. Testing the flag
  //    first produced "Not available here — configure an API key" glued to "Variant not indexed in
  //    AlphaGenome Atlas", which is the module's own defect class reintroduced from the other side.
  if (providerMessage && providerMessage.includes(PROVIDER_REPORTS_NOT_INDEXED)) {
    return build("not-covered", providerMessage, false, null);
  }

  // 5. The provider rejected or could not find the credential. Actionable, and the action is
  //    Settings — not a retry, which cannot fix a bad key.
  if (providerMessage && PROVIDER_REPORTS_CREDENTIAL_FAULT.test(providerMessage)) {
    return build("not-configured", providerMessage, true, "configure-credentials");
  }

  // 6. Nothing stronger says otherwise, and the caller KNOWS no credential is configured.
  //    Strict equality: only a literal `false` may make this claim.
  if (configured === false) return build("not-configured", providerMessage, true, "configure-credentials");

  // 7. The source answered successfully and still produced no value. There is no fault to report
  //    and no remedy to offer, so do not invent one.
  if (status === "live") return build("no-result", providerMessage, false, null);

  // 8. A provider fault, evidenced by an actual message. A bare `status: "unavailable"` with nothing
  //    to say is NOT this — that default is what zod hands back for an absent field, and calling it
  //    "Provider error" asserts a third party failed on no evidence.
  if (providerMessage && status === "unavailable") {
    return build("upstream-error", providerMessage, true, "retry");
  }

  // 9. The honest dead end: asked, answered nothing, no cause known. This is the state
  //    engineStatus.ts created `no-result` for, in place of a word that implied waiting.
  return build("no-result", providerMessage, false, null);
}

/**
 * The recorded refusal reason for one source out of `conservationData.assemblyRefusals`.
 *
 * `source` is the typed `AssemblyRefusalSource`, not a free string. The first revision took
 * `string`, and a mistyped or mis-cased name (`"AlphaGenome"`) returned `null` silently — the
 * resolver then saw no refusal and fell through to a credential verdict, which is precisely the
 * false cause this module exists to prevent. The compiler now refuses the typo instead of
 * producing a wrong clinical sentence.
 */
export function refusalReasonFor(
  refusals: ReadonlyArray<{ source: string; reason: string }> | null | undefined,
  source: AssemblyRefusalSource,
): string | null {
  if (!refusals || refusals.length === 0) return null;
  const found = refusals.find(r => r.source === source)?.reason ?? null;
  // Humanised here rather than at each render site: one refusal sentence is consumed by a badge
  // title, an explanation block and a provenance list, and fixing the wording in three places is
  // how one of them drifts.
  return found ? humaniseRefusal(source, found) : null;
}

/**
 * One call for a surface: read the refusal and classify in the same expression.
 */
export function resolveSourceAvailability(
  input: Omit<EvidenceAvailabilityInput, "refusal"> & {
    refusals: ReadonlyArray<{ source: string; reason: string }> | null | undefined;
    source: AssemblyRefusalSource;
  },
): EvidenceAvailability {
  const { refusals, source, ...rest } = input;
  return resolveEvidenceAvailability({ ...rest, refusal: refusalReasonFor(refusals, source) });
}

/**
 * Human names for the sources that can record a refusal.
 *
 * `describeAssemblyRefusal` composes its sentence from the internal source key — "alphagenome
 * covers GRCh38 / hg38; this coordinate is GRCh37 / hg19 and was not scored." That is the right
 * string for a log and the wrong one for a panel headed "Evidence Lineage" or "ClinGen SVI
 * Evidence": it puts a lowercase machine token in clinical prose, which is the same class of leak
 * the audit flagged for the raw tab id. The server keeps emitting its machine-readable wording;
 * surfaces render this.
 */
const REFUSAL_SOURCE_DISPLAY: Record<AssemblyRefusalSource, string> = {
  alphagenome: "AlphaGenome Atlas",
  "gpn-star": "GPN-Star",
  popEVE: "PopEVE",
  "splice-proximity": "Splice-junction geometry",
};

/**
 * Rewrite a recorded refusal so it reads as prose rather than as a log line.
 *
 * Falls through unchanged when the reason does not begin with the source key, so a reworded server
 * sentence degrades to the raw text rather than being mangled.
 */
export function humaniseRefusal(source: AssemblyRefusalSource, reason: string): string {
  const display = REFUSAL_SOURCE_DISPLAY[source];
  return reason.startsWith(source) ? display + reason.slice(source.length) : reason;
}

/**
 * The same, for a reason already in hand without its source — used by surfaces that received the
 * string through the resolver rather than straight off `assemblyRefusals`.
 */
export function humaniseAnyRefusal(reason: string | null): string | null {
  if (!reason) return reason;
  for (const source of Object.keys(REFUSAL_SOURCE_DISPLAY) as AssemblyRefusalSource[]) {
    if (reason.startsWith(source)) return humaniseRefusal(source, reason);
  }
  return reason;
}

/**
 * The sentence to render when a value is absent.
 *
 * Deliberately does not invent a cause when none is known: `reason` is only ever the server's
 * recorded refusal or the provider's own message, so what the UI says about why something is
 * missing is always something the pipeline actually established.
 *
 * STATUS — canonical formatter, currently unconsumed (kept deliberately, not dead by neglect).
 * Every present surface renders the state badge and the reason as SEPARATE elements, and two of
 * them (AlphaGenomeTab, SplicingTab) add wording this one-liner cannot: "No AVI score reached
 * this variant (Not covered)". Using this helper there would collapse a richer sentence into
 * `label. reason` and double the label already shown on the badge. It stays exported as the
 * canonical single-sentence form for a surface that has room for one line and no badge — the
 * "wire it in or delete it" rule is satisfied by this note plus its three-state tests; deleting
 * it would only remove the assertions that pin the states it describes.
 */
export function describeAbsence(availability: EvidenceAvailability): string {
  if (availability.hasValue) return "";
  const { label, reason } = availability;
  return reason ? `${label}. ${reason}` : (label ?? "");
}
