/**
 * variantQuery.ts — Parse one free-text line into a variant query.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The command palette accepts a whole query in a single line ("BRCA1 R175H"), where the
 * Variant query form has always had one field per part. A single line has to be split back into
 * gene / substitution / coordinates / accession, and doing that with a naive `split(" ")`
 * guesses wrong in exactly the cases users paste: `Q9Y305` looks numeric, `20-23365054-G-A`
 * contains no spaces at all, and every English word matches a gene-symbol shape. So the
 * rules are stated once, here, and tested.
 *
 * SLOT ASSIGNMENT
 * ---------------
 * Tokens are read left to right and each fills the first empty slot it qualifies for, so
 * `R175H BRCA1` and `BRCA1 R175H` both resolve. Order of qualification is deliberate:
 * accession before coordinate before protein, because a UniProt ID is the most specific
 * shape and a gene symbol is the least.
 *
 * THE GENE RULE IS CASE-SENSITIVE ON PURPOSE
 * ------------------------------------------
 * `/^[A-Z][A-Z0-9-]{0,11}$/` accepts "BRCA1" and "B2M" and rejects "settings" — a
 * case-insensitive symbol test would read any short English word as a gene and the palette
 * would offer "analyze settings" for every keystroke. Lower-case input is still handled:
 * when another token is unmistakably a variant, the remaining token is taken as the gene
 * whatever its case, because "brca1 r175h" has no other reading.
 *
 * BOUNDARY CONTRACT: imported by `src/` only, and it may import nothing outside
 * `src/shared/` (enforced by scripts/check-boundaries.ts).
 */

import { classifyNotation, needsNotationResolution } from "./variantNotation";

/** Tokens are separated by whitespace or commas, so "BRCA1, R175H" reads as two parts. */
const TOKEN_SPLIT = /[\s,]+/;

/**
 * Upper-case as typed: the convention that separates "BRCA1" from "settings", with a
 * two-character floor so a single keystroke never proposes a gene.
 */
const STRICT_GENE_PATTERN = /^[A-Z][A-Z0-9-]{1,11}$/;

/** Any letter-initial short token — the fallback gene once a variant proves the intent. */
const LOOSE_GENE_PATTERN = /^[A-Za-z][A-Za-z0-9-]{1,11}$/;

/**
 * Genome-build annotations, which lead real coordinate pastes: `GRCh37 17-7676154-C-T`.
 *
 * They are noise, never a gene. Left in the token stream `GRCh37` matched the symbol shape
 * and became the gene of a run that then analysed a gene called `GRCH37`, which does not exist.
 */
const ASSEMBLY_PATTERN = /^(?:GRCh\d{1,2}|hg(?:19|38)|NC_?\d[\w.]*)$/i;

/**
 * Upper-case English words that happen to fit the gene-symbol shape.
 *
 * The case-sensitive symbol test already rejects `settings`; this is the same trap for caps
 * lock, and for the vocabulary the palette itself prints. Without the list, `DNA`, `AND` and
 * `OK` each offered a run against a gene that does not exist. Kept to words a person types
 * while searching, and to shapes no real symbol uses — `MY` (myoglobin) and `AS` (asporin) are
 * genuine gene symbols and are deliberately absent.
 */
const NOT_A_GENE = new Set([
  "A", "AM", "AN", "AND", "ANY", "ARE", "BUT", "BY", "CAN", "DID", "DNA", "DO", "FOR", "FROM",
  "GET", "GOT", "HAS", "HAD", "HER", "HIM", "HIS", "HOW", "IF", "IN", "IS", "IT", "ITS", "ME",
  "NO", "NOT", "NOW", "OF", "OK", "ON", "OR", "OUR", "OUT", "RNA", "SHE", "SO", "THE", "THIS",
  "TO", "UP", "US", "WAS", "WE", "WHAT", "WHEN", "WHO", "WHY", "YES", "YOU", "YOUR",
]);

/** UniProt accessions, canonical and TrEMBL formats, with an optional isoform suffix. */
const UNIPROT_PATTERN =
  /^(?:[OPQ]\d[A-Z\d]{3}\d|[NPRQ][A-Z\d]{4}\d|[A-NR-Z]\d(?:[A-Z][A-Z\d]{2}\d){2})(?:-\d{1,2})?$/;

const GENOMIC_KINDS = new Set([
  "genomic-hgvs",
  "genomic-dashed",
  "genomic-bare",
  "cdna",
  "non-substitution",
]);

const PROTEIN_KINDS = new Set(["protein-hgvs", "protein-foldx", "protein-accessioned"]);

export interface VariantQuery {
  /** HGNC-style symbol, upper-cased. `null` when no token read as a gene. */
  gene: string | null;
  /** Protein substitution exactly as typed — the pipeline accepts 1- and 3-letter HGVS. */
  variant: string | null;
  /** Coordinate or cDNA notation, exactly as typed. Wins over `variant` downstream. */
  genomic: string | null;
  /** UniProt accession, upper-cased. */
  uniprot: string | null;
  /** At least one slot was recognised, so a query row is worth showing. */
  recognised: boolean;
  /**
   * Enough input to launch the pipeline.
   *
   * Not a copy of the Variant query form's rule — that form has no such rule beyond its disabled
   * button, so this is stated here against what the pipeline actually does with the fields:
   * Stage 1 resolves a gene out of coordinates, and nothing resolves a gene out of an accession.
   * See the `runnable` computation below.
   */
  runnable: boolean;
  /** The coordinate / accession-qualified notation has to be VEP-resolved before modelling. */
  needsResolution: boolean;
  /** Compact monospace label for the palette row, e.g. `"BRCA1 · R175H"`. */
  label: string;
}

const EMPTY_QUERY: VariantQuery = {
  gene: null,
  variant: null,
  genomic: null,
  uniprot: null,
  recognised: false,
  runnable: false,
  needsResolution: false,
  label: "",
};

/**
 * Split a free-text palette line into the four fields the Variant query form collects.
 *
 * Never throws and never guesses a variant: unrecognised input comes back with
 * `recognised: false`, which is the caller's cue to stay out of the way.
 */
export function parseVariantQuery(raw: string | null | undefined): VariantQuery {
  const tokens = (raw ?? "")
    .trim()
    .split(TOKEN_SPLIT)
    .filter(Boolean)
    .slice(0, 6);

  if (tokens.length === 0) return { ...EMPTY_QUERY };

  let gene: string | null = null;
  let variant: string | null = null;
  let genomic: string | null = null;
  let uniprot: string | null = null;
  const looseCandidates: string[] = [];

  for (const token of tokens) {
    /* A build annotation is not a query part. Dropping it here rather than after slot
       assignment is what keeps `GRCh37 17-7676154-C-T` from running as gene `GRCH37`. */
    if (ASSEMBLY_PATTERN.test(token)) continue;

    if (!uniprot && UNIPROT_PATTERN.test(token)) {
      uniprot = token.toUpperCase();
      continue;
    }

    const { kind } = classifyNotation(token);
    if (!genomic && GENOMIC_KINDS.has(kind)) {
      genomic = token;
      continue;
    }
    if (!variant && PROTEIN_KINDS.has(kind)) {
      variant = token;
      continue;
    }
    if (!gene && STRICT_GENE_PATTERN.test(token) && !NOT_A_GENE.has(token)) {
      gene = token;
      continue;
    }
    if (LOOSE_GENE_PATTERN.test(token) && !NOT_A_GENE.has(token.toUpperCase())) {
      looseCandidates.push(token);
    }
  }

  /* Nothing claimed this token, but the query is demonstrably about a variant, so the
     leftover is the gene — which is the only reading of "brca1 r175h". */
  if (!gene && (variant || genomic) && looseCandidates.length === 1) {
    gene = looseCandidates[0].toUpperCase();
  }

  const target = genomic ?? variant;

  /* Every part the run will actually use, in the order a person reads them. The accession
     belongs in the label: `P51587 R175H` used to render as plain `R175H`, and a bare
     accession rendered as an empty string — a row reading `Open in Variant query · ` with nothing
     after it. */
  const labelParts = [gene, target, uniprot].filter((part): part is string => Boolean(part));
  const label = labelParts.join(" · ");

  /* A run needs a target plus something to resolve it from, and coordinates are the exception:
     they resolve their own gene in Stage 1. So a coordinate stands alone, a substitution needs
     a gene or an accession beside it, and a lone gene or accession is recognised but not
     runnable — there is nothing to analyse. */
  const runnable = Boolean(genomic || (target && (gene || uniprot)));

  return {
    gene,
    variant,
    genomic,
    uniprot,
    recognised: Boolean(gene || variant || genomic || uniprot),
    runnable,
    needsResolution: target ? needsNotationResolution(target) : false,
    label,
  };
}
