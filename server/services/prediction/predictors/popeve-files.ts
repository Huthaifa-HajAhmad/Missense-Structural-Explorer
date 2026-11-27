import { z } from "zod";
import { refseqCache } from "../../infra/cache.ts";
import { fetchWithRetry } from "../../infra/http-client.ts";
import { toSingleAa } from "./normalizer.ts";
import { UNIPROT_ACCESSION_REGEX } from "./transcript-resolver.ts";
import type { PopEveSource } from "../../../../src/shared/contracts.ts";
import { mapIsoformResidue } from "../../../../src/shared/isoformResidue.ts";

/** A popEVE score with the protein and substitution popEVE scored, so a reader can check them. */
export type PopEveHit = PopEveSource & { score: number };

/** A one-letter substitution, such as G358R. */
export interface Substitution { wt: string; pos: number; alt: string }

const AMINO_ACID = /^[ACDEFGHIKLMNPQRSTVWY]$/;

/** popEVE scores changes between the 20 amino acids only, so a stop or a frameshift gives null. */
export function parseSubstitution(variant: string): Substitution | null {
  const match = variant.replace(/^p\./i, "").match(/([A-Z]{1,3})[=:/]?(\d+)[=:/]?([A-Z]{1,3})/i);
  if (!match) return null;
  const [wt, alt] = [toSingleAa(match[1]), toSingleAa(match[3])];
  return AMINO_ACID.test(wt) && AMINO_ACID.test(alt) ? { wt, pos: Number(match[2]), alt } : null;
}

export const substitutionText = (s: Substitution) => `${s.wt}${s.pos}${s.alt}`;

/**
 * One protein's popEVE file. `absent` is popEVE's definite answer that it has no file for this
 * protein; `error` (a timeout, a 5xx, another refusal) says nothing and must not be remembered.
 */
export type PopEveFile =
  | { kind: "found"; scores: Map<string, number>; sequence: string }
  | { kind: "absent" }
  | { kind: "error" };

export async function fetchPopEveFile(refseqId: string): Promise<PopEveFile> {
  const res = await fetchWithRetry(`https://data.evemodel.org/popeve/v1.1/mutations/${refseqId}.csv`, { timeout: 3000 }, 1);
  if (!res.ok) {
    // The files sit in an S3 bucket that answers a missing key with 403 `AccessDenied`, not 404
    // (checked live 2026-10-14), so that exact answer counts as absent too.
    const absent = res.status === 404 ||
      (res.status === 403 && /<Code>AccessDenied<\/Code>/.test(await res.text().catch(() => "")));
    return { kind: absent ? "absent" : "error" };
  }
  const [head, ...lines] = (await res.text()).split(/\r?\n/);
  const scoreIdx = head.split(",").indexOf("popEVE");
  if (scoreIdx === -1) return { kind: "error" };
  const scores = new Map<string, number>();
  // The file has one row per possible substitution, so its first column also spells the protein.
  const residues: string[] = [];
  for (const line of lines) {
    const parts = line.split(",");
    const m = parts[0].match(/^([A-Z])(\d+)[A-Z]$/);
    if (!m) continue;
    residues[Number(m[2]) - 1] ??= m[1];
    const score = parseFloat(parts[scoreIdx]);
    if (!Number.isNaN(score)) scores.set(parts[0], score);
  }
  return { kind: "found", scores, sequence: Array.from(residues, r => r ?? "?").join("") };
}

const isoformEntrySchema = z.object({
  sequence: z.object({ value: z.string() }).optional(),
  uniProtKBCrossReferences: z.array(z.object({ database: z.string(), id: z.string() })).default([]),
});
type IsoformEntry = { sequence: string; refseqs: string[] };

/**
 * The main sequence and every RefSeq protein (NP_) of the entry. Kept in the RefSeq cache under its
 * own key prefix, since it answers a different question than the displayed-isoform lookup.
 */
async function isoformEntry(proteinOrGene: string): Promise<IsoformEntry | null | "error"> {
  const input = proteinOrGene.trim();
  const key = `isoforms:${input}`;
  if (refseqCache.has(key)) return refseqCache.get(key) as IsoformEntry | null;
  const fields = "fields=xref_refseq,sequence";
  const url = UNIPROT_ACCESSION_REGEX.test(input)
    ? `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(input)}.json?${fields}`
    : `https://rest.uniprot.org/uniprotkb/search?query=gene_exact:${encodeURIComponent(input)}+AND+organism_id:9606&${fields}&format=json`;
  const res = await fetchWithRetry(url, { timeout: 10000 });
  if (!res.ok) {
    if (res.status !== 404) return "error";
    refseqCache.set(key, null);
    return null;
  }
  const payload = await res.json();
  const parsed = z.union([z.object({ results: z.array(isoformEntrySchema) }), isoformEntrySchema]).safeParse(payload);
  if (!parsed.success) return "error";
  const entries = "results" in parsed.data ? parsed.data.results : [parsed.data];
  const entry = entries
    .map(e => ({ sequence: e.sequence?.value ?? "", refseqs: e.uniProtKBCrossReferences.filter(x => x.database === "RefSeq" && x.id.startsWith("NP_")).map(x => x.id) }))
    .find(e => e.sequence && e.refseqs.length > 0) ?? null;
  refseqCache.set(key, entry);
  return entry;
}

/**
 * popEVE scores one protein per gene, which is not always UniProt's main isoform (ABCG1: only
 * NP_997057.1). When the main isoform has no file, the gene's other RefSeq proteins are tried in
 * turn and the residue is renumbered onto the first file that holds it. "error" means the answer is
 * unknown (a file did not answer), so it is not remembered.
 */
export async function otherIsoformHit(proteinOrGene: string, sub: Substitution, skip: string | null): Promise<PopEveHit | null | "error"> {
  const entry = await isoformEntry(proteinOrGene);
  if (entry === null || entry === "error") return entry;
  const candidates = [...new Set(entry.refseqs)].filter(id => id !== skip);
  const files = await Promise.all(candidates.map(async id => ({ id, file: await fetchPopEveFile(id) })));
  for (const { id, file } of files) {
    if (file.kind !== "found") continue;
    const pos = mapIsoformResidue(entry.sequence, file.sequence, sub.pos, sub.wt);
    if (pos === null) continue;
    const substitution = substitutionText({ ...sub, pos });
    const score = file.scores.get(substitution);
    if (score !== undefined) return { score, protein: id, substitution, match: "other-isoform" };
  }
  return files.some(f => f.file.kind === "error") ? "error" : null;
}
