/**
 * Deterministic literature screening. This is lexical triage only: it reads titles and
 * abstracts, records the text which fired a tag, and never creates clinical evidence.
 *
 * Negation is deliberately not interpreted in this first lexicon version. For example,
 * a sentence saying that an assay was not performed can still match assay language.
 */
import { AMINO_ACID_3_TO_1 } from "./aminoAcids";
import { THRESHOLDS } from "./thresholds";
import { curatedLinkDetail, curatedLinkLabel, type CuratedVariantLink } from "./curatedLiterature";

export const LEXICON_VERSION = 1;
export const MULTI_VARIANT_THRESHOLD = 10;

export type ScreeningTagName =
  | "names-variant"
  | "names-gene"
  | "functional-assay"
  | "clinical-case"
  | "mechanism"
  | "review"
  | "preprint"
  | "full-text-only"
  | "same-residue"
  | "multi-variant"
  | "model-system";

export type ScreeningTagSource = "sentence-anchor" | "pubtype" | "curated" | "lexicon";

export interface ScreeningTag {
  tag: ScreeningTagName;
  source: ScreeningTagSource;
  quote: string;
}

export interface MechanismTerm {
  term: string;
  quote: string;
}

export type AttentionTier = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * One provider record → paper relationship, rendered from provenance rather than a paper quote.
 * Kept apart from `ScreeningTag`: a tag is a lexical observation with a quote, this is a metadata fact.
 */
export interface CuratedCitationReading {
  provider: CuratedVariantLink["provider"];
  /** Reader-facing label, e.g. "Cited by UniProt variant record". */
  label: string;
  /** Provider-side detail (accession, variant, feature id, evidence code); never a paper quote. */
  detail: string;
  /** Deep link to the provider's record. */
  sourceUrl: string;
  pmid: string;
  retrievedAt: string;
}

export interface PaperScreening {
  tags: ScreeningTag[];
  mechanismTerms: MechanismTerm[];
  tier: AttentionTier;
  /**
   * Phase 1b: provider records that cite this paper for the variant. Unlike a tag, a reading needs no
   * abstract quote; it promotes the row on provider provenance. It is not evidence and enters no ACMG
   * criterion.
   */
  citedBy?: CuratedCitationReading[];
}

/** The small citation shape required by the pure screener. */
export interface ScreeningCitation {
  /** Identifier the curated link's `pmid` must equal for the relationship to attach. */
  id?: string;
  title: string;
  abstract: string;
  publicationTypes?: readonly string[] | null;
}

/** Structural so this module stays independent of the Literature view model. */
export interface ScreeningVariantForms {
  label: string;
  forms: readonly string[];
}

export interface ScreeningMentions {
  level: "variant" | "gene" | "elsewhere";
  variantIn: "title" | "abstract" | null;
  matchedForm: string | null;
  geneIn: readonly ("title" | "abstract")[];
  snippet: string | null;
}

export interface ScreenPaperInput {
  citation: ScreeningCitation;
  gene: string;
  forms: ScreeningVariantForms | null;
  mentions: ScreeningMentions;
  /**
   * Phase 1b: provider record → paper relationships for this citation. Only those whose `pmid` equals
   * this citation's id attach, so a link for a neighbouring variant or another paper can never be
   * promoted onto this row.
   */
  curatedLinks?: readonly CuratedVariantLink[] | null;
}

const B = "(?<![A-Za-z0-9])";
const E = "(?![A-Za-z0-9])";
const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ONE_TO_THREE: Record<string, string> = {};
for (const [three, one] of Object.entries(AMINO_ACID_3_TO_1)) {
  if (/^[A-Z][a-z]{2}$/.test(three)) ONE_TO_THREE[one] = three;
}

const VARIANT_RE = /(?:p\.)?\(?([A-Z][a-z]{2}|[A-Z])(\d+)([A-Z][a-z]{2}|[A-Z*=])\)?/g;

const LEXICONS = {
  "functional-assay": [
    "functional", "activity", "kinetic", "western blot", "in vitro", "knock-in", "rescue",
    "expression", "catalytic", "binding affinity", "misfold", "erad", "trafficking", "oligomer",
  ],
  "clinical-case": ["patient", "proband", "case report", "cohort", "family", "segregation", "phenotype", "diagnosed"],
  mechanism: [
    "loss-of-function", "loss of function", "haploinsufficiency", "dominant-negative", "dominant negative",
    "gain-of-function", "gain of function", "constitutive activation", "domain", "ortholog", "homolog",
    "dimer", "interface", "structure",
  ],
  review: ["review", "we summarize", "meta-analysis", "overview"],
  "model-system": ["mouse", "mice", "zebrafish", "yeast", "patient fibroblasts", "ipsc", "organoid"],
} as const;

function sentenceParts(text: string): Array<{ text: string; start: number }> {
  // Protect HGVS's `p.` prefix from the ordinary full-stop sentence boundary.
  const protectedText = text.replace(/\bp\./g, "p\uFFFF");
  const parts: Array<{ text: string; start: number }> = [];
  const re = /[^\n.!?]+(?:[.!?]+|$)/g;
  for (let match = re.exec(protectedText); match; match = re.exec(protectedText)) {
    const leading = match[0].search(/\S/);
    if (leading === -1) continue;
    parts.push({ text: match[0].trim().replace(/p\uFFFF/g, "p."), start: match.index + leading });
  }
  return parts;
}

function sentences(text: string): string[] {
  return sentenceParts(text).map(part => part.text);
}

function firstSentence(text: string): string | null {
  return sentences(text)[0] ?? null;
}

function quoteAt(text: string, index: number): string | null {
  for (const sentence of sentenceParts(text)) {
    if (index >= sentence.start && index <= sentence.start + sentence.text.length) return sentence.text;
  }
  return firstSentence(text);
}

function wholeWordMatch(text: string, terms: readonly string[]): { term: string; index: number } | null {
  let result: { term: string; index: number } | null = null;
  for (const term of terms) {
    const match = new RegExp(`${B}${escapeRe(term)}${E}`, "g").exec(text);
    if (match && (!result || match.index < result.index)) result = { term, index: match.index };
  }
  return result;
}

function hasWholeWord(text: string, value: string): number | null {
  const match = new RegExp(`${B}${escapeRe(value)}${E}`, /[a-z]{2}/.test(value) ? "gi" : "g").exec(text);
  return match ? match.index : null;
}

function variantInSentence(sentence: string, forms: ScreeningVariantForms | null): boolean {
  return !!forms && forms.forms.some(form => hasWholeWord(sentence, form) !== null);
}

function pubTypeMatch(types: readonly string[] | null | undefined, test: RegExp): string | null {
  return types?.find(type => test.test(type)) ?? null;
}

function residueKey(token: string): { wildType: string; position: string; alternate: string } | null {
  const match = token.match(/^(?:p\.)?\(?([A-Z][a-z]{2}|[A-Z])(\d+)([A-Z][a-z]{2}|[A-Z*=])\)?$/);
  if (!match) return null;
  const toOne = (value: string): string | null => {
    if (value === "*" || value === "=") return value;
    if (value.length === 1) return ONE_TO_THREE[value] ? value : null;
    return AMINO_ACID_3_TO_1[value] ?? AMINO_ACID_3_TO_1[value[0].toUpperCase() + value.slice(1).toLowerCase()] ?? null;
  };
  const wildType = toOne(match[1]);
  const alternate = toOne(match[3]);
  return wildType && alternate ? { wildType, position: match[2], alternate } : null;
}

function variantsIn(text: string): Array<{ notation: string; index: number; key: NonNullable<ReturnType<typeof residueKey>> }> {
  const found: Array<{ notation: string; index: number; key: NonNullable<ReturnType<typeof residueKey>> }> = [];
  for (let match = VARIANT_RE.exec(text); match; match = VARIANT_RE.exec(text)) {
    const key = residueKey(match[0]);
    if (key) found.push({ notation: match[0], index: match.index, key });
  }
  VARIANT_RE.lastIndex = 0;
  return found;
}

function sentenceForMention(citation: ScreeningCitation, mentions: ScreeningMentions): string | null {
  if (mentions.variantIn === "abstract" && mentions.snippet) return mentions.snippet;
  if (mentions.variantIn === "title") return citation.title || null;
  return null;
}

/** Screen one title/abstract. All returned tags are backed by a quote. */
export function screenPaper(input: ScreenPaperInput): PaperScreening {
  const { citation, forms, mentions } = input;
  const title = citation.title ?? "";
  const abstract = citation.abstract ?? "";
  const text = `${title}\n${abstract}`;
  const tags: ScreeningTag[] = [];
  const push = (tag: ScreeningTagName, source: ScreeningTagSource, quote: string | null) => {
    if (quote && !tags.some(existing => existing.tag === tag)) tags.push({ tag, source, quote });
  };

  // A curated relationship attaches only to the exact variant it names: the identifier must match AND
  // the link's own canonical residues must equal the query's target. A link for R408Q on a pmid that
  // matches an R408W query is a neighbouring-variant relationship and is never promoted. When no target
  // can be parsed, no link is promoted at all.
  const target = forms ? residueKey(forms.label) : null;
  const citedBy: CuratedCitationReading[] = target
    ? (input.curatedLinks ?? [])
        .filter(link => !!link.pmid && !!citation.id && link.pmid === citation.id)
        .filter(link => {
          const key = residueKey(link.variant);
          return !!key && key.wildType === target.wildType && key.position === target.position && key.alternate === target.alternate;
        })
        .map(link => ({
          provider: link.provider,
          label: curatedLinkLabel(link.provider),
          detail: curatedLinkDetail(link),
          sourceUrl: link.sourceUrl,
          pmid: link.pmid,
          retrievedAt: link.retrievedAt,
        }))
    : [];
  const hasCuratedLink = citedBy.length > 0;

  const namedVariantQuote = sentenceForMention(citation, mentions);
  if (namedVariantQuote) push("names-variant", hasCuratedLink ? "curated" : "lexicon", namedVariantQuote);

  // `readMentions` owns the case-aware gene-symbol rule (important for common-word genes).
  if (mentions.geneIn.length > 0) {
    push("names-gene", "lexicon", mentions.geneIn.includes("title") ? title : firstSentence(abstract));
  }

  for (const tag of ["functional-assay", "clinical-case"] as const) {
    // Prefer a sentence where the lexicon hit AND the variant co-occur: judging only the earliest hit
    // would call a paper gene-context when a later sentence is the variant-anchored one.
    const sentenceQuotes = sentences(text);
    const anchored = sentenceQuotes.find(sentence => wholeWordMatch(sentence, LEXICONS[tag]) && variantInSentence(sentence, forms));
    if (anchored) {
      push(tag, "sentence-anchor", anchored);
      continue;
    }
    const hit = wholeWordMatch(text, LEXICONS[tag]);
    if (hit) push(tag, "lexicon", quoteAt(text, hit.index));
  }

  const mechanismTerms: MechanismTerm[] = [];
  for (const term of LEXICONS.mechanism) {
    const hit = wholeWordMatch(text, [term]);
    const quote = hit ? quoteAt(text, hit.index) : null;
    if (quote) mechanismTerms.push({ term, quote });
  }
  if (mechanismTerms.length) push("mechanism", "lexicon", mechanismTerms[0].quote);

  const reviewType = pubTypeMatch(citation.publicationTypes, /\breview\b/i);
  if (reviewType) push("review", "pubtype", reviewType);
  else {
    const hit = wholeWordMatch(text, LEXICONS.review);
    if (hit) push("review", "lexicon", quoteAt(text, hit.index));
  }
  const preprintType = pubTypeMatch(citation.publicationTypes, /\bpreprint\b/i);
  if (preprintType) push("preprint", "pubtype", preprintType);

  const model = wholeWordMatch(text, LEXICONS["model-system"]);
  if (model) push("model-system", "lexicon", quoteAt(text, model.index));

  if (target) {
    const same = variantsIn(text).find(candidate =>
      candidate.key.wildType === target.wildType && candidate.key.position === target.position && candidate.key.alternate !== target.alternate
    );
    if (same) push("same-residue", "lexicon", quoteAt(text, same.index));
  }

  const abstractVariants = variantsIn(abstract);
  if (new Set(abstractVariants.map(variant => `${variant.key.wildType}${variant.key.position}${variant.key.alternate}`)).size >= MULTI_VARIANT_THRESHOLD) {
    push("multi-variant", "lexicon", quoteAt(abstract, abstractVariants[0].index));
  }

  if (mentions.level === "elsewhere") push("full-text-only", "lexicon", firstSentence(title) ?? firstSentence(abstract));

  return {
    tags,
    mechanismTerms,
    tier: attentionTier({ tags, citedBy }),
    ...(citedBy.length ? { citedBy } : {}),
  };
}

/** The six visible ordering tiers. This is an ordering rule, not a score. */
export function attentionTier(screening: {
  tags: ScreeningTag[];
  citedBy?: readonly CuratedCitationReading[];
}): AttentionTier {
  const has = (tag: ScreeningTagName) => screening.tags.some(item => item.tag === tag);
  const anchored = screening.tags.some(item =>
    (item.tag === "functional-assay" || item.tag === "clinical-case") && item.source === "sentence-anchor"
  );
  // A curated record relationship is variant-specific by construction, so it counts exactly like a
  // quote-backed names-variant tag for ordering — but it is reported separately, never as a quote.
  const curated = (screening.citedBy?.length ?? 0) > 0
    || screening.tags.some(item => item.source === "curated" && item.tag === "names-variant");
  if ((anchored || curated) && !has("multi-variant") && !has("review")) return 1;
  // `multi-variant` alone says only that many substitutions are listed, not that ours is among them.
  if (has("names-variant")) return 2;
  if (has("same-residue")) return 3;
  if (has("names-gene") && (has("mechanism") || has("functional-assay") || has("clinical-case") || has("review"))) return 4;
  if (has("names-gene")) return 5;
  return 6;
}

const TIER_NAMES: Record<AttentionTier, string> = {
  1: "Variant-anchored",
  2: "Variant named",
  3: "Same residue",
  4: "Gene context",
  5: "Gene only",
  6: "Full-text only",
};

/** One rule-built line for the paper list; no quote means no line. */
export function whyRead(screening: PaperScreening): string | null {
  const sourceOrder: ScreeningTagSource[] = ["sentence-anchor", "curated", "pubtype", "lexicon"];
  const strongest = sourceOrder
    .map(source => screening.tags.find(tag => tag.source === source && tag.tag !== "model-system"))
    .find(Boolean) ?? screening.tags.find(tag => tag.tag !== "model-system");
  if (!strongest) {
    // A curated-only row has no quotable sentence; its line is the provider relationship, not a quote.
    const curated = screening.citedBy?.[0];
    return curated ? [TIER_NAMES[screening.tier], curated.label, curated.detail].filter(Boolean).join(" · ") : null;
  }
  const source = strongest.source === "sentence-anchor" ? "sentence anchor" : strongest.source === "pubtype" ? "publication type" : strongest.source;
  const model = screening.tags.find(tag => tag.tag === "model-system");
  const curated = screening.citedBy?.[0];
  // The curated relationship names the strongest signal in the row; keep it in the line beside the quote.
  return [TIER_NAMES[screening.tier], curated?.label, `“${strongest.quote}”`, source, model?.quote].filter(Boolean).join(" · ");
}

export interface GeneConstraint {
  pli: number | null;
  loeuf: number | null;
  missense_z: number | null;
  oe_mis: number | null;
}

/** Existing published LOEUF cut-point; no pLI cut-point is invented here. */
export const LOSS_OF_FUNCTION_CONSTRAINT_THRESHOLDS = {
  loeufConstrainedBelow: THRESHOLDS.loeuf.pathogenicSupporting,
} as const;

export interface MechanismFit {
  state: "unavailable" | "constraint-silent" | "compared";
  flag: "terms differ from context" | null;
}

/**
 * The narrow UI-plan comparison: only LoF/haploinsufficiency versus LOEUF. Dominant-negative
 * and gain-of-function are intentionally constraint-silent, not inferred from missense values.
 */
export function mechanismFit(
  terms: readonly Pick<MechanismTerm, "term">[],
  constraint: GeneConstraint | null | undefined,
  thresholds = LOSS_OF_FUNCTION_CONSTRAINT_THRESHOLDS,
): MechanismFit {
  if (!constraint) return { state: "unavailable", flag: null };
  const normalised = terms.map(term => term.term.toLowerCase());
  if (normalised.some(term => term.includes("dominant-negative") || term.includes("dominant negative") || term.includes("gain-of-function") || term.includes("gain of function"))) {
    return { state: "constraint-silent", flag: null };
  }
  if (!normalised.some(term => term.includes("loss-of-function") || term.includes("loss of function") || term.includes("haploinsufficiency"))) {
    return { state: "unavailable", flag: null };
  }
  if (constraint.loeuf === null) return { state: "unavailable", flag: null };
  return constraint.loeuf >= thresholds.loeufConstrainedBelow
    ? { state: "compared", flag: "terms differ from context" }
    : { state: "compared", flag: null };
}
