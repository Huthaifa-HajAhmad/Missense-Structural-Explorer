/**
 * multimerAssembly.ts — what a UniProt SUBUNIT annotation says about a protein's assembly, and the
 * one rule for whether a variant residue sits at a modelled interface.
 *
 * Pure; imported by the server (`services/structure/multimer.ts`, `external-api/uniprot.ts`) and by
 * the client model (`interfacesEvidence.ts`), so the assembly the server modelled and the assembly the
 * screen names come from one parser.
 *
 * DEFECTS THIS REPLACED (doc/MULTIMER_TAB_REVIEW.md)
 *   • `parseOligomericState(null)` returned "Monomer", and the SUBUNIT text was read from a field
 *     UniProt does not use, so it was ALWAYS null: every protein was declared "a single-chain
 *     monomer under physiological conditions" — NAE1, a heterodimer with UBA3, included.
 *   • Substring matching: "The complex binds NEDD8" made "Oligomeric Complex (A2)", an invented
 *     stoichiometry; "Homodimer; can also form a homotetramer" was read as a tetramer; "hetero"
 *     anywhere beat "Homodimer" in the first sentence. A second, different regex in `uniprot.ts`
 *     decided `isMultimer` for the Insights warning.
 *   • The interface rule was "any contact within ±4 residues in sequence" on the server and ±2 on the
 *     screen, reported as "directly disrupts inter-chain contacts".
 *
 * INVARIANTS
 *   • No SUBUNIT record is "not stated", never "monomer". Absence is a state.
 *   • The assembly is read from the FIRST sentence that names one; later sentences are kept as
 *     `alsoStated` and shown, never silently preferred or dropped.
 *   • A stoichiometry is only a number when the word states it (dimer = 2). "Component of the X
 *     complex" has no count.
 *   • At the interface means the variant residue ITSELF appears in a contact. Sequence neighbours do
 *     not count, and a contact in the mutant model is not evidence that one is lost.
 */

export type AssemblyKind =
  /** The annotation states a monomer. */
  | "monomer"
  /** Identical chains: "Homodimer", or a bare "Dimer", which UniProt uses for homo-oligomers. */
  | "homomer"
  /** Different chains with a stated count: "Heterodimer of UBA3 and NAE1". */
  | "heteromer"
  /** A member of a named multi-protein complex, stoichiometry not stated. */
  | "complex"
  /** The record lists binary interactions only ("Interacts with …"); no assembly is stated. */
  | "interactions-only"
  /** No SUBUNIT record, or one that states nothing this parser can read. */
  | "unstated";

export interface SubunitAssembly {
  kind: AssemblyKind;
  /** Sentence-case display word: "Homodimer", "Heterodimer", "Monomer", "Complex subunit", "Not stated". */
  label: string;
  /** Total chains the word states (dimer 2, tetramer 4); null when no count is stated. */
  copies: number | null;
  /** True for a bare "Dimer"/"Tetramer": read as homo, the UniProt convention, and said so. */
  homoAssumed: boolean;
  /** Gene-like tokens in the deciding sentence other than the protein's own gene. Candidates only:
   *  the server keeps those that UniProt's curated INTERACTION list resolves to an accession. */
  partnerGenes: string[];
  /** The sentence that decided `kind`, verbatim; null when none did. */
  sentence: string | null;
  /** Other assembly words later in the record ("Homotetramer" after "Homodimer. …"). */
  alsoStated: string[];
  /** UniProt's evidence qualifier on the deciding sentence ("Probable", "By similarity"); null when none. */
  qualifier: string | null;
}

/** One sentence of the record that states an assembly, with its own evidence qualifier. */
export interface SubunitStatement {
  kind: "monomer" | "homomer" | "heteromer" | "complex";
  label: string;
  /** "Probable", "By similarity", "Potential": UniProt's evidence qualifier, verbatim; null when none. */
  qualifier: string | null;
  sentence: string;
  partnerGenes: string[];
  /** A partner named as a family rather than a gene ("other K-Cl cotransporters"). */
  family: string | null;
}

const COUNT_PREFIX: Record<string, number> = {
  di: 2, tri: 3, tetra: 4, penta: 5, hexa: 6, hepta: 7, octa: 8, nona: 9, deca: 10, dodeca: 12,
};

const OLIGOMER_RE = /\b(homo|hetero)?(di|tri|tetra|penta|hexa|hepta|octa|nona|deca|dodeca)mer(?:s|ic)?\b/gi;
const MONOMER_RE = /\bmonomer(?:s|ic)?\b/i;
const COMPLEX_RE = /\b(component|subunit|part) of (?:the |a |an )?[^.;]*\bcomplex(?:es)?\b/i;
const INTERACTS_RE = /\b(interacts?|binds?|associates?) with\b|\bbinds\b/i;

/** Tokens that look like gene symbols but are not. */
/** UniProt's evidence qualifiers, as they appear in free-text comments: "(Probable)", "(By similarity)". */
const QUALIFIER_RE = /\((Probable|By similarity|Potential)\)/i;

export function qualifierOf(sentence: string): string | null {
  const m = QUALIFIER_RE.exec(sentence);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : null;
}

const NOT_GENES = new Set([
  "ATP", "ADP", "GTP", "GDP", "DNA", "RNA", "MRNA", "TRNA", "RRNA", "NAD", "NADH", "NADP", "NADPH",
  "FAD", "FMN", "CAMP", "CGMP", "SH2", "SH3", "PDZ", "WD", "II", "III", "IV", "MHC", "HLA", "PH",
]);

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.;])\s+(?=[A-Z(])/)
    .map(s => s.trim())
    .filter(Boolean);
}

function partnerTokens(sentence: string, ownGene: string | null | undefined): string[] {
  const own = (ownGene ?? "").toUpperCase();
  const out: string[] = [];
  for (const m of sentence.matchAll(/\b[A-Z][A-Z0-9]{1,9}(?:-[A-Z0-9]{1,4})?\b/g)) {
    const t = m[0];
    if (!/[A-Z]/.test(t.slice(1)) && !/\d/.test(t)) continue;
    if (t === own || NOT_GENES.has(t) || out.includes(t)) continue;
    out.push(t);
  }
  return out;
}

/**
 * Read the assembly a SUBUNIT annotation states.
 *
 * @param text the SUBUNIT free text, verbatim (null when UniProt has no SUBUNIT record)
 * @param ownGene the protein's own gene symbol, excluded from `partnerGenes`
 */
export function parseSubunitAssembly(text: string | null | undefined, ownGene?: string | null): SubunitAssembly {
  const base: SubunitAssembly = {
    kind: "unstated", label: "Not stated", copies: null, homoAssumed: false,
    partnerGenes: [], sentence: null, alsoStated: [], qualifier: null,
  };
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return base;

  const sentences = splitSentences(clean);
  let decided: SubunitAssembly | null = null;

  for (const sentence of sentences) {
    OLIGOMER_RE.lastIndex = 0;
    const olig = OLIGOMER_RE.exec(sentence);
    const monoIdx = sentence.search(MONOMER_RE);
    const oligIdx = olig ? olig.index : -1;

    if (!decided) {
      if (olig && (monoIdx < 0 || oligIdx < monoIdx)) {
        const [, homoHetero, prefix] = olig;
        const copies = COUNT_PREFIX[prefix.toLowerCase()] ?? null;
        const hetero = homoHetero?.toLowerCase() === "hetero";
        const word = `${homoHetero ? homoHetero.toLowerCase() : "homo"}${prefix.toLowerCase()}mer`;
        decided = {
          kind: hetero ? "heteromer" : "homomer",
          label: titleCase(word),
          copies,
          homoAssumed: !homoHetero,
          partnerGenes: hetero ? partnerTokens(sentence, ownGene) : [],
          sentence,
          alsoStated: [],
          qualifier: qualifierOf(sentence),
        };
        // A monomer named later in the same sentence ("Homodimer and monomer") is kept, not lost.
        if (monoIdx > oligIdx) decided.alsoStated.push("Monomer");
        continue;
      }
      if (monoIdx >= 0) {
        decided = { ...base, kind: "monomer", label: "Monomer", copies: 1, sentence, qualifier: qualifierOf(sentence) };
        if (olig) decided.alsoStated.push(titleCase(olig[0]));
        continue;
      }
      if (COMPLEX_RE.test(sentence)) {
        decided = {
          ...base, kind: "complex", label: "Complex subunit", sentence, qualifier: qualifierOf(sentence),
          partnerGenes: partnerTokens(sentence, ownGene),
        };
        continue;
      }
      continue;
    }

    // Later sentences: record other assembly words so the screen can show them beside the decision.
    OLIGOMER_RE.lastIndex = 0;
    for (const m of sentence.matchAll(OLIGOMER_RE)) {
      const w = titleCase(m[0].replace(/(s|ic)$/i, ""));
      if (w.toLowerCase() !== decided.label.toLowerCase() && !decided.alsoStated.includes(w)) decided.alsoStated.push(w);
    }
    if (decided.kind !== "monomer" && MONOMER_RE.test(sentence) && !decided.alsoStated.includes("Monomer")) {
      decided.alsoStated.push("Monomer");
    }
  }

  if (decided) return decided;
  if (INTERACTS_RE.test(clean)) {
    return { ...base, kind: "interactions-only", label: "Interactions only", sentence: sentences[0] ?? null };
  }
  return base;
}

/**
 * Every sentence that states an assembly, in record order, each with its qualifier. "Homodimer (…).
 * Heterodimer with other K-Cl cotransporters (Probable)" gives two statements; the second names a
 * family, not a gene, so it is carried as `family` and is never resolved to genes by guessing.
 */
export function subunitStatements(text: string | null | undefined, ownGene?: string | null): SubunitStatement[] {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const out: SubunitStatement[] = [];
  const SIZE = ["di", "tri", "tetra", "penta", "hexa", "hepta", "octa", "nona", "deca", "dodeca"];
  for (const sentence of splitSentences(clean)) {
    // The largest assembly a sentence states: "The heterodimer CCS:SOD1 interacts with SLC31A1; this
    // heterotrimer …" states a heterotrimer with CCS and SLC31A1. Reading the first word made SLC31A1 a
    // "heterodimer" partner of SOD1.
    let olig: RegExpExecArray | null = null;
    OLIGOMER_RE.lastIndex = 0;
    for (let m = OLIGOMER_RE.exec(sentence); m; m = OLIGOMER_RE.exec(sentence)) {
      if (!olig || SIZE.indexOf(m[2].toLowerCase()) > SIZE.indexOf(olig[2].toLowerCase())) olig = m;
    }
    OLIGOMER_RE.lastIndex = 0;
    const monoIdx = sentence.search(MONOMER_RE);
    const qualifier = qualifierOf(sentence);
    if (olig && (monoIdx < 0 || olig.index < monoIdx)) {
      const hetero = olig[1]?.toLowerCase() === "hetero";
      const label = titleCase(`${olig[1] ? olig[1].toLowerCase() : "homo"}${olig[2].toLowerCase()}mer`);
      const partnerGenes = hetero ? partnerTokens(sentence, ownGene) : [];
      let family: string | null = null;
      if (hetero && partnerGenes.length === 0) {
        const m = /\bwith\s+(.+?)(?:\s*\(|[.;]|$)/i.exec(sentence.slice(olig.index));
        family = m ? m[1].trim() : null;
      }
      out.push({ kind: hetero ? "heteromer" : "homomer", label, qualifier, sentence, partnerGenes, family });
    } else if (monoIdx >= 0) {
      out.push({ kind: "monomer", label: "Monomer", qualifier, sentence, partnerGenes: [], family: null });
    } else if (COMPLEX_RE.test(sentence)) {
      out.push({ kind: "complex", label: "Complex subunit", qualifier, sentence, partnerGenes: partnerTokens(sentence, ownGene), family: null });
    }
  }
  return out;
}

/** Whether the annotation states more than one chain: the one `isMultimer` rule. */
export function statesMultimer(assembly: SubunitAssembly): boolean {
  return assembly.kind === "homomer" || assembly.kind === "heteromer" || assembly.kind === "complex";
}

/**
 * Every gene-like token the SUBUNIT text names, each with the sentence that names it. The Protein
 * interactions tab lists these as "named in SUBUNIT"; `parseSubunitAssembly` reads only the sentence
 * that decides the assembly, so "The complex binds NEDD8 and UBE2M. Binds APP" would be lost there.
 * Candidates only: a token is a symbol in the text, not a resolved accession.
 */
export function subunitPartnerMentions(
  text: string | null | undefined,
  ownGene?: string | null
): Array<{ gene: string; sentence: string }> {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const out: Array<{ gene: string; sentence: string }> = [];
  for (const sentence of splitSentences(clean)) {
    for (const gene of partnerTokens(sentence, ownGene)) {
      if (!out.some(m => m.gene === gene)) out.push({ gene, sentence });
    }
  }
  return out;
}

/** The most chains this app submits for one complex prediction. */
export const MAX_MODELLED_CHAINS = 4;

export interface InterfaceContact {
  resA: number;
  resB: number;
  distance: number;
}

/**
 * Contacts the variant residue itself makes in the model.
 *
 * The provider reports `resA` on the chain submitted first — the one carrying the variant — and
 * `resB` on a partner chain. In a homomer every chain is numbered the same, so the variant's
 * position on a partner (`resB`) is the same residue, wild type; that contact is a copy of the
 * variant residue touching the mutant chain and still places the position at the interface.
 * In a heteromer `resB` is the partner's numbering and must never be matched to the variant.
 */
export function variantContacts(
  contacts: ReadonlyArray<InterfaceContact> | null | undefined,
  position: number | null | undefined,
  homomeric: boolean
): InterfaceContact[] {
  if (!contacts?.length || !position || position < 1) return [];
  return contacts
    .filter(c => c.resA === position || (homomeric && c.resB === position))
    .slice()
    .sort((a, b) => a.distance - b.distance);
}

/** The residues on the variant's chain that make any contact, sorted, unique. */
export function interfaceFootprint(
  contacts: ReadonlyArray<InterfaceContact> | null | undefined,
  homomeric: boolean
): number[] {
  const set = new Set<number>();
  for (const c of contacts ?? []) {
    if (Number.isFinite(c.resA) && c.resA > 0) set.add(c.resA);
    if (homomeric && Number.isFinite(c.resB) && c.resB > 0) set.add(c.resB);
  }
  return [...set].sort((a, b) => a - b);
}
