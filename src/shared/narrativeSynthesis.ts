/**
 * narrativeSynthesis.ts — the facts about the narrative synthesis call that more than one surface
 * has to state, declared once.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Insights rail's "AI Synthesis Telemetry" card stated the inference parameters as literals:
 *
 *     Inference Model:        Clinical LLM Engine
 *     Generation Mode:        Structured Clinical Schema
 *     Sampling Temperature:   0.2 (Deterministic)
 *     Status:                 Inference Ready
 *
 * Every one of those four lines was wrong, and none of them read from anything:
 *
 *   - the call sets `temperature: 0.0` (`server/services/llm/gemini.ts`), not 0.2 — and it is greedy
 *     decoding, so "Deterministic" was attached to a number that was not the one in force;
 *   - the model is a concrete ladder member, recorded on the payload as `insights.model`, and the
 *     card named a category instead;
 *   - "Inference Ready" was a constant: it rendered identically before any synthesis had run, with
 *     no API key configured, and after a failed synthesis, in the one card whose job is to say
 *     whether the prose below it came from a model.
 *
 * That card sits in a *clinical* rail. A parameter printed there is a provenance claim, and a
 * hand-written provenance claim is a claim nothing checks — the failure mode this codebase has
 * already removed from the frequency panel, the model registry and the report manifest. So the
 * temperature lives here, the server imports it rather than repeating it, and the rail renders it.
 *
 * Deliberately dependency-free: `src/shared/` may not import outside itself (enforced by
 * `scripts/check-boundaries.ts`).
 */

/**
 * The narrative PROMPT's schema version, as it appears in the synthesis cache key.
 *
 * BUMP THIS WHENEVER THE PROMPT OR THE RESPONSE SCHEMA CHANGES. It is not a decoration on the key —
 * it is the only thing that invalidates a narrative the previous prompt produced.
 *
 * Why this exists at all: `narrativeCache` is a process-local LRU with a 24-hour TTL
 * (`server/services/infra/cache-registry.ts`), and the key is otherwise a pure function of the inputs —
 * variant, weighting, clinician directions, an evidence hash, the API key and the model. Re-running the
 * SAME variant with the SAME evidence therefore hits the SAME key, so a narrative written under an
 * older prompt is served for as long as that cache entry lives — up to its TTL within one process, and
 * no longer than that, since a deploy starts an empty one. That is exactly the shape of the defect this
 * constant is being introduced alongside: the prompt gained a ClinVar-absence block and a grounding rule
 * because the model had been inventing a ClinVar classification, and every variant already in the cache
 * would have kept serving the invented one (the `schema:v2` marker had been left behind by earlier
 * prompt edits too).
 *
 * The process-local bound is why the SERVER half of the cache is a TTL question and the CLIENT half is
 * not: `src/services/pipeline/variantCache.ts` writes sessionStorage and `workflowOrchestrator` replays
 * it without calling the server at all, so the prompt fix could not reach a recently-viewed variant no
 * matter what this constant said. That cache carries its own version, and it was bumped with this change
 * for the same reason.
 *
 * The precedent is `RASP_INDEX_SCHEMA_VERSION` (`src/shared/raspIndex.ts`): a producer version that
 * lives beside the producer and is read by the consumer, so a change cannot be made in one place and
 * forgotten in the other. `server/routes/variant/narrative.ts` interpolates this constant rather than
 * a literal, and `narrativeCacheKey.test.ts` fails if a literal reappears.
 */
export const NARRATIVE_PROMPT_SCHEMA_VERSION = 3;

/** The narrative call's provider parameters. The server reads these; the UI only reports them. */
export const NARRATIVE_SYNTHESIS = {
  /**
   * Sampling temperature for the narrative request.
   *
   * Zero is a clinical requirement, not a default: the same evidence bundle must produce the same
   * prose, because the text is filed in a patient record and re-synthesis is offered as a retry
   * rather than as a re-roll. Raising this changes the artefact, so it is named here and imported
   * by `server/services/llm/gemini.ts`.
   */
  temperature: 0,
  /**
   * Response format. True of the call: it sets `responseMimeType: "application/json"` with a
   * `responseSchema`, and the route validates the parsed object with zod.
   */
  responseFormat: "Structured JSON schema",
} as const;

/**
 * How to describe the sampling settings to a reader.
 *
 * "0 (greedy)" is the honest expansion: temperature 0 selects the highest-probability token at every
 * step, which is what makes the output repeatable. The previous label claimed determinism for a
 * non-zero temperature, where it does not hold.
 */
export function describeSampling(temperature: number): string {
  if (temperature === 0) return "0 (greedy, repeatable)";
  return String(temperature);
}

/**
 * What the narrative prompt is given, in words a reader can check the summary against.
 *
 * The prompt (`performGeminiAnalysis`) carries ClinVar, AlphaMissense, CADD, REVEL, GERP, phyloP and the
 * top STRING partners. It carries no allele frequency, gene constraint, functional domain, stability,
 * splicing or structure reading — yet asks the model for "specific molecular hypotheses based on
 * peptide chain coordinates" and lets it propose criteria. `narrativeSynthesis.test.ts` reads the prompt
 * source and fails if a block named here disappears or a "not sent" source appears in it.
 */
export const NARRATIVE_PROMPT_EVIDENCE = {
  sent: ["ClinVar", "AlphaMissense", "CADD", "REVEL", "GERP++", "phyloP", "STRING partners"],
  notSent: ["gnomAD frequency", "gene constraint", "functional domains", "stability (ΔΔG)", "splicing", "3D structure"],
} as const;
