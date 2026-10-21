import { classifyNotation, type NotationKind } from "./variantNotation.ts";

/**
 * Quick entry: one line that is spread over the four query fields.
 *
 * Pure on purpose. The form's fields stay the single source of truth (store-bound, validated and
 * routed there); this only decides which field each part of a typed line belongs to, so the
 * grammar lives in one tested place and the component stays a thin wrapper.
 */
export interface QuickEntryFields {
  gene: string;
  variant: string;
  genomic: string;
  /** Only set when the line carried an accession; otherwise the caller leaves the field alone. */
  uniprot: string | null;
}

export interface QuickEntryReading extends QuickEntryFields {
  /** What the variant part was read as, `unknown` while it is still being typed. */
  kind: NotationKind | "none";
  /** True when every part of the line was placed on a field the pipeline can route. */
  recognised: boolean;
}

const UNIPROT_PATTERN = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})(?:-\d+)?$/i;
const GENE_PATTERN = /^[A-Za-z][A-Za-z0-9-]{1,14}$/;

const GENOMIC_KINDS: ReadonlySet<NotationKind> = new Set([
  "genomic-hgvs",
  "genomic-dashed",
  "genomic-bare",
  "rsid",
  "clinvar-vcv",
]);

const isNotation = (text: string): boolean => classifyNotation(text).kind !== "unknown";

/**
 * `GENE p.Arg248Trp`, `GENE:p.Arg248Trp`, `TP53 R248W Q9H8M5`, `20-23365054-G-A`, `rs28934576`,
 * `NM_000546.6:c.742C>T`. Whitespace separates parts; a single `GENE:` prefix is also accepted,
 * but only when the left side is a bare symbol (never an accession such as `NM_000546.6:`).
 */
export function readQuickEntry(line: string): QuickEntryReading {
  const empty: QuickEntryReading = { gene: "", variant: "", genomic: "", uniprot: null, kind: "none", recognised: false };
  const text = line.trim();
  if (!text) return empty;

  const place = (variant: string, gene: string, uniprot: string | null): QuickEntryReading => {
    const kind = classifyNotation(variant).kind;
    if (kind === "unknown") return { ...empty, gene, variant, uniprot, kind, recognised: false };
    if (GENOMIC_KINDS.has(kind)) return { ...empty, gene, genomic: variant, uniprot, kind, recognised: true };
    return { ...empty, gene, variant, uniprot, kind, recognised: true };
  };

  // The whole line may already be one notation (a coordinate, an rsID, an accessioned HGVS).
  if (isNotation(text)) return place(text, "", null);

  const tokens = text
    .replace(/^([A-Za-z][A-Za-z0-9-]{1,14}):(?=\S)/, "$1 ")
    .split(/\s+/)
    .filter(Boolean);

  let uniprot: string | null = null;
  const last = tokens[tokens.length - 1];
  if (tokens.length >= 3 && UNIPROT_PATTERN.test(last)) {
    uniprot = last.toUpperCase();
    tokens.pop();
  }

  const [head, ...rest] = tokens;
  if (GENE_PATTERN.test(head) && !isNotation(head)) {
    const gene = head.toUpperCase();
    if (rest.length === 0) return { ...empty, gene, kind: "none", recognised: false, uniprot };
    return place(rest.join(""), gene, uniprot);
  }

  // Not a shape we can place: keep the text visible in the notation field so nothing typed is lost.
  return { ...empty, variant: text, kind: "unknown", recognised: false };
}

/** The line a set of fields reads as: the coordinate when there is one, otherwise `GENE notation`. */
export function composeQuickEntry(fields: Pick<QuickEntryFields, "gene" | "variant" | "genomic">): string {
  const genomic = fields.genomic.trim();
  if (genomic) return genomic;
  return [fields.gene.trim(), fields.variant.trim()].filter(Boolean).join(" ");
}

/** True when the line already says what the fields say, so the line need not be rewritten. */
export function quickEntryMatches(line: string, fields: Pick<QuickEntryFields, "gene" | "variant" | "genomic">): boolean {
  const read = readQuickEntry(line);
  return (
    read.gene === fields.gene.trim().toUpperCase() &&
    read.variant === fields.variant.trim() &&
    read.genomic === fields.genomic.trim()
  );
}
