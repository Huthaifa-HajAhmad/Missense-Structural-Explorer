/**
 * isoform-remap.ts — Maps a residue position from one protein sequence onto another.
 *
 * WHY THIS EXISTS
 * ---------------
 * A protein notation's residue numbers belong to whichever protein the reporting pipeline used.
 * Clinical/lab pipelines follow the HGVS convention and report on the MANE Select / RefSeq
 * protein (`NP_001032248.1:p.Lys281Asn` for ACOT9), while this platform models the CANONICAL
 * UniProt sequence, because AlphaFold DB and PDB structures are canonical by construction
 * (`Q9Y305`, where the same residue is K272 and position 281 is L).
 *
 * Refusing such notations is safe but unhelpful; accepting them by index is dangerous, because
 * at ~4% of positions the wild-type LETTER coincides at the same index in both proteins while
 * describing a different residue 9 positions away — the app would model the wrong residue
 * silently. So the mapping must be *proved*, never guessed:
 *
 *   1. locate the position by a flanking window that occurs EXACTLY ONCE in the target sequence
 *      (a repeated motif cannot anchor a position);
 *   2. require enough context on both sides of the residue;
 *   3. require the residue itself to be identical in both sequences (a window includes it, so a
 *      substitution difference refuses the mapping rather than being papered over).
 *
 * Anything that fails is reported as unmappable, and callers refuse rather than convert.
 *
 * Pure module: sequences in, conclusion out. IO lives in the service layer.
 */

import { HGVS_PATTERN } from "../../../src/shared/variantNotation.ts";
import { oneLetterAminoAcid } from "./isoform-numbering.ts";

/** Longest context used on each side of the residue when anchoring. */
export const DEFAULT_MAX_FLANK = 25;

/** Minimum total context required across both sides. */
export const DEFAULT_MIN_FLANK = 8;

export interface PositionMapping {
  canonicalPosition: number;
  /** canonicalPosition - basisPosition. NEGATIVE when the basis is the longer isoform. */
  offset: number;
  anchorLength: number;
}

/** Sequences normalised for comparison: UniProt records can carry case or whitespace artefacts. */
export function normaliseSequence(sequence: string): string {
  return sequence.replace(/\s+/g, "").toUpperCase();
}

/**
 * True when `candidate` is `reference` with one contiguous block inserted or deleted, or a
 * same-length variant of it — the shapes real isoforms have.
 *
 * A basis that is neither is not a numbering of the same protein (a reversed or truncated record, a
 * different protein entirely), and comparing positions against it would invent conclusions.
 */
export function sequencesAreComparable(candidate: string, reference: string): boolean {
  if (!candidate || !reference) return false;
  if (candidate === reference) return true;
  const { basisMiddle, canonicalMiddle } = divergentMiddles(candidate, reference);
  // Pure indel: after the maximal common prefix/suffix, one side's divergent block is empty.
  if (basisMiddle.length === 0 || canonicalMiddle.length === 0) return true;
  /**
   * Anything else is NOT assumed comparable. Equal lengths look harmless — numbering seems 1:1 — but
   * an insertion plus a compensating deletion in the same pair leaves the lengths equal while the
   * numbering shifts in between, so identity mapping would be wrong. Substitutions interleaved with
   * indels are the same problem. Falling back to the conservative comparison costs refusals; guessing
   * costs a wrong residue.
   */
  return false;
}

function divergentMiddles(basisSequence: string, canonicalSequence: string) {
  let prefix = 0;
  const maxPrefix = Math.min(basisSequence.length, canonicalSequence.length);
  while (prefix < maxPrefix && basisSequence[prefix] === canonicalSequence[prefix]) prefix++;

  let suffix = 0;
  const maxSuffix = Math.min(basisSequence.length, canonicalSequence.length) - prefix;
  while (
    suffix < maxSuffix &&
    basisSequence[basisSequence.length - 1 - suffix] === canonicalSequence[canonicalSequence.length - 1 - suffix]
  ) {
    suffix++;
  }

  return {
    prefix,
    suffix,
    basisMiddle: basisSequence.slice(prefix, basisSequence.length - suffix),
    canonicalMiddle: canonicalSequence.slice(prefix, canonicalSequence.length - suffix),
  };
}

/**
 * Maps a position through the two sequences' common prefix/suffix.
 *
 * This is the PRIMARY strategy, because the ±25-window anchor below can only locate a position whose
 * neighbourhood survives verbatim in the canonical sequence. A window that reaches an isoform's
 * insertion finds NOTHING and reports the position unmappable — and callers read an unmappable basis
 * as "this numbering does not carry the residue", i.e. as proof that only the OTHER numbering fits.
 * For ACOT9 that silently mis-numbered every position whose window touched the 9-residue insertion
 * (`p.Arg64Ala` was accepted as canonical R64 while the MANE reading is canonical R55), and it refused
 * 13% of the MANE protein's positions on the accession route, including identity positions.
 *
 * Common affixes are EXACT for the indel shapes isoforms are made of: everything before the first
 * difference and after the last maps by a constant offset, and only residues inside the divergent
 * block are genuinely unlocatable.
 */
function mapByCommonAffixes(
  basisSequence: string,
  canonicalSequence: string,
  position: number
): PositionMapping | null {
  const { prefix, basisMiddle, canonicalMiddle } = divergentMiddles(basisSequence, canonicalSequence);
  if (basisMiddle.length === 0 && canonicalMiddle.length === 0) {
    // Identical sequences: the mapping IS the identity, whatever the local repeats say.
    return { canonicalPosition: position, offset: 0, anchorLength: canonicalSequence.length };
  }
  // Only a pure indel is exact by affixes. Every other shape (substitutions, an insertion plus a
  // compensating deletion) keeps numbering undetermined, so the window anchor decides — and if it
  // cannot, the position is reported unmappable rather than asserted.
  const pureIndel = basisMiddle.length === 0 || canonicalMiddle.length === 0;
  if (!pureIndel) return null;

  const index = position - 1;
  if (index < prefix) {
    return { canonicalPosition: position, offset: 0, anchorLength: prefix };
  }
  const offset = canonicalMiddle.length - basisMiddle.length; // negative when the basis is longer
  if (index >= prefix + basisMiddle.length) {
    const mapped = position + offset;
    if (mapped < 1 || mapped > canonicalSequence.length) return null;
    return { canonicalPosition: mapped, offset, anchorLength: canonicalSequence.length - prefix };
  }
  // Inside the divergent block itself: those residues exist in only one of the two proteins.
  return null;
}

export type PositionMappingOutcome =
  | { status: "mapped"; mapping: PositionMapping }
  | { status: "unmappable"; reason: string };

/**
 * Maps `position` (1-based, in `basisSequence`) onto `canonicalSequence`.
 *
 * See the module header for why uniqueness and residue identity are both required.
 */
export function mapPositionAcrossSequences(params: {
  basisSequence: string;
  canonicalSequence: string;
  position: number;
  maxFlank?: number;
  minFlank?: number;
}): PositionMappingOutcome {
  const {
    basisSequence,
    canonicalSequence,
    position,
    maxFlank = DEFAULT_MAX_FLANK,
    minFlank = DEFAULT_MIN_FLANK,
  } = params;

  if (!Number.isInteger(position) || position < 1 || position > basisSequence.length) {
    return {
      status: "unmappable",
      reason: `position ${position} lies outside the numbering basis (length ${basisSequence.length})`,
    };
  }
  if (!canonicalSequence.length) {
    return { status: "unmappable", reason: "the canonical sequence is unavailable" };
  }

  // PRIMARY: exact for indel-shaped differences (see mapByCommonAffixes). Falling straight through to
  // the window anchor is what let a window spanning an insertion turn "cannot locate" into "this
  // numbering does not carry the residue" — a wrong residue modelled as verified.
  const byAffixes = mapByCommonAffixes(basisSequence, canonicalSequence, position);
  if (byAffixes) return { status: "mapped", mapping: byAffixes };

  /**
   * Inside the region where the two proteins differ, there is no counterpart to map to — a distinct
   * answer from "this basis does not carry the residue", which callers are entitled to read as proof
   * that only the other numbering fits. Saying so prevents both a false refusal and a false verdict.
   */
  {
    const { prefix, basisMiddle, canonicalMiddle } = divergentMiddles(basisSequence, canonicalSequence);
    if (basisMiddle.length || canonicalMiddle.length) {
      const insideFrom = prefix + 1;
      const insideTo = prefix + Math.max(basisMiddle.length, canonicalMiddle.length);
      if (position >= insideFrom && position <= insideTo) {
        return {
          status: "unmappable",
          reason:
            `position ${position} lies inside the region where the two proteins differ ` +
            `(${insideFrom}-${insideTo}), so it has no counterpart in the canonical sequence`,
        };
      }
    }
  }

  const index = position - 1;
  const left = Math.min(maxFlank, index);
  const right = Math.min(maxFlank, basisSequence.length - index - 1);
  if (left + right < 2 * minFlank) {
    return {
      status: "unmappable",
      reason: "not enough flanking sequence to anchor this position unambiguously",
    };
  }

  const windowStart = index - left;
  const anchor = basisSequence.slice(windowStart, index + right + 1);

  // Every occurrence of the anchor: more than one means the position cannot be located uniquely.
  const occurrences: number[] = [];
  let from = 0;
  while (occurrences.length < 2) {
    const at = canonicalSequence.indexOf(anchor, from);
    if (at < 0) break;
    occurrences.push(at);
    from = at + 1;
  }

  if (occurrences.length === 0) {
    return {
      status: "unmappable",
      reason:
        "the numbering basis and the canonical sequence do not share this region, so the position cannot be located",
    };
  }
  if (occurrences.length > 1) {
    return {
      status: "unmappable",
      reason:
        "this region occurs more than once in the canonical sequence, so the position cannot be anchored uniquely",
    };
  }

  const canonicalPosition = occurrences[0] + left + 1;
  if (canonicalPosition < 1 || canonicalPosition > canonicalSequence.length) {
    return { status: "unmappable", reason: "the mapped position falls outside the canonical sequence" };
  }

  return {
    status: "mapped",
    mapping: {
      canonicalPosition,
      offset: canonicalPosition - position,
      anchorLength: anchor.length,
    },
  };
}

export interface ParsedSubstitution {
  position: number;
  wt3: string;
  wt1: string;
  mut3: string;
  mut1: string;
  /** True when the input carried an explicit `p.` prefix, preserved when renaming. */
  prefixed: boolean;
}

/** Parses an HGVSp substitution (`p.Lys281Asn`, `(Lys281Asn)`, `K281N`) into its parts. */
export function parseSubstitution(notation: string): ParsedSubstitution | null {
  const trimmed = notation.replace(/[()]/g, "").trim();
  const match = trimmed.match(HGVS_PATTERN);
  if (!match) return null;

  const wt1 = oneLetterAminoAcid(match[1]);
  const mut1 = oneLetterAminoAcid(match[3]);
  if (!wt1 || !mut1) return null;

  return {
    position: Number.parseInt(match[2], 10),
    wt3: match[1],
    wt1,
    mut3: match[3],
    mut1,
    prefixed: /^p\./i.test(trimmed),
  };
}

/** Rewrites a substitution at a new position, preserving prefix and letter style. */
export function renameSubstitution(notation: string, parsed: ParsedSubstitution, position: number): string {
  const body = `${parsed.wt3}${position}${parsed.mut3}`;
  return parsed.prefixed ? `p.${body}` : body;
}

export interface NumberingBasis {
  /** `Q9Y305` (canonical) or an isoform id such as `Q9Y305-4`. */
  id: string;
  sequence: string;
  kind: "canonical" | "isoform";
}

/**
 * Builds the numbering bases (canonical first) from a UniProt isoform set.
 *
 * Lives here rather than in the service layer so this stays the pure module for numbering maths:
 * the profile builder and the resolver both need it, and having it in either one made them import
 * each other.
 */
export function toNumberingBases(
  isoforms: Array<{ id: string; sequence: string }>,
  canonicalAccession: string
): NumberingBasis[] {
  const canonicalUpper = canonicalAccession.toUpperCase();
  return isoforms.map((iso) => ({
    id: iso.id,
    sequence: iso.sequence,
    kind: iso.id.toUpperCase() === canonicalUpper ? "canonical" : "isoform",
  }));
}

export interface NumberingCandidate {
  basisId: string;
  basisKind: "canonical" | "isoform";
  basisPosition: number;
  canonicalPosition: number;
  /** The canonical-numbered equivalent of the input notation. */
  variant: string;
  anchorLength: number;
}

export type NumberingResolution =
  | { status: "canonical"; candidate: NumberingCandidate }
  | { status: "remapped"; candidate: NumberingCandidate }
  | { status: "ambiguous"; candidates: NumberingCandidate[] }
  | { status: "unresolved"; reason: string };

/**
 * Decides which numbering a protein notation is consistent with, and what it is in canonical terms.
 *
 * `bases` must include the canonical sequence (kind "canonical") plus every isoform worth
 * considering. A basis is only a candidate when its own residue at that position equals the
 * notation's wild type — that is what makes an isoform-numbered notation identifiable at all.
 *
 * More than one surviving candidate means the notation genuinely cannot be resolved by index
 * alone (the same letters sit at different residues in two numberings), so the caller must ask
 * rather than choose.
 */
export function resolveNumberingAcrossBases(params: {
  notation: string;
  bases: NumberingBasis[];
}): NumberingResolution {
  const { notation, bases } = params;
  const parsed = parseSubstitution(notation);
  if (!parsed) {
    return { status: "unresolved", reason: `"${notation}" is not a single-amino-acid substitution` };
  }

  const canonical = bases.find((b) => b.kind === "canonical");
  if (!canonical) {
    return { status: "unresolved", reason: "the canonical sequence is unavailable" };
  }

  const candidates: NumberingCandidate[] = [];
  const seenPositions = new Set<number>();

  for (const basis of bases) {
    // A basis that does not carry the stated wild type cannot be the numbering source.
    if (basis.sequence[parsed.position - 1] !== parsed.wt1) continue;

    const mapped = mapPositionAcrossSequences({
      basisSequence: basis.sequence,
      canonicalSequence: canonical.sequence,
      position: parsed.position,
    });
    if (mapped.status !== "mapped") continue;

    const { canonicalPosition, anchorLength } = mapped.mapping;
    if (seenPositions.has(canonicalPosition)) continue;
    seenPositions.add(canonicalPosition);

    candidates.push({
      basisId: basis.id,
      basisKind: basis.kind,
      basisPosition: parsed.position,
      canonicalPosition,
      variant: renameSubstitution(notation, parsed, canonicalPosition),
      anchorLength,
    });
  }

  if (candidates.length === 0) {
    return {
      status: "unresolved",
      reason:
        "no sequence for this protein carries the stated wild-type residue at that position",
    };
  }
  if (candidates.length > 1) {
    return { status: "ambiguous", candidates };
  }

  const only = candidates[0];
  return only.basisKind === "canonical"
    ? { status: "canonical", candidate: only }
    : { status: "remapped", candidate: only };
}

/** User-facing explanation when two numberings are equally consistent with the input. */
export function buildAmbiguousNumberingMessage(
  notation: string,
  candidates: NumberingCandidate[]
): string {
  const options = candidates
    .map((c) => `${c.variant} (on ${c.basisId})`)
    .join(" or ");
  return (
    `"${notation}" cannot be resolved by residue number alone: the same wild-type residue sits at ` +
    `different positions in two sequences of this protein, so it could mean ${options}. ` +
    "Enter the genomic or cDNA coordinate (which resolves the numbering automatically), or qualify " +
    "the notation with its protein accession."
  );
}
