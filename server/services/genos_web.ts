import { normalizeGeneSymbol, normalizeVariantTo3Letter } from './external.ts';

let cachedCookie: string | null = null;
let lastLoginTime = 0;
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

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
  const res = await fetch('https://query.genos.us/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_type: 'academic',
      email: email,
      access_key: accessKey
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    throw new Error(`Authentication failed: ${res.status} ${await res.text()}`);
  }

  const cookieHeader = res.headers.get('set-cookie');
  if (!cookieHeader) {
    throw new Error('No Set-Cookie header returned from login');
  }

  cachedCookie = cookieHeader.split(';')[0];
  lastLoginTime = now;
  console.log('[Genos Web Query] Session established successfully.');
  return cachedCookie;
}

export async function queryGenosWebservice(
  gene: string,
  variant: string,
  gnomadVariantId?: string | null
): Promise<any | null> {
  const cacheKey = `${gene}_${variant}_${gnomadVariantId || ""}`;
  const cachedResult = genosResultCache.get(cacheKey);
  if (cachedResult && cachedResult.expiresAt > Date.now()) {
    console.log(`[Genos Web Query Cache Hit] Returning cached results for ${gene} ${variant}`);
    return cachedResult.data;
  }

  try {
    const cookie = await login();
    const headers = {
      'Content-Type': 'application/json',
      'Cookie': cookie
    };

    // Format variant query:
    // 1. If gnomadVariantId is chrom-pos-ref-alt, use it (e.g. 10-102919946-C-G)
    // 2. Otherwise format as gene:variant (e.g. CNNM2:p.Ser489Cys)
    let variantQuery = '';
    if (gnomadVariantId) {
      const parts = gnomadVariantId.split('-');
      if (parts.length >= 4) {
        variantQuery = `${parts[0]}-${parts[1]}-${parts[2]}-${parts[3]}`;
      }
    }

    if (!variantQuery) {
      const formattedVariant = variant.startsWith('p.') ? variant : `p.${variant}`;
      variantQuery = `${normalizeGeneSymbol(gene)}:${formattedVariant}`;
    }

    console.log(`[Genos Web Query] Submitting query for variant: ${variantQuery}`);
    const queryRes = await fetch('https://query.genos.us/api/query', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        variants: [variantQuery],
        genome_build: 'hg38'
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!queryRes.ok) {
      console.warn(`[Genos Web Query] Submission failed: ${queryRes.status} ${await queryRes.text()}`);
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
        try {
          const resTable = await fetch(
            `https://query.genos.us/api/query/${qid}/tables/${tbl}?offset=0&limit=1`,
            { headers, signal: AbortSignal.timeout(15000) }
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
      aou_hom: val(aFreq.AllofUs_ALL_hom)
    };
    genosResultCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL,
      data: finalData
    });
    return finalData;

  } catch (err: any) {
    console.warn(`[Genos Web Query Error] Failed to execute query:`, err.message);
    return null;
  }
}
