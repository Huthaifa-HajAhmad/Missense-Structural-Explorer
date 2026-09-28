import { ASSEMBLY_LABELS, CANONICAL_ASSEMBLY } from "../../shared/assembly";
import { isRetryableLiftRefusal } from "../../shared/contracts";
import type { AssemblyProvenance } from "../../services/pipeline/types";

/** Human label for a build we can NAME. Anything else yields null, never a guess. */
function assemblyLabel(build: string | null | undefined): string | null {
  return build === "GRCh37" || build === "GRCh38" ? ASSEMBLY_LABELS[build] : null;
}

/**
 * The server's `reason` as a sentence: its first letter upper-cased, nothing else touched.
 *
 * DISPLAY ONLY. `reason` is deliberately self-sufficient prose (an agent reads the same string), and
 * this note renders it verbatim rather than paraphrasing it — the earlier version stated the cause in
 * its own words AND appended the server's, so the reader got "…could not be verified on GRCh38 / hg38.
 * the coordinate could not be verified on the GRCh38 reference (…)". One cause, said once.
 */
function asSentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Retry advice, ONLY where another attempt could actually change the answer.
 *
 * `isRetryableLiftRefusal` exists for precisely this: an unanswered assembly map or our own elapsed
 * deadline may succeed on the next request, while a reference discontinuity will not — and telling a
 * reader to try again when the assemblies disagree at that base wastes their time twice.
 */
function retryAdvice(provenance: AssemblyProvenance): string {
  return isRetryableLiftRefusal(provenance.coordinateLift) ? " Retrying may succeed." : "";
}

/**
 * One short honest sentence about the build trail, or null when there is nothing to disclose.
 *
 * `AssemblyProvenance` is the single definition of that trail (`src/services/pipeline/types.ts`):
 * `assembly` is the build the SUBMITTED coordinate was expressed in, `resolvedAssembly` is the build
 * the ANNOTATION actually came from, `liftedGenomicCoordinates` is the verified canonical locus the
 * lift produced, and `coordinateLift` is the machine-readable decision connecting them. Every field
 * is optional, so a payload that predates the lift policy carries none of them.
 *
 * Null is the correct answer when both builds agree (the row above already states the build) and when
 * the payload carries no trail at all. A note that always rendered would be the same hardcoded claim
 * the build row was fixed for, one line lower — so absence of evidence renders as absence of a node.
 *
 * The two statements it can make are deliberately different in kind, because they call for different
 * trust: a VERIFIED lift says the annotation is on the canonical reference and names the locus so the
 * claim can be checked by hand, while an UNAVAILABLE lift says the annotation is older and, when the
 * server gave a reason, repeats it rather than paraphrasing it.
 */
export function buildAssemblyLiftNote(
  provenance: AssemblyProvenance | null | undefined
): string | null {
  if (!provenance) return null;

  const lift = provenance.coordinateLift ?? null;
  const submitted = provenance.assembly ?? lift?.fromAssembly ?? null;
  const annotated = provenance.resolvedAssembly ?? lift?.toAssembly ?? null;
  const submittedLabel = assemblyLabel(submitted);
  const annotatedLabel = assemblyLabel(annotated);

  if (lift?.status === "lifted") {
    if (!submittedLabel || !annotatedLabel) return null;
    const locus = provenance.liftedGenomicCoordinates ?? lift.toCoordinates ?? null;
    return (
      `Coordinate verified on the ${annotatedLabel} reference (${submittedLabel} → ${annotatedLabel}).` +
      (locus ? ` Canonical locus ${locus}.` : "")
    );
  }

  if (lift?.status === "unavailable") {
    /**
     * The lift was ATTEMPTED and could not be verified, so the annotation stayed on the build the
     * coordinate was submitted in.
     *
     * The build it could not be verified ON is the canonical one by POLICY (`CANONICAL_ASSEMBLY`),
     * not `lift.toAssembly`: that field means "the build the annotation actually ran against", and
     * for a refused lift the annotation ran against the submitted build — so the two are equal by
     * construction and reading the target off them yields nothing. An earlier version did exactly
     * that and required them to differ, which made this branch unreachable on every real payload:
     * the refusal that made the GRCh38-only sources decline was disclosed nowhere. The contract
     * states the same rule (`coordinateLiftSchema`: `toAssembly` is "the build the annotation
     * actually ran against").
     */
    const fromLabel = assemblyLabel(lift.fromAssembly ?? submitted);
    const targetLabel = assemblyLabel(CANONICAL_ASSEMBLY);
    // A refused lift only exists when the submitted build is NOT canonical; anything else is a
    // contradictory payload, and a note inventing a trail would be worse than silence.
    if (!fromLabel || !targetLabel || (lift.fromAssembly ?? submitted) === CANONICAL_ASSEMBLY) {
      return null;
    }
    /**
     * The server's reason is the whole disclosure when it is present — it says what could not be
     * verified, on which reference, where the annotation came from instead, and why that matters. The
     * note therefore renders it rather than re-stating its first clause and then quoting it.
     */
    if (lift.reason) return `${asSentence(lift.reason)}${retryAdvice(provenance)}`;
    return (
      `Annotated on the ${fromLabel} reference: the coordinate could not be verified on ` +
      `${targetLabel}.${retryAdvice(provenance)}`
    );
  }

  // `not-needed` / `not-applicable`: the submitted build IS canonical, or nothing liftable was
  // submitted. Neither is a trail worth a note.
  if (lift) return null;

  // No lift record, but the two builds are stated and differ. Per the response contract, that
  // difference has exactly one meaning — a verified lift moved the annotation onto the canonical
  // build — so state the resolved build and do not invent a loci trail for it.
  if (!submittedLabel || !annotatedLabel || submitted === annotated) return null;
  return `Coordinate verified on the ${annotatedLabel} reference (${submittedLabel} → ${annotatedLabel}).`;
}
