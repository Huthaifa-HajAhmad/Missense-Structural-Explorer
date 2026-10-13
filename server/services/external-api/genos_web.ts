import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(process.cwd(), ".env") });
} catch (_) {
  dotenv.config();
}

import { normalizeGeneSymbol, normalizeVariantTo3Letter } from '../external.ts';
import { parseGenomicCoordinateString } from '../../../src/shared/contracts.ts';
import { getCachedOrFetch, clearAllCaches } from '../infra/cache.ts';
import { buildGenosKey } from '../infra/cache-keys.ts';
import { governedFetch } from "../infra/http-client.ts";

let cachedCookie: string | null = null;
let lastLoginTime = 0;
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

// Genos aggressively rate-limits at the account level (429 on the second concurrent
// query during probing). Serialize all Genos HTTP calls through a single global queue
// so /analyze-variant's variant lookup and the landscape window loop don't compete
// against each other and trigger cascading throttles.
const GENOS_MIN_DELAY_MS = 1200;
let genosLastCallAt = 0;
let genosQueue: Promise<void> = Promise.resolve();
let genosCircuitBreakerUntil = 0;

export function isGenosCircuitBroken(): boolean {
  return Date.now() < genosCircuitBreakerUntil;
}

export function tripGenosCircuitBreaker(durationMs = 30 * 60 * 1000): void {
  genosCircuitBreakerUntil = Date.now() + durationMs;
  console.warn(`[Genos Circuit Breaker] Tripped until ${new Date(genosCircuitBreakerUntil).toISOString()}`);
}

let GENOS_MIN_DELAY_MS_OVERRIDE: number | null = null;
function effectiveMinDelayMs(): number {
  return GENOS_MIN_DELAY_MS_OVERRIDE ?? GENOS_MIN_DELAY_MS;
}

async function genosFetch(url: string, init: RequestInit): Promise<Response> {
  const run = async (): Promise<Response> => {
    const now = Date.now();
    const elapsed = now - genosLastCallAt;
    const waitMs = Math.max(0, effectiveMinDelayMs() - elapsed);
    if (waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    const res = await governedFetch(url, init);
    genosLastCallAt = Date.now();
    return res;
  };
  const call = genosQueue.then(() => run());
  genosQueue = call.then(() => undefined, () => undefined);
  return call;
}

/** Test-only hooks: reset serialized queue + speed up delays so unit tests don't stall. */
export function __resetGenosPipelineForTests(): void {
  genosLastCallAt = 0;
  genosQueue = Promise.resolve();
  GENOS_MIN_DELAY_MS_OVERRIDE = null;
  cachedCookie = null;
  lastLoginTime = 0;
  genosCircuitBreakerUntil = 0;
  genosResultCache.clear();
  clearAllCaches(true);
}
export function __setGenosMinDelayMsForTests(value: number): void {
  GENOS_MIN_DELAY_MS_OVERRIDE = value;
}

interface GenosCacheEntry {
  expiresAt: number;
  data: any;
}
const genosResultCache = new Map<string, GenosCacheEntry>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

interface GenosQueryResponse {
  query_id: string;
  tabs: Record<string, any>;
}

async function login(): Promise<string> {
  if (isGenosCircuitBroken()) {
    throw new Error("Genos circuit breaker active (rate limit or quota exceeded)");
  }
  const now = Date.now();
  if (cachedCookie && (now - lastLoginTime < SESSION_TTL)) {
    return cachedCookie;
  }

  const email = process.env.GENOS_EMAIL;
  const accessKey = process.env.GENOS_ACCESS_KEY;

  if (!email || !accessKey) {
    throw new Error("Genos credentials (GENOS_EMAIL, GENOS_ACCESS_KEY) not found in process environment");
  }

  console.log(`[Genos Web Query] Authenticating as ${email}...`);
  try {
    const res = await genosFetch('https://query.genos.us/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_type: 'academic',
        email: email,
        access_key: accessKey,
        confirm_terms: true,
        confirmed_non_commercial: true,
        academic_use_confirmed: true
      }),
      signal: AbortSignal.timeout(5000)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (res.status === 429 || errText.includes("limit reached")) {
        tripGenosCircuitBreaker();
      }
      throw new Error(`Authentication failed: ${res.status} ${errText}`);
    }

    const cookieHeader = res.headers.get('set-cookie');
    if (!cookieHeader) {
      throw new Error('No Set-Cookie header returned from login');
    }

    cachedCookie = cookieHeader.split(';')[0];
    lastLoginTime = now;
    console.log('[Genos Web Query] Session established successfully.');
    return cachedCookie;
  } catch (err: any) {
    if (err.message?.includes("429") || err.message?.includes("limit reached")) {
      tripGenosCircuitBreaker();
    }
    throw err;
  }
}

export async function queryGenosWebservice(
  gene: string,
  variant: string,
  gnomadVariantId?: string | null
): Promise<any | null> {
  const normGene = normalizeGeneSymbol(gene);
  const cacheKey = buildGenosKey(gene, variant, gnomadVariantId || undefined);

  return getCachedOrFetch({
    key: cacheKey,
    source: "Genos Web Service",
    ttlSeconds: 14 * 24 * 60 * 60, // 14 days
    fetcher: async () => {
      if (isGenosCircuitBroken()) {
        console.log(`[Genos Web Query] Circuit breaker is active, skipping remote Genos call for ${gene}:${variant}`);
        return null;
      }

      try {
        const cookie = await login();
        const headers = {
          'Content-Type': 'application/json',
          'Cookie': cookie
        };

        // Format variant query:
        let variantQuery = '';
        if (gnomadVariantId) {
          const parsed = parseGenomicCoordinateString(gnomadVariantId);
          if (parsed) {
            variantQuery = `${parsed.chrom}-${parsed.pos}-${parsed.ref}-${parsed.alt}`;
          }
        }

        if (!variantQuery) {
          const formattedVariant = variant.startsWith('p.') ? variant : `p.${variant}`;
          variantQuery = `${normGene}:${formattedVariant}`;
        }

        console.log(`[Genos Web Query] Submitting query for variant: ${variantQuery}`);
        const queryRes = await genosFetch('https://query.genos.us/api/query', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            variants: [variantQuery],
            genome_build: 'hg38'
          }),
          signal: AbortSignal.timeout(6000)
        });

        if (!queryRes.ok) {
          const errText = await queryRes.text().catch(() => "");
          console.warn(`[Genos Web Query] Submission failed: ${queryRes.status} ${errText}`);
          if (queryRes.status === 429 || errText.includes("limit reached") || errText.includes("Daily academic limit")) {
            tripGenosCircuitBreaker();
          }
          return null;
        }

        const queryData = (await queryRes.json()) as GenosQueryResponse;
        const qid = queryData.query_id;
        if (!qid) {
          console.warn('[Genos Web Query] Query submission returned no query_id');
          return null;
        }

        const availableTabs = Object.keys(queryData.tabs || {});
        const resultData: Record<string, any> = {};

        // Retrieve tables of interest: conservative_scores, function_prediction, allele_frequency
        const tablesToFetch = ['conservative_scores', 'function_prediction', 'allele_frequency'];
        const fetchPromises = tablesToFetch.map(async (tbl) => {
          if (availableTabs.includes(tbl)) {
            // Check if rows are already returned inline in queryData.tabs
            const inlineRows = queryData.tabs[tbl]?.rows;
            if (Array.isArray(inlineRows) && inlineRows.length > 0) {
              resultData[tbl] = inlineRows[0];
              return;
            }
            try {
              const resTable = await genosFetch(
                `https://query.genos.us/api/query/${qid}/tables/${tbl}?offset=0&limit=1`,
                { headers, signal: AbortSignal.timeout(15000) } as RequestInit
              );
              if (resTable.ok) {
                const data = await resTable.json();
                if (data.rows && data.rows.length > 0) {
                  resultData[tbl] = data.rows[0];
                }
              }
            } catch (err: any) {
              console.warn(`[Genos Web Query] Failed to fetch table ${tbl}:`, err.message);
            }
          }
        });

        await Promise.all(fetchPromises);

        if (Object.keys(resultData).length === 0) {
          console.warn(`[Genos Web Query] No tables returned data for ${variantQuery}`);
          return null;
        }

        // Merge tables into a unified record format
        const cScores = resultData['conservative_scores'] || {};
        const fPred = resultData['function_prediction'] || {};
        const aFreq = resultData['allele_frequency'] || {};

        // Helper to parse float or return null
        const val = (x: any) => {
          if (x === undefined || x === null || x === '.' || x === '') return null;
          const num = parseFloat(x);
          return isNaN(num) ? null : num;
        };

        const ds_ag = val(fPred.SpliceAI_pred_DS_AG);
        const ds_al = val(fPred.SpliceAI_pred_DS_AL);
        const ds_dg = val(fPred.SpliceAI_pred_DS_DG);
        const ds_dl = val(fPred.SpliceAI_pred_DS_DL);
        const hasSpliceAI = ds_ag !== null || ds_al !== null || ds_dg !== null || ds_dl !== null;
        const max_ds = hasSpliceAI ? Math.max(ds_ag || 0, ds_al || 0, ds_dg || 0, ds_dl || 0) : null;

        const finalData = {
          revel: val(fPred.REVEL_score),
          gerp: val(cScores['GERP++_RS']),
          phylop: val(cScores.phyloP100way_vertebrate),
          bayesdel: val(fPred.BayesDel_noAF_score),
          metarnn: val(fPred.MetaRNN_score),
          clinpred: val(fPred.ClinPred_score),
          eigenPhred: val(fPred['Eigen-phred_coding']),
          dann: val(fPred.DANN_score),
          esm1b: val(fPred.ESM1b_score),
          popeve: val(fPred.popEVE_score),
          aou_ac: val(aFreq.AllofUs_ALL_AC),
          aou_an: val(aFreq.AllofUs_ALL_AN),
          aou_het: val(aFreq.AllofUs_ALL_het),
          aou_hom: val(aFreq.AllofUs_ALL_hom),
          spliceai: hasSpliceAI ? {
            ds_ag,
            ds_al,
            ds_dg,
            ds_dl,
            max_ds
          } : null,
          dbscsnv: (fPred.dbscSNV_ADA_SCORE !== undefined || fPred.dbscSNV_RF_SCORE !== undefined || fPred.dbscsnv_ada_score !== undefined || fPred.dbscsnv_rf_score !== undefined) ? {
            ada_score: val(fPred.dbscSNV_ADA_SCORE ?? fPred.dbscsnv_ada_score),
            rf_score: val(fPred.dbscSNV_RF_SCORE ?? fPred.dbscsnv_rf_score)
          } : null
        };
        return finalData;

      } catch (err: any) {
        console.warn(`[Genos Web Query Error] Failed to execute query:`, err.message);
        return null;
      }
    }
  });
}

// Canonical 1-letter amino-acid code table used to enumerate the 19 non-synonymous
// missense substitutions per residue for landscape point queries.
const SINGLE_LETTER_AAS: Record<string, string> = {
  A: "Ala", R: "Arg", N: "Asn", D: "Asp", C: "Cys", Q: "Gln", E: "Glu", G: "Gly",
  H: "His", I: "Ile", L: "Leu", K: "Lys", M: "Met", F: "Phe", P: "Pro", S: "Ser",
  T: "Thr", W: "Trp", Y: "Tyr", V: "Val"
};
/**
 * Query Genos for every missense substitution in a window of residues.
 *
 * Empirical API contract (verified 2026-08-09):
 *  - `/api/query` only accepts point queries: chr-pos-ref-alt, chr-pos, rsID,
 *    GENE:p.<change>, or NM_/NP_/ENST/ENSP:p.<change>. Bare gene symbols are rejected.
 *  - The server accepts a `variants: string[]` array; invalid substitutions (wrong WT,
 *    stop-gains, etc.) are silently dropped and do not error the request.
 *  - Responses are rate-limited at roughly one query per ~3 s; 429s appear otherwise.
 *  - Each `tabs` entry already carries its row payload (`tabs[table].rows`); a
 *    separate per-table fetch is unnecessary if `offset=0` covers the range, but we
 *    still paginate when `total_rows > rows.length` (buffer safety).
 *
 * Strategy: enumerate all missense substitutions at every residue in [startPos, endPos],
 * chunk into small batches, join rounds serially (rate-limit compliant), and merge
 * function_prediction + conservative_scores by `chr:pos:ref:alt`.
 */
export async function queryGenosLandscape(
  gene: string,
  startPos?: number,
  endPos?: number,
  referenceSequence?: string
): Promise<any[]> {
  const normGene = normalizeGeneSymbol(gene);
  const cacheKey = `landscape_${normGene}_${startPos ?? ""}_${endPos ?? ""}`;
  const cachedResult = genosResultCache.get(cacheKey);
  if (cachedResult && cachedResult.expiresAt > Date.now()) {
    console.log(`[Genos Landscape Query Cache Hit] Returning cached results for ${normGene}`);
    return cachedResult.data;
  }

  // Without known residues (via referenceSequence) we cannot synthesize valid point queries.
  if (!referenceSequence) {
    console.warn(`[Genos Landscape] No reference sequence provided for ${normGene}; cannot enumerate point queries.`);
    return [];
  }

  let s = Math.max(1, startPos ?? 1);
  let e = Math.min(referenceSequence.length, endPos ?? referenceSequence.length);

  // For ranges > 50 residues, batch into 50-residue chunks and merge results.
  // Each chunk is queried separately to stay within Genos's per-request limits.
  if (e - s > 50) {
    console.log(`[Genos Landscape] Large range [${s}, ${e}] — batching into 50-residue windows.`);
    const allResults: any[] = [];
    for (let chunkStart = s; chunkStart <= e; chunkStart += 50) {
      const chunkEnd = Math.min(chunkStart + 49, e);
      try {
        const chunkResults = await queryGenosLandscape(normGene, chunkStart, chunkEnd, referenceSequence);
        allResults.push(...chunkResults);
      } catch (chunkErr: any) {
        console.warn(`[Genos Landscape] Chunk [${chunkStart}, ${chunkEnd}] failed:`, chunkErr.message);
      }
    }
    return allResults;
  }

  if (s > e) return [];

  const normSeq = referenceSequence.toUpperCase();
  // Genos accepts up to 19 substitutions per request — exactly one residue's worth of
  // non-synonymous point mutations (empirically verified 2026-08-09: >19 -> 422).
  const requests: { pos: number; variants: string[] }[] = [];
  for (let pos = s; pos <= e; pos++) {
    const wt1 = normSeq[pos - 1];
    const wt3 = SINGLE_LETTER_AAS[wt1];
    if (!wt3) continue;
    const subs = Object.values(SINGLE_LETTER_AAS).filter(m3 => m3 !== wt3);
    requests.push({ pos, variants: subs.map(m3 => `${normGene}:p.${wt3}${pos}${m3}`) });
  }

  if (requests.length === 0) return [];

  try {
    const cookie = await login();
    const headers = { 'Content-Type': 'application/json', 'Cookie': cookie };

    console.log(`[Genos Landscape] Querying ${normGene} residues ${s}-${e} (${requests.length} one-residue batch(es) of 19 subs each)...`);

    const combinedMap = new Map<string, any>();
    const val = (x: any) => {
      if (x === undefined || x === null || x === '.' || x === '') return null;
      const num = parseFloat(String(x));
      return isNaN(num) ? null : num;
    };

    for (let ci = 0; ci < requests.length; ci++) {
      const { pos: chunkPos, variants: chunk } = requests[ci];
      try {
        let queryRes = await genosFetch('https://query.genos.us/api/query', {
          method: 'POST',
          headers,
          body: JSON.stringify({ variants: chunk, genome_build: 'hg38' }),
          signal: AbortSignal.timeout(30000)
        });

        if (queryRes.status === 429) {
          console.warn(`[Genos Landscape] Rate-limited on batch ${ci + 1}/${requests.length}; waiting and retrying that batch once...`);
          const retry = await genosFetch('https://query.genos.us/api/query', {
            method: 'POST',
            headers,
            body: JSON.stringify({ variants: chunk, genome_build: 'hg38' }),
            signal: AbortSignal.timeout(30000)
          });
          if (!retry.ok) continue;
          queryRes = retry as Response;
        }
        if (!queryRes.ok) {
          console.warn(`[Genos Landscape] Batch ${ci + 1} submission failed: ${queryRes.status} ${(await queryRes.text()).slice(0, 200)}`);
          continue;
        }

        const queryData = (await queryRes.json()) as GenosQueryResponse;
        const tabs = queryData.tabs || {};
        const qid = queryData.query_id;

        const cScores: any[] = tabs['conservative_scores']?.rows ?? [];
        const fPred: any[] = tabs['function_prediction']?.rows ?? [];

        // Paginate if the table response surfaced more rows than inline (rare for small chunks)
        const extraPages: Promise<void>[] = [];
        for (const [tblName, tabVal] of Object.entries(tabs) as [string, any][]) {
          if (tabVal && tabVal.total_rows > (tabVal.rows?.length ?? 0) && qid) {
            if (tblName === 'conservative_scores' || tblName === 'function_prediction') {
              extraPages.push((async () => {
                try {
                  const tRes = await genosFetch(
                    `https://query.genos.us/api/query/${qid}/tables/${tblName}?offset=0&limit=5000`,
                    { headers, signal: AbortSignal.timeout(30000) } as RequestInit
                  );
                  if (tRes.ok) {
                    const tData = await tRes.json();
                    if (Array.isArray(tData.rows)) {
                      const target = tblName === 'conservative_scores' ? cScores : fPred;
                      // Replace the inline page (offset=0) with the full set
                      target.length = 0;
                      target.push(...tData.rows);
                    }
                  }
                } catch (pgErr: any) {
                  console.warn(`[Genos Landscape] Pagination fetch failed for ${tblName}:`, pgErr.message);
                }
              })());
            }
          }
        }
        await Promise.all(extraPages);

        // Join function_prediction + conservative_scores by chr:pos:ref:alt key
        for (const row of fPred) {
          const posGenomic = row['pos(1-based)'] ?? row.pos ?? row.position;
          const ref = row.ref;
          const alt = row.alt;
          if (posGenomic === undefined || ref === undefined || alt === undefined) continue;
          const normChr = String(row.chr).toLowerCase().replace(/^chr/, "");
          const r = String(ref).toUpperCase();
          const a = String(alt).toUpperCase();
          const key = `${normChr}_${posGenomic}_${r}_${a}`;
          const aaPos = val(row.aapos) ?? val(row['aapos(1-based)']) ?? chunkPos;
          combinedMap.set(key, {
            revel: val(row.REVEL_score),
            esm1b: val(row.ESM1b_score),
            popeve: val(row.popEVE_score),
            // Genos exposes AlphaMissense in the function_prediction table as both a raw
            // score (`AlphaMissense_score`) and a categorical `AlphaMissense_pred` label.
            am: val(row.AlphaMissense_score),
            pos: aaPos
          });
        }
        for (const row of cScores) {
          const posGenomic = row['pos(1-based)'] ?? row.pos ?? row.position;
          const ref = row.ref;
          const alt = row.alt;
          if (posGenomic === undefined || ref === undefined || alt === undefined) continue;
          const normChr = String(row.chr).toLowerCase().replace(/^chr/, "");
          const r = String(ref).toUpperCase();
          const a = String(alt).toUpperCase();
          const key = `${normChr}_${posGenomic}_${r}_${a}`;
          const gerp = val(row['GERP++_RS']);
          const phylop = val(row.phyloP100way_vertebrate);
          const existing = combinedMap.get(key);
          if (existing) {
            existing.gerp = gerp;
            existing.phylop = phylop;
          } else {
            // No function_prediction row for this variant: try to recover aapos from row or fallback to chunkPos
            const cAaPos = val(row.aapos) ?? val(row['aapos(1-based)']) ?? chunkPos;
            combinedMap.set(key, {
              revel: null,
              am: null,
              esm1b: null,
              popeve: null,
              gerp,
              phylop,
              pos: cAaPos
            });
          }
        }
      } catch (chunkErr: any) {
        console.warn(`[Genos Landscape] Batch ${ci + 1}/${requests.length} failed:`, chunkErr.message);
      }
    }

    // Drop entries with no amino-acid position (cannot be mapped to landscape window).
    const finalResult = Array.from(combinedMap.values()).filter(r => typeof r.pos === 'number' && !isNaN(r.pos));
    console.log(`[Genos Landscape] ${normGene} window ${s}-${e} -> ${finalResult.length} scored substitutions across ${new Set(finalResult.map(r => r.pos)).size} residue positions`);
    genosResultCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL, data: finalResult });
    return finalResult;
  } catch (err: any) {
    console.warn(`[Genos Landscape Query Error] Failed to execute query:`, err.message);
    return [];
  }
}
