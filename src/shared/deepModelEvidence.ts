/**
 * deepModelEvidence.ts — the deep-model results a narrative synthesis may be given, in one bounded,
 * versioned, validated shape.
 *
 * WHY THIS EXISTS
 * ---------------
 * The narrative prompt was given the fast evidence set (ClinVar, predictors, conservation, STRING)
 * and nothing else, while the report beside it displayed FoldX, DynaMut2, DDMut, ThermoMPNN, RaSP and
 * the four protein-language-model evaluations. So the report'sAI narrative could not have considered
 * the deep evidence, and no surface said which of the two facts was true: a reader saw "AI synthesis"
 * over a page containing a ΔΔG the model was never shown. Disclosure alone was the first answer to
 * that; this module is the second — the observations actually reach the prompt.
 *
 * WHAT MAKES IT SAFE
 * ------------------
 * Three things, and each is a property of the layer that owns the fact rather than of this file:
 *
 *   1. VALUES, SIGNS AND BANDS come from `energeticsEvidence.ts` (which is the Energetics surfaces'
 *      own builder) and `perturbationModels.ts` (which is the model-identity registry). Nothing here
 *      re-derives a sign convention, a cut-point or a display name, so a ΔΔG cannot be printed with
 *      one sign in the prompt and another on screen.
 *   2. It is BOUNDED AND VALIDATED. Every string is whitespace-collapsed and truncated, every number
 *      must be finite and within a plausible range, one observation per model id, and the whole
 *      payload is re-validated by `deepModelEvidenceSchema` on the server — an untrusted client
 *      payload cannot grow into a prompt.
 *   3. It is DECLARED, not implied. `DEEP_MODEL_EVIDENCE_VERSION` travels in the narrative evidence
 *      hash, so a narrative written with these observations can never be served for a run without
 *      them; and the prompt block below states, in the model's own instructions, that these are
 *      correlated predictions and not assays, and that no ACMG criterion may be created from them.
 *
 * Deliberately imports only from `src/shared` (enforced by `scripts/check-boundaries.ts`).
 */
import {
  buildEnergeticsEvidence,
  type EnergeticsInputs,
  type EnergeticsReading,
} from "./energeticsEvidence.ts";
import {
  describeProvenance,
  type EngineState,
} from "./engineStatus.ts";
import {
  describeModelRoster,
  extractPerturbationEvaluations,
  type PerturbationEvaluations,
  type PerturbationModelId,
} from "./perturbationModels.ts";
import { RASP_SOURCE_LABEL, type RaspSource } from "./raspIndex.ts";

/**
 * The deep-evidence contract's version.
 *
 * BUMP WHENEVER THE PROJECTION CHANGES — a model added, a bound tightened, a status mapping corrected.
 * It is part of the canonical string the narrative evidence hash is computed over, and part of the
 * payload the prompt schema validates, so a change invalidates narratives written under the previous
 * projection instead of leaving them describing a contract that no longer exists.
 */
export const DEEP_MODEL_EVIDENCE_VERSION = 2;

/** One entry per model, in prompt order. The ids are also the schema's enum. */
export const DEEP_EVIDENCE_MODEL_IDS = [
  "foldx",
  "dynamut2",
  "ddmut",
  "rasp",
  "thermompnn",
  "stabilityoracle",
  "saprot",
  "esm2",
  "esmc",
  "esm3",
] as const;

export type DeepEvidenceModelId = (typeof DEEP_EVIDENCE_MODEL_IDS)[number];

/**
 * The ONE label per model, used by the prompt block AND by the Insights rail's list of what a
 * synthesis was given. A second hand-written list would let the rail claim a source the prompt does
 * not carry — which is exactly the claim this whole module exists to make checkable.
 */
export const DEEP_EVIDENCE_SOURCE_LABELS: Record<DeepEvidenceModelId, string> = {
  foldx: "FoldX folding stability (ΔΔG)",
  dynamut2: "DynaMut2 ΔΔG",
  ddmut: "DDMut ΔΔG",
  rasp: "RaSP ΔΔG (precomputed table)",
  thermompnn: "ThermoMPNN ΔΔG",
  stabilityoracle: "StabilityOracle ΔΔG",
  saprot: "SaProt variant-effect ΔLLR",
  esm2: "ESM-2 variant-effect ΔLLR",
  esmc: "ESM-C variant-effect ΔLLR",
  esm3: "Sequence embedding analysis (ESM3 service)",
};

/** The bounded payload. Validated by `deepModelEvidenceSchema` before it reaches the prompt. */
export interface DeepEvidenceObservation {
  id: DeepEvidenceModelId;
  /** `DEEP_EVIDENCE_SOURCE_LABELS[id]` — the source, as the rail names it. */
  source: string;
  state: EngineState;
  /** Canonical value: positive ΔΔG means destabilizing whichever engine produced it. */
  value: number | null;
  unit: "kcal/mol" | "ΔLLR" | null;
  /** The engine's own band for a counted value ("Destabilizing", "Not counted"), or null. */
  call: string | null;
  /** The engine/deployment that served it, as the payload recorded it, or null. */
  provenance: string | null;
  /** The engine's own factual line (runs, spread, caveat, why absent), or null. */
  note: string | null;
}

export interface DeepModelEvidence {
  version: number;
  observations: DeepEvidenceObservation[];
}

/**
 * The uncertainty bounds. A clinical prompt is not a place for an unbounded payload, and each of these
 * is the point past which the value would no longer be a plausible reading of the source rather than a
 * statement about it. `|ΔΔG| > 1000 kcal/mol` and `|ΔLLR| > 1000` are not measurements; a 240-character
 * engine note is a log line.
 */
export const DEEP_EVIDENCE_BOUNDS = {
  maxObservations: DEEP_EVIDENCE_MODEL_IDS.length,
  maxSourceChars: 64,
  maxCallChars: 48,
  maxProvenanceChars: 160,
  maxNoteChars: 240,
  maxAbsValue: 1000,
} as const;

// ---------------------------------------------------------------------------
// Bounded inputs
// ---------------------------------------------------------------------------

function boundText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function boundedValue(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.abs(value) > DEEP_EVIDENCE_BOUNDS.maxAbsValue ? null : value;
}

/**
 * Everything a deep-evidence projection needs, in the shapes the two owner modules already use.
 *
 * Both are OPTIONAL and both default to empty: a run that produced no deep evidence must still build a
 * valid (empty) payload rather than throw, because the narrative is requested on every analysis.
 */
export interface DeepEvidenceInputs {
  /** Stability side, in the shape the Energetics surfaces use (`buildEnergeticsEvidence`). */
  stability?: EnergeticsInputs | null;
  /** Language-model side, read off the analysis result (`extractPerturbationEvaluations`). */
  evaluations?: PerturbationEvaluations | null;
  saprotEngine?: string | null;
}

/**
 * What an in-app caller can supply that the ANALYSIS RESULT does not carry.
 *
 * The stability values live in the client's biophysics state (and, on the pipeline path, on the
 * biophysical response), not on the analysis result — `createCompletedAnalysisState` never copies them.
 * Rather than have each call site invent its own mapping, this one shape carries them, the store
 * adapter below fills it from either location, and the freshness check takes the same shape so the
 * revision it recomputes is the revision the synthesis recorded.
 */
export interface DeepEvidenceContext {
  stability?: EnergeticsInputs | null;
  saprotEngine?: string | null;
}

/** The store fields the stability supplement reads, from either the slice or `primaryBiophysics`. */
export function deepEvidenceStabilityFromStore(store: any): EnergeticsInputs {
  const primary = store?.primaryBiophysics ?? null;
  const pick = (key: string) => primary?.[key] ?? store?.[key] ?? null;
  return {
    foldingDdG: boundedValue(pick("foldingDdG")),
    foldingEnergetics: pick("foldingEnergetics"),
    foldingStatus: pick("foldingStatus"),
    foldingError: pick("foldingError"),
    dynamut2Status: pick("dynamut2Status"),
    ddmutStatus: pick("ddmutStatus"),
    thermompnnStatus: pick("thermompnnStatus"),
    thermompnnError: pick("thermompnnError"),
    isFolding: Boolean(pick("isFolding")),
    plddt: pick("disruptionPredictor")?.plddt ?? null,
  };
}

/** The context a store-shaped snapshot produces — the same call the hook and a status surface make. */
export function deepEvidenceContextFromStore(store: any, saprotEngine?: string | null): DeepEvidenceContext {
  return { stability: deepEvidenceStabilityFromStore(store), saprotEngine: saprotEngine ?? null };
}

/**
 * The context an ANALYSIS RESULT alone can supply.
 *
 * On the pipeline path the result handed to the narrative is the biophysical response, which carries
 * `energetics` and `ddG` (the stability route's own field names); a replayed cached result carries
 * `foldingEnergetics`. Both are read here so one function describes either payload, and an explicit
 * context (the client's live biophysics state) wins where it is supplied.
 */
export function deepEvidenceContextFromResult(result: any, saprotEngine?: string | null): DeepEvidenceContext {
  const explicit = result?.narrativeEvidenceContext as DeepEvidenceContext | undefined;
  const stability: EnergeticsInputs = {
    foldingDdG: boundedValue(result?.foldingDdG ?? result?.ddG),
    foldingEnergetics: result?.foldingEnergetics ?? result?.energetics ?? null,
    foldingStatus: result?.foldingStatus ?? null,
    foldingError: result?.foldingError ?? null,
    dynamut2Status: result?.dynamut2Status ?? null,
    ddmutStatus: result?.ddmutStatus ?? null,
    thermompnnStatus: result?.thermompnnStatus ?? null,
    thermompnnError: result?.thermompnnError ?? null,
    isFolding: false,
    plddt: result?.disruptionPredictor?.plddt ?? null,
  };
  return {
    stability: { ...stability, ...(explicit?.stability ?? {}) },
    saprotEngine: saprotEngine ?? explicit?.saprotEngine ?? null,
  };
}

// ---------------------------------------------------------------------------
// Building the projection
// ---------------------------------------------------------------------------

function stabilityObservation(reading: EnergeticsReading, structure: string | null): DeepEvidenceObservation {
  const value = boundedValue(reading.ddg);
  /*
   * The note is the engine's own line where it has one (runs, spread, an exclusion), and otherwise its
   * reason/detail — which is how "why is there no value" reaches the prompt instead of a bare absence.
   * Every part is bounded, and all three together are short.
   */
  const note = boundText(
    [reading.note, reading.note ? null : reading.outcome.reason, reading.outcome.detail]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(" · ") || null,
    DEEP_EVIDENCE_BOUNDS.maxNoteChars
  );
  return {
    id: reading.key as DeepEvidenceModelId,
    source: DEEP_EVIDENCE_SOURCE_LABELS[reading.key as DeepEvidenceModelId],
    state: reading.outcome.state,
    value,
    unit: value === null ? null : "kcal/mol",
    // `callLabel` is the engine's own band from its own cut-points, and "Not counted" when the run
    // excluded the value (a failed repair, a missing binary) — a distinction the prompt must see.
    call: value === null ? null : boundText(reading.callLabel, DEEP_EVIDENCE_BOUNDS.maxCallChars),
    provenance: structure,
    note,
  };
}

/**
 * The statuses the model endpoints use for "no reading was produced".
 *
 * Taken from the endpoints themselves (`server/services/external-api/{saprot,esmc,esm2,esm3_forge}.ts`,
 * `structural-model-fetcher.ts`): `offline | timeout | error | invalid_input | token_required`, plus the
 * `unavailable`/`failed` spellings the client's own stages write.
 */
const LM_PLACEHOLDER_STATES: Record<string, EngineState> = {
  // The provider did not answer in time: retryable, and `engineStatus`'s own word for it.
  timeout: "upstream-busy",
  // Not provisioned here, or a credential is missing — the reader/operator can fix it, and the model
  // service simply is not running. `engineStatus`'s "Not available here", not a per-variant failure.
  offline: "not-installed",
  token_required: "not-installed",
  unavailable: "not-installed",
  "not-configured": "not-installed",
  error: "failed",
  invalid_input: "failed",
  failed: "failed",
};

/**
 * A payload that means "no reading", whatever ELSE it carries.
 *
 * This is the guard the projection was missing. A language-model evaluation can arrive with a finite
 * score AND a failure placeholder in the same object — a fallback tier that answered before the
 * configured one failed, a stale score left beside a fresh error, a timeout that closed after partial
 * output. Consulting the score first reported such a row as `computed`, so an errored evaluation reached
 * the prompt (and any telemetry consumer) as a measured one, and `structuralChangeLevel` beside an
 * `error` still emitted a categorical call.
 *
 * A placeholder therefore OUTRANKS every numeric and categorical field: the row's state comes from the
 * placeholder, and its value, unit and call are all dropped. Returns null when the payload carries no
 * placeholder, in which case any reading it holds is genuine.
 */
function lmPlaceholder(data: any): { state: EngineState; note: string } | null {
  if (!data || typeof data !== "object") return null;

  const rawStatus = typeof data.status === "string" ? data.status.trim().toLowerCase() : "";
  // `ok`/`success` are not placeholders; every other explicit status is.
  const status = rawStatus && rawStatus !== "ok" && rawStatus !== "success" ? rawStatus : "";
  /*
   * Only `error` is a placeholder — NOT `hfError`/`remoteEngineNote`/`fallbackReason`, which a SUCCESSFUL
   * payload carries when a fallback tier served it (`saprot.ts` returns them beside a computed `llr`).
   * Treating those as failures would discard a real reading; they belong in the row's note instead, which
   * is where the prompt learns which engine actually answered.
   */
  const error = boundText(data.error ?? null, DEEP_EVIDENCE_BOUNDS.maxNoteChars);
  if (!status && !error) return null;

  const state = LM_PLACEHOLDER_STATES[status] ?? "failed";
  const note = [`no reading returned (${status || "error"})`, error].filter(Boolean).join(": ");
  return { state, note: boundText(note, DEEP_EVIDENCE_BOUNDS.maxNoteChars) ?? "no reading returned" };
}

/**
 * The state of a payload that carries no placeholder: still running, or nothing at all.
 *
 * With placeholders handled before this is reached, the only remaining cases are a loading seed and a
 * genuinely empty row — so this deliberately cannot report `computed`, and cannot be reached with a
 * value in hand.
 */
function lmState(data: any): EngineState {
  if (!data || typeof data !== "object") return "no-result";
  if (data.loading === true) return "running";
  return "no-result";
}

function lmObservation(id: PerturbationModelId | "esm3", data: any, roster?: {
  displayName: string;
  provenance: string | null;
  provenanceAmbiguous: boolean;
  embeddingDim: number | null;
}): DeepEvidenceObservation {
  const source = DEEP_EVIDENCE_SOURCE_LABELS[id];

  /*
   * A failure placeholder ends the projection here, before any score or category is read. The row keeps
   * its SOURCE (which model was asked) and loses everything that would read as a result: no value, no
   * unit, no call, and no "served by" — an errored row does not establish which engine served it.
   */
  const placeholder = lmPlaceholder(data);
  if (placeholder) {
    return {
      id,
      source,
      state: placeholder.state,
      value: null,
      unit: null,
      call: null,
      provenance: null,
      note: placeholder.note,
    };
  }

  if (id === "esm3") {
    const level = typeof data?.structuralChangeLevel === "string" ? data.structuralChangeLevel : null;
    const confidence = typeof data?.confidence?.level === "string" ? data.confidence.level : null;
    const plddt = boundedValue(data?.confidence?.plddt);
    const details = [
      "App-defined embedding band; not structural motion or clinical evidence",
      confidence ? `input structure confidence ${confidence}` : null,
      plddt !== null ? `input pLDDT ${plddt.toFixed(1)}` : null,
    ].filter(Boolean);
    return {
      id,
      source,
      state: level ? "computed" : lmState(data),
      // ESM3 reports a categorical structural-drift band, not a ΔΔG: no number is invented for it.
      value: null,
      unit: null,
      call: level ? boundText(`${level[0].toUpperCase()}${level.slice(1)} embedding shift (app-defined)`, DEEP_EVIDENCE_BOUNDS.maxCallChars) : null,
      provenance: boundText(typeof data?.provenance === "string" ? data.provenance : null, DEEP_EVIDENCE_BOUNDS.maxProvenanceChars),
      note: boundText(details.length ? details.join(" · ") : null, DEEP_EVIDENCE_BOUNDS.maxNoteChars),
    };
  }

  const llr = boundedValue(data?.llr);
  const ambiguous = Boolean(roster?.provenanceAmbiguous);
  /*
   * The tier notes travel with a READING: a fallback tier that answered, or a remote tier that failed
   * while a local one served the number. They are exactly the provenance a prompt must not be allowed to
   * imply it was not given, and they are notes rather than placeholders because the value is real.
   */
  const tierNote = boundText(
    data?.remoteEngineNote ?? data?.hfError ?? data?.fallbackReason ?? null,
    DEEP_EVIDENCE_BOUNDS.maxNoteChars
  );
  return {
    id,
    source,
    state: llr !== null ? "computed" : lmState(data),
    value: llr,
    unit: llr === null ? null : "ΔLLR",
    // No calibrated band is asserted for an LLR: `modelCalibration` defines none, and inventing one
    // here is the hand-waving this projection exists to avoid.
    call: null,
    provenance: boundText(roster?.displayName ?? null, DEEP_EVIDENCE_BOUNDS.maxProvenanceChars),
    note: boundText(
      [
        ambiguous
          ? "Serving model differs from this card's calibration row, so no embedding width is asserted."
          : null,
        tierNote,
      ]
        .filter(Boolean)
        .join(" · ") || null,
      DEEP_EVIDENCE_BOUNDS.maxNoteChars
    ),
  };
}

/**
 * Project deep-model results into the bounded evidence block.
 *
 * Every model in `DEEP_EVIDENCE_MODEL_IDS` yields exactly one observation, INCLUDING the ones that
 * produced nothing. That is deliberate: the prompt is told which engines returned nothing, so it
 * cannot fill the vacuum with a stability claim the run never made — and the narrative's evidence
 * revision moves when a pending engine settles, which is what makes "this narrative predates the
 * ΔΔG on screen" a checkable statement instead of a guess.
 */
export function buildDeepModelEvidence(inputs: DeepEvidenceInputs): DeepModelEvidence {
  const observations: DeepEvidenceObservation[] = [];

  const structure = (() => {
    const provenance = inputs.stability?.foldingEnergetics?.structureProvenance ?? null;
    if (!provenance) return null;
    const view = describeProvenance(provenance.source, {
      pdbId: provenance.pdbId,
      resolution: provenance.resolution,
      identity: provenance.identity,
    });
    const bits = [view.label, view.detail, provenance.foldxVersion ? provenance.foldxVersion : null].filter(Boolean);
    return boundText(bits.join(" · "), DEEP_EVIDENCE_BOUNDS.maxProvenanceChars);
  })();

  const energetics = buildEnergeticsEvidence(inputs.stability ?? {});
  for (const reading of energetics.readings) {
    const id = reading.key as DeepEvidenceModelId;
    const rasp = reading.key === "rasp"
      ? boundText(
          inputs.stability?.foldingEnergetics?.raspSource
            ? RASP_SOURCE_LABEL[inputs.stability.foldingEnergetics.raspSource as RaspSource]
            : null,
          DEEP_EVIDENCE_BOUNDS.maxProvenanceChars
        )
      : null;
    observations.push(stabilityObservation(reading, rasp ?? structure));
  }

  const evaluations = inputs.evaluations ?? {};
  const roster = describeModelRoster(evaluations, inputs.saprotEngine ?? null);
  for (const entry of roster) {
    observations.push(
      lmObservation(
        entry.id,
        evaluations[entry.id],
        {
          displayName: entry.displayName,
          provenance: entry.provenance,
          provenanceAmbiguous: entry.provenanceAmbiguous,
          embeddingDim: entry.embeddingDim,
        }
      )
    );
  }
  observations.push(lmObservation("esm3", evaluations.esm3));

  // One entry per declared id, in the declared order: the projection has a fixed shape, which is what
  // makes two runs comparable and the hash stable against object key order.
  const byId = new Map(observations.map(observation => [observation.id, observation]));
  return {
    version: DEEP_MODEL_EVIDENCE_VERSION,
    observations: DEEP_EVIDENCE_MODEL_IDS.map(id => byId.get(id)).filter(
      (observation): observation is DeepEvidenceObservation => Boolean(observation)
    ),
  };
}

/** The projection for one result object, with whatever supplement the caller's surface holds. */
export function deepModelEvidenceFor(result: any, context?: DeepEvidenceContext): DeepModelEvidence {
  const base = deepEvidenceContextFromResult(result, context?.saprotEngine ?? null);
  return buildDeepModelEvidence({
    stability: { ...(base.stability ?? {}), ...(context?.stability ?? {}) },
    evaluations: extractPerturbationEvaluations(result),
    saprotEngine: context?.saprotEngine ?? base.saprotEngine ?? null,
  });
}

// ---------------------------------------------------------------------------
// Canonical form, and the prompt block
// ---------------------------------------------------------------------------

/**
 * The canonical string of the deep evidence, for the narrative evidence hash.
 *
 * Compact (one array per observation, fixed positions) and ORDER-INSENSITIVE: the rows are emitted in
 * `DEEP_EVIDENCE_MODEL_IDS` order with one entry per id, so a client that lists the same observations
 * differently still hashes to the same evidence, and a duplicated id cannot smuggle in a second value.
 * Every field is bounded and primitive, so a JSON round trip through the request body reproduces this
 * string exactly — which is what lets the client's revision and the server's hashed contract agree.
 */
export function canonicalDeepModelEvidence(evidence: DeepModelEvidence): string {
  const byId = new Map<DeepEvidenceModelId, DeepEvidenceObservation>();
  for (const observation of evidence?.observations ?? []) {
    if (observation && !byId.has(observation.id)) byId.set(observation.id, observation);
  }
  const rows = DEEP_EVIDENCE_MODEL_IDS
    .map(id => byId.get(id))
    .filter((observation): observation is DeepEvidenceObservation => Boolean(observation))
    .map(observation => [
      observation.id,
      observation.state,
      observation.value,
      observation.unit ?? null,
      observation.call ?? null,
      observation.provenance ?? null,
      observation.note ?? null,
    ]);
  return JSON.stringify({ version: evidence?.version ?? null, observations: rows });
}

/** States that carry a reading a model may reason from or must be told about. */
const INFORMATIVE_STATES: ReadonlySet<EngineState> = new Set<EngineState>([
  "computed",
  "running",
  "not-covered",
  "upstream-busy",
  "upstream-error",
  "failed",
]);

function formatValue(observation: DeepEvidenceObservation): string {
  if (observation.value === null) return observation.call ?? "no numeric score";
  const digits = observation.unit === "ΔLLR" ? 3 : 2;
  const sign = observation.value > 0 ? "+" : "";
  return `${sign}${observation.value.toFixed(digits)} ${observation.unit}`;
}
/**
 * THE prompt block. Rendered into the synthesis prompt AND usable by a disclosure, so the model's
 * instructions and the reader's summary are one text.
 *
 * `null` when the run produced nothing informative: an empty block would tell the model it had been
 * given deep evidence it does not have.
 *
 * The wording is load-bearing in three places and each is tested:
 *   • "correlated" and "not assays" — a predicted ΔΔG is not a measured one;
 *   • the no-new-criteria rule — a predicted ΔΔG is not PS3 and a predicted score is not PP3;
 *   • the canonical sign statement — the values have already been normalised, and saying so is what
 *     stops a model reasoning about DynaMut2's native negative sign from the wrong side.
 */
export function deepEvidencePromptBlock(evidence: DeepModelEvidence | null | undefined): string | null {
  if (!evidence || !Array.isArray(evidence.observations)) return null;

  const informative = evidence.observations.filter(observation => INFORMATIVE_STATES.has(observation.state));
  const absent = evidence.observations.filter(observation => !INFORMATIVE_STATES.has(observation.state));
  /*
   * A run in which nothing produced a reading gets NO block at all: a page of "returned nothing" lines
   * would tell the model it was given deep evidence it does not have, and the prompt for such a run must
   * stay byte-identical to the one it built before this integration. The absence line is context for
   * the values that WERE produced, not a standalone statement about the run.
   */
  if (informative.length === 0) return null;

  const lines = informative.map(observation => {
    const parts = [`- ${observation.source}: ${formatValue(observation)}`];
    parts.push(`status: ${observation.state}`);
    // A categorical reading (ESM3's drift band) is already in the value slot, so it is not repeated.
    if (observation.value !== null && observation.call) parts.push(`call: ${observation.call}`);
    if (observation.provenance) parts.push(`served by: ${observation.provenance}`);
    if (observation.note) parts.push(`note: ${observation.note}`);
    return parts.join(" · ");
  });

  const absentLine = absent.length > 0
    ? `- Returned nothing for this run: ${absent
        .map(observation => `${observation.source} (${observation.state})`)
        .join(", ")}. Their absence is not evidence of stability, and no value may be inferred for them.`
    : null;

  return `
[DEEP-MODEL COMPUTATIONAL OBSERVATIONS — correlated predictions, NOT functional assays]:
${[...lines, absentLine].filter(Boolean).join("\n")}

RULES FOR THESE OBSERVATIONS (they are computational predictions, not database evidence):
- Each line is the output of a model run on this variant. NEVER describe one as an assay, a measurement,
  an experiment, a functional study, or an observed protein property. A predicted ΔΔG is not a measured
  stability change, and an ESM/SaProt log-likelihood ratio is not an experimental functional result.
- Do NOT add an ACMG/AMP criterion because of any of them, and do NOT re-state PP3, PS3 or BS3 on their
  account. A predicted ΔΔG is not PS3 evidence and a predicted deleterious score is not PP3 evidence on
  its own. Criteria must be justified by the database evidence above; the rule engine's own criteria are
  applied separately and are not yours to duplicate.
- Magnitudes are comparable only WITHIN one model — a FoldX ΔΔG, a ThermoMPNN ΔΔG and an ESM ΔLLR are
  different quantities. Every ΔΔG shown here is already normalised so that a POSITIVE value means
  destabilizing, whichever sign the provider natively reports.
- An engine listed as returning nothing produced no value for this run; say nothing about what it might
  have shown.
`.trim();
}
