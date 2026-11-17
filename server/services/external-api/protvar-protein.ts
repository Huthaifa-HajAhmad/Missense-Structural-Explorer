/**
 * protvar-protein.ts — every GRCh38 single-base allele that produces a protein change.
 *
 *   GET https://www.ebi.ac.uk/ProtVar/api/mapping?q=<UniProt accession> <wt><position><mut>
 *
 * ProtVar reads the reference codon on GRCh38 and numbers residues on the UniProt canonical isoform,
 * which is the numbering this platform models. For FGFR3 p.Gly380Arg (codon GGG) it lists G>C and G>A
 * at 4-1804392, each with a CADD score. Unlike MyVariant.info, the ids are already GRCh38, so no
 * lift is needed, and the list comes from the codon itself rather than from a text search.
 *
 * An allele is kept only when it gives exactly the requested change at the requested position on the
 * requested canonical accession. A paged answer that is not the last page is `incomplete`: a partial
 * list must never be read as the complete set of candidates.
 */
import { fetchWithRetry } from "../infra/http-client.ts";

export interface ProtVarAllele {
  /** GRCh38 gnomAD-style id, "4-1804392-G-C". */
  id: string;
  caddPhred: number | null;
  /** Ensembl transcript of the canonical isoform, when ProtVar names one. */
  transcript: string | null;
  /**
   * The nucleotide change on that transcript, "ENST…:c.1138G>C". Written from ProtVar's own
   * transcript-strand codons, so it is right on a reverse-strand gene too. Null when the codon data
   * is missing or inconsistent: it is never guessed.
   */
  cdna: string | null;
}

export type ProtVarProteinAlleles =
  | { status: "found"; alleles: ProtVarAllele[] }
  | { status: "absent" | "incomplete"; reason: string };

const ONE_LETTER: Record<string, string> = {
  Ala: "A", Arg: "R", Asn: "N", Asp: "D", Cys: "C", Gln: "Q", Glu: "E", Gly: "G", His: "H", Ile: "I",
  Leu: "L", Lys: "K", Met: "M", Phe: "F", Pro: "P", Ser: "S", Thr: "T", Trp: "W", Tyr: "Y", Val: "V",
};

/**
 * The cDNA change from the isoform's codon data. The coding position is the residue's first base plus
 * the position inside the codon; the two bases are read from the same position in each codon.
 */
function cdnaChange(iso: any, transcript: string | null): string | null {
  const ref = typeof iso.refCodon === "string" ? iso.refCodon.toUpperCase() : "";
  const alt = typeof iso.variantCodon === "string" ? iso.variantCodon.toUpperCase() : "";
  const at = iso.codonPosition;
  if (!/^[ACGT]{3}$/.test(ref) || !/^[ACGT]{3}$/.test(alt) || ![1, 2, 3].includes(at) || ref[at - 1] === alt[at - 1]) return null;
  const change = `c.${(iso.isoformPosition - 1) * 3 + at}${ref[at - 1]}>${alt[at - 1]}`;
  return transcript ? `${transcript}:${change}` : change;
}

/** Throws on transport failure: an outage is not a fact about the variant. */
export async function fetchProtVarProteinAlleles(
  accession: string,
  position: number,
  wt: string,
  mut: string,
): Promise<ProtVarProteinAlleles> {
  const query = `${accession} ${wt}${position}${mut}`;
  const response = await fetchWithRetry(
    `https://www.ebi.ac.uk/ProtVar/api/mapping?q=${encodeURIComponent(query)}&assembly=GRCh38`,
    { headers: { Accept: "application/json" }, timeout: 10_000 },
    1,
  );
  if (!response.ok) throw new Error(`ProtVar mapping answered HTTP ${response.status}`);
  const body = (await response.json()) as any;
  if (body?.content?.last === false) return { status: "incomplete", reason: "ProtVar returned a partial, paged answer" };

  const alleles = new Map<string, ProtVarAllele>();
  for (const input of body?.content?.inputs ?? []) {
    for (const derived of input?.derivedGenomicVariants ?? []) {
      for (const gene of derived?.genes ?? []) {
        const match = (gene?.isoforms ?? []).find((iso: any) => iso?.canonical === true && iso.accession === accession &&
          iso.isoformPosition === position && ONE_LETTER[iso.refAA] === wt && ONE_LETTER[iso.variantAA] === mut);
        const ref = String(derived.refBase ?? "").toUpperCase();
        const alt = String(derived.altBase ?? "").toUpperCase();
        if (!match || !/^[ACGT]$/.test(ref) || !/^[ACGT]$/.test(alt)) continue;
        const id = `${String(derived.chromosome).replace(/^chr/i, "")}-${derived.position}-${ref}-${alt}`;
        const transcript = match.transcripts?.[0]?.enst ?? null;
        alleles.set(id, {
          id,
          caddPhred: typeof gene.caddScore === "number" && Number.isFinite(gene.caddScore) ? gene.caddScore : null,
          transcript,
          cdna: cdnaChange(match, transcript),
        });
      }
    }
  }
  return alleles.size > 0
    ? { status: "found", alleles: [...alleles.values()] }
    : { status: "absent", reason: `ProtVar lists no GRCh38 allele giving ${wt}${position}${mut} on ${accession}` };
}
