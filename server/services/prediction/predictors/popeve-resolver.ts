import { z } from "zod";
import { TabixIndexedFile } from "@gmod/tabix";
import path from "path";
import fs from "fs";
import { popEVECache, popEveOnlineCache, refseqCache } from "../../infra/cache.ts";
import { fetchWithRetry } from "../../infra/http-client.ts";
import { toSingleAa } from "./normalizer.ts";
import { UNIPROT_ACCESSION_REGEX } from "./transcript-resolver.ts";

let popEVETabix: TabixIndexedFile | null = null;

/** The UniProt entry shape the resolver reads; anything beyond it is skipped, never a parse failure. */
const uniprotEntrySchema = z.object({
  uniProtKBCrossReferences: z.array(z.object({ database: z.string(), id: z.string(), isoformId: z.string().optional() })).default([]),
  comments: z.array(z.object({
    isoforms: z.array(z.object({ isoformIds: z.array(z.string()).default([]), isoformSequenceStatus: z.string().optional() })).default([]),
  })).default([]),
});
const uniprotSearchSchema = z.object({ results: z.array(uniprotEntrySchema) });

export function getPopEVETabix(): TabixIndexedFile | null {
  if (popEVETabix) return popEVETabix;
  const vcfPath = path.join(process.cwd(), "data", "popeve", "popeve_grch38.vcf.gz");
  if (!fs.existsSync(vcfPath)) return null;
  popEVETabix = new TabixIndexedFile({
    path: vcfPath
  });
  return popEVETabix;
}

export async function fetchPopEVEScore(
  chrom: string,
  pos: number,
  ref: string,
  alt: string
): Promise<number | null> {
  const cacheKey = `${chrom}:${pos}:${ref}:${alt}`;
  const cached = popEVECache.get(cacheKey);
  if (cached !== undefined) return cached;

  const tbi = getPopEVETabix();
  if (!tbi) {
    return null;
  }

  const chromNorm = chrom.startsWith("chr") ? chrom : `chr${chrom}`;
  const chromsToTry = [chromNorm, chromNorm.slice(3)];

  try {
    let score: number | null = null;
    const cleanRef = ref.toUpperCase();
    const cleanAlt = alt.toUpperCase();
    for (const ch of chromsToTry) {
      try {
        await tbi.getLines(ch, pos - 1, pos, (line: string) => {
          const cols = line.split("\t");
          if (cols[1] !== String(pos)) return;
          if (cols[3].toUpperCase() !== cleanRef || cols[4].toUpperCase() !== cleanAlt) return;
          const info = cols[7] ?? "";
          const match = info.match(/popEVE=([0-9.-]+)/);
          if (match) score = parseFloat(match[1]);
        });
        if (score !== null) break;
      } catch (innerErr) {
        // Try next chromosome format
      }
    }
    popEVECache.set(cacheKey, score);
    return score;
  } catch (err: any) {
    console.warn(`[popEVE] Tabix lookup failed for ${chromNorm}:${pos}:`, err.message);
    popEVECache.set(cacheKey, null, { ttl: 5 * 60 * 1000 });
    return null;
  }
}

export async function getRefSeqForProtein(proteinOrGene: string): Promise<string | null> {
  const cleanInput = proteinOrGene.trim();
  const cached = refseqCache.get(cleanInput);
  if (cached !== undefined) return cached;

  try {
    const isUniprot = UNIPROT_ACCESSION_REGEX.test(cleanInput);
    const url = isUniprot 
      ? `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(cleanInput)}.json`
      : `https://rest.uniprot.org/uniprotkb/search?query=gene_exact:${encodeURIComponent(cleanInput)}+AND+organism_id:9606&size=1&format=json`;

    const res = await fetchWithRetry(url, { timeout: 10000 });
    if (!res.ok) {
      // Only a definitive "no such entry" is remembered; a 429, a 5xx or another refusal is asked
      // again next time (WP-I2: no negative caching of errors).
      if (res.status === 404) refseqCache.set(cleanInput, null);
      return null;
    }
    const payload = await res.json();
    const checked = isUniprot ? uniprotEntrySchema.safeParse(payload) : uniprotSearchSchema.safeParse(payload);
    if (!checked.success) {
      // An unexpected shape says nothing about the protein, so it is asked again next time.
      console.warn(`[popEVE Online] RefSeq lookup for ${proteinOrGene}: UniProt payload did not match the expected shape; treated as no mapping for now.`);
      return null;
    }
    const entry = "results" in checked.data ? checked.data.results[0] : checked.data;
    if (!entry) {
      // The search answered and has no reviewed human entry for this gene: a definitive absence,
      // so it is remembered — otherwise every variant re-asks UniProt.
      refseqCache.set(cleanInput, null);
      return null;
    }
    const displayed = entry.comments.flatMap(c => c.isoforms)
      .find(i => i.isoformSequenceStatus === "Displayed")?.isoformIds ?? [];
    // popEVE keys its mutation files by RefSeq protein accession, so only NP_ entries are usable:
    // a gene that lists only an XP_ prediction has no popEVE reading rather than a guessed one.
    const refseqXrefs = entry.uniProtKBCrossReferences.filter(x => x.database === "RefSeq" && x.id.startsWith("NP_"));
    // Protein HGVS is numbered on the displayed UniProt sequence, not the first cross-reference.
    const refseqId = (displayed.length > 0
      ? refseqXrefs.find(x => x.isoformId && displayed.includes(x.isoformId))
      : refseqXrefs.find(x => !x.isoformId) ?? refseqXrefs[0])?.id ?? null;

    refseqCache.set(cleanInput, refseqId);
    return refseqId;
  } catch (err: any) {
    // Not remembered: a timeout or network error says nothing about the protein.
    console.warn(`[popEVE Online] RefSeq lookup warning for ${proteinOrGene}: ${err.message}`);
    return null;
  }
}

export async function fetchPopEVEScoreOnline(proteinOrGene: string, variant: string): Promise<number | null> {
  const cacheKey = `${proteinOrGene}_${variant}`;
  const cached = popEveOnlineCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const refseqId = await getRefSeqForProtein(proteinOrGene);
    if (!refseqId) {
      // Remembered only when the RefSeq answer itself was definitive (it is then in `refseqCache`).
      if (refseqCache.has(proteinOrGene.trim())) popEveOnlineCache.set(cacheKey, null, { ttl: 5 * 60 * 1000 });
      return null;
    }

    const csvUrl = `https://data.evemodel.org/popeve/v1.1/mutations/${refseqId}.csv`;
    const res = await fetchWithRetry(csvUrl, { timeout: 3000 }, 1);
    if (!res.ok) {
      // popEVE has no file for this RefSeq: definitive. Its files sit in an S3 bucket that answers a
      // missing key with 403 `AccessDenied`, not 404 (checked live 2026-10-14), so that exact answer
      // counts too. Anything else is asked again next time.
      const absent =
        res.status === 404 ||
        (res.status === 403 && /<Code>AccessDenied<\/Code>/.test(await res.text().catch(() => "")));
      if (absent) popEveOnlineCache.set(cacheKey, null, { ttl: 5 * 60 * 1000 });
      return null;
    }
    const csvText = await res.text();

    const cleanVariant = variant.replace(/^p\./i, "");
    const match = cleanVariant.match(/([A-Z]{1,3})[=:/]?(\d+)[=:/]?([A-Z]{1,3})/i);
    if (!match) {
      popEveOnlineCache.set(cacheKey, null);
      return null;
    }

    const targetMut = `${toSingleAa(match[1])}${match[2]}${toSingleAa(match[3])}`;
    const lines = csvText.split("\n");
    if (lines.length === 0) return null;

    const header = lines[0].split(",");
    const popEveIdx = header.indexOf("popEVE");
    if (popEveIdx === -1) return null;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith(targetMut + ",")) {
        const parts = line.split(",");
        const scoreVal = parseFloat(parts[popEveIdx]);
        if (!isNaN(scoreVal)) {
          popEveOnlineCache.set(cacheKey, scoreVal);
          return scoreVal;
        }
      }
    }
  } catch (err: any) {
    // A timeout or network error is not remembered: popEVE is asked again next time.
    console.warn(`[popEVE Online Error] ${err.message}`);
    return null;
  }

  // The file was read and holds no score for this substitution.
  popEveOnlineCache.set(cacheKey, null, { ttl: 5 * 60 * 1000 });
  return null;
}
