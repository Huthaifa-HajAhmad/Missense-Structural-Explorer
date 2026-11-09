import {
  buildHintSchema,
  coordinateLiftSchema,
  genomeAssemblySchema,
  numberingChoiceSchema,
  REFUSAL_CODES,
} from "../../shared/contracts";
import type { RefusalAttachments, RefusalBuildTrail } from "./pipelineStateFactory";

/**
 * The build decision a refusal travelled with, re-validated field by field.
 *
 * Read structurally like the hint beside it: a build is either one of the two this platform speaks or
 * it is not reported at all, and a lift record that does not parse is dropped rather than rendered.
 * `buildDeclared` is the field the copy needs — it is what separates "read as GRCh38" from "read as
 * GRCh38, which nobody stated".
 */
function buildTrailFromDetails(details: any): RefusalBuildTrail | undefined {
  const assembly = genomeAssemblySchema.safeParse(details?.assembly);
  const resolvedAssembly = genomeAssemblySchema.safeParse(details?.resolvedAssembly);
  const coordinateLift = coordinateLiftSchema.safeParse(details?.coordinateLift);
  const assemblyNote = typeof details?.assemblyNote === "string" ? details.assemblyNote : undefined;

  if (!assembly.success && !resolvedAssembly.success && !coordinateLift.success && !assemblyNote) {
    return undefined;
  }
  return {
    ...(assembly.success ? { assembly: assembly.data } : {}),
    ...(resolvedAssembly.success ? { resolvedAssembly: resolvedAssembly.data } : {}),
    ...(coordinateLift.success ? { coordinateLift: coordinateLift.data } : {}),
    ...(assemblyNote ? { assemblyNote } : {}),
  };
}

/**
 * Reads the REFUSAL ATTACHMENTS out of a thrown analysis error — the readings of an ambiguous
 * notation, the alternative-build spelling of a coordinate whose alleles matched no reference, and the
 * build decision the refusal was taken under.
 *
 * Read structurally (`code`/`details` off the error) rather than by importing the client's `ApiError`,
 * so this service layer keeps its dependency direction — and exported so the hop is testable without
 * driving the whole pipeline.
 *
 * Returns `{}` for every other error: an unrelated failure must not render a prompt.
 */
export function refusalAttachmentsFromError(error: unknown, fallbackNotation: string): RefusalAttachments {
  const code = (error as any)?.code;
  const details: any = (error as any)?.details;

  if (code === REFUSAL_CODES.coordinateReferenceMismatch) {
    /**
     * The build hint is re-validated, not trusted: a hint whose notation does not actually STATE the
     * build it offers would render a button labelled "the other build" over a coordinate that repeats
     * the request the server has just refused.
     */
    const parsed = buildHintSchema.safeParse(details?.buildHint);
    const buildTrail = buildTrailFromDetails(details);
    return {
      ...(parsed.success ? { buildHint: parsed.data } : {}),
      ...(buildTrail ? { buildTrail } : {}),
    };
  }

  if (code === REFUSAL_CODES.nonMissenseVariant) {
    const consequences = Array.isArray(details?.consequence) ? details.consequence : [];
    const isIntronic = consequences.some((c: string) => typeof c === "string" && c.toLowerCase().includes("intron"));
    const isSynonymous = consequences.some((c: string) => typeof c === "string" && c.toLowerCase().includes("synonymous"));
    const hasCodon = !isIntronic && !consequences.some((c: string) => typeof c === "string" && c.toLowerCase().includes("non_coding"));
    return {
      nonMissenseRefusal: {
        gene: typeof details?.gene === "string" ? details.gene : undefined,
        hgvsc: typeof details?.hgvsc === "string" ? details.hgvsc : undefined,
        hgvsp: typeof details?.hgvsp === "string" ? details.hgvsp : undefined,
        consequence: consequences,
        isCoding: !isIntronic,
        hasCodon,
        reason: isIntronic
          ? "Intronic variant: does not alter a coding sequence or codon."
          : isSynonymous
          ? "Synonymous variant: alters a nucleotide within a codon but does not change the amino acid."
          : "Non-missense variant: out of scope for 3D missense structural modeling.",
      },
    };
  }

  if (code !== REFUSAL_CODES.ambiguousProteinNumbering) return {};

  // Bounded like every other server-supplied array: a compromised or buggy response must not be able
  // to make the UI render an unbounded list of buttons (the server emits at most one per isoform).
  const parsed = numberingChoiceSchema.array().max(16).safeParse(details?.candidates);
  if (!parsed.success || parsed.data.length === 0) return {};

  return {
    numberingChoices: parsed.data,
    numberingNotation: typeof details?.notation === "string" ? details.notation : fallbackNotation,
  };
}
