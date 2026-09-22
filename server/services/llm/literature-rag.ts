import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import { getGeminiClient } from "./gemini.ts";

/**
 * Bring a pre-existing table up to the current schema.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op on an existing database, so a table created by
 * an older build would silently lack `cache_key`/`has_embedding`/`url` and every query
 * selecting them would throw. The columns are added with ALTER and backfilled: rows
 * written before query-scoping existed are attributed to their gene's default query.
 */
function migrateLiteratureSchema(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(literature_abstracts)").all() as Array<{ name: string }>;
  if (columns.length === 0) return;

  const existing = new Set(columns.map((column) => column.name));
  for (const [name, definition] of [
    ["has_embedding", "INTEGER NOT NULL DEFAULT 1"],
    ["url", "TEXT"]
  ] as Array<[string, string]>) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE literature_abstracts ADD COLUMN ${name} ${definition}`);
    }
  }

  const syncColumns = db.prepare("PRAGMA table_info(literature_syncs)").all() as Array<{ name: string }>;
  if (syncColumns.length > 0 && !syncColumns.some((column) => column.name === "hit_count")) {
    db.exec("ALTER TABLE literature_syncs ADD COLUMN hit_count INTEGER");
  }

  // Rows written before query-scoping existed carry no membership; attribute them to the
  // gene's default query, which is the set they were fetched for. The NOT EXISTS clause is
  // what makes this safe to run on every startup: papers whose only membership is a custom
  // query (GENE::query) *do* have membership, so they are never re-attributed to the
  // gene's default set. An unguarded INSERT here re-attributed custom-search papers to the
  // default list on every restart, polluting it until the gene's next default sync.
  db.exec(`
    INSERT OR IGNORE INTO literature_query_members (cache_key, paper_id, added_at)
      SELECT UPPER(TRIM(gene)), id, created_at FROM literature_abstracts
       WHERE NOT EXISTS (
         SELECT 1 FROM literature_query_members m WHERE m.paper_id = literature_abstracts.id
       );
  `);
}

/**
 * Shared-state database path.
 *
 * Resolved per call and preferring the explicit override: the same file is written by the
 * biophysical queue, and gating only on `NODE_ENV === "test"` made test safety depend on a
 * variable Vitest merely defaults — an ambient value would have used the real database.
 */
function resolveSharedStatePath(): string {
  // In-memory under test (ordering matters: this module reads the DB synchronously, and the
  // tests assert on an empty database rather than on a redirected file). The override is
  // honoured in production so an operator can relocate the file.
  if (process.env.NODE_ENV === "test") return ":memory:";
  return process.env.SHARED_STATE_DB_PATH ?? path.join(process.cwd(), "data", "shared_state.sqlite");
}

let dbInstance: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (!dbInstance) {
    const targetDbPath = resolveSharedStatePath();
    if (targetDbPath !== ":memory:") {
      const dir = path.dirname(targetDbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    dbInstance = new DatabaseSync(targetDbPath);
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS literature_abstracts (
        id TEXT PRIMARY KEY,
        gene TEXT NOT NULL,
        title TEXT NOT NULL,
        abstract TEXT NOT NULL,
        authors TEXT,
        journal TEXT,
        year INTEGER,
        embedding BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        has_embedding INTEGER NOT NULL DEFAULT 1,
        url TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_literature_gene ON literature_abstracts(gene);

      /* Which queries a paper belongs to. A paper can match the gene's default query and
         an ad-hoc custom query at once, and one row per PMID cannot express that, so
         membership lives here and the abstract row stays single-copy. */
      CREATE TABLE IF NOT EXISTS literature_query_members (
        cache_key TEXT NOT NULL,
        paper_id TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (cache_key, paper_id)
      );
      CREATE INDEX IF NOT EXISTS idx_literature_members_key ON literature_query_members(cache_key);

      /* Last successful sweep per query, so a stale set can be refreshed on a TTL rather
         than only when the caller passes force=true. The hit_count column holds what
         Europe PMC reported, which lets the UI explain a list shorter than the live
         site's count. */
      CREATE TABLE IF NOT EXISTS literature_syncs (
        cache_key TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        synced_at INTEGER NOT NULL,
        hit_count INTEGER
      );
    `);
    migrateLiteratureSchema(dbInstance);
  }
  return dbInstance;
}

/**
 * How long a per-gene sync stays authoritative.
 *
 * Without this the table was append-only: `force` re-inserted rows via
 * `INSERT OR REPLACE` but nothing ever left, so every later request returned every
 * paper ever matched — including papers only matched by a one-off custom query.
 */
const LITERATURE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Cache key for a (gene, query) pair. The query is part of the identity of the result
 *  set, so it must be part of the key — otherwise a custom search overwrites the
 *  default view's rows and all later default reads report the custom results. */
export function literatureCacheKey(gene: string, query?: string): string {
  const cleanGene = gene.trim().toUpperCase();
  const normalizedQuery = query?.trim() ? query.trim() : "";
  return normalizedQuery ? `${cleanGene}::${normalizedQuery}` : cleanGene;
}

export function recordLiteratureSync(cacheKey: string, query: string, hitCount: number | null = null): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO literature_syncs (cache_key, query, synced_at, hit_count) VALUES (?, ?, ?, ?)")
    .run(cacheKey, query, Date.now(), hitCount);
}

export function getLastLiteratureSync(cacheKey: string): number | null {
  const row = getDb()
    .prepare("SELECT synced_at FROM literature_syncs WHERE cache_key = ?")
    .get(cacheKey) as { synced_at: number } | undefined;
  return row ? row.synced_at : null;
}

/**
 * How many records Europe PMC reported matching the query on the last sweep.
 *
 * The API returns one page, so this is normally larger than the number of stored rows;
 * surfacing it is what lets the UI say "showing 25 of 1,204" instead of appearing to
 * have lost results.
 */
export function getLiteratureHitCount(cacheKey: string): number | null {
  const row = getDb()
    .prepare("SELECT hit_count FROM literature_syncs WHERE cache_key = ?")
    .get(cacheKey) as { hit_count: number | null } | undefined;
  return row && typeof row.hit_count === "number" ? row.hit_count : null;
}

/**
 * Whether a cached result set should be refreshed.
 *
 * A missing sync record means the set was never completed, and an expired one means it is
 * older than the TTL. Both cases re-fetch; a warm set inside the window is served as-is.
 */
export function isLiteratureCacheStale(cacheKey: string): boolean {
  const syncedAt = getLastLiteratureSync(cacheKey);
  if (syncedAt === null) return true;
  return Date.now() - syncedAt > LITERATURE_CACHE_TTL_MS;
}

/**
 * Replace the membership of `cacheKey` with exactly `paperIds`.
 *
 * Called before the new rows are inserted, so the set being written is authoritative:
 * memberships for this key that the fresh sweep no longer matched are dropped, and
 * abstract rows left with no membership at all are deleted. A paper still referenced by
 * another query (or another gene) keeps its row.
 */
function replaceLiteratureMembership(cacheKey: string, paperIds: string[]): void {
  const db = getDb();
  const keep = new Set(paperIds);

  const existing = db
    .prepare("SELECT paper_id FROM literature_query_members WHERE cache_key = ?")
    .all(cacheKey) as Array<{ paper_id: string }>;

  const deleteMember = db.prepare("DELETE FROM literature_query_members WHERE cache_key = ? AND paper_id = ?");
  for (const row of existing) {
    if (!keep.has(row.paper_id)) {
      deleteMember.run(cacheKey, row.paper_id);
    }
  }

  db.prepare("DELETE FROM literature_abstracts WHERE id NOT IN (SELECT paper_id FROM literature_query_members)").run();
}

export function resetDbForTesting(): void {
  dbInstance = null;
}

/**
 * Typed-array → BLOB.
 *
 * `Float32Array.prototype.buffer` is the *whole* ArrayBuffer, not this view's slice:
 * a `new Float32Array(768)` happens to span its buffer today, but any pooled or
 * subarray'ed vector would serialize a window starting at the pool's origin, storing
 * bytes that do not correspond to the vector. byteOffset/byteLength keeps them equal.
 */
function vectorToBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

// Math utility to calculate Cosine Similarity
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// In-flight sync de-duplication map
const inFlightSyncs = new Map<string, Promise<number>>();

// Europe PMC Circuit Breaker state
let pmcFailureCount = 0;
let pmcCircuitOpenedUntil = 0;

function checkPmcCircuit(): void {
  if (Date.now() < pmcCircuitOpenedUntil) {
    throw new Error("Europe PMC API circuit breaker is OPEN. Requests blocked temporarily.");
  }
}

function recordPmcSuccess(): void {
  pmcFailureCount = 0;
}

function recordPmcFailure(): void {
  pmcFailureCount++;
  if (pmcFailureCount >= 5) {
    console.warn(`[PMC Circuit Breaker] 5 consecutive failures. Opening circuit for 60 seconds.`);
    pmcCircuitOpenedUntil = Date.now() + 60000;
  }
}

// Dynamic embedding query using Google Gen AI SDK
export async function getEmbedding(
  text: string,
  customApiKey?: string,
  signal?: AbortSignal,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "RETRIEVAL_DOCUMENT"
): Promise<Float32Array> {
  if (signal?.aborted) {
    throw new Error("Aborted");
  }
  const ai = getGeminiClient(customApiKey);
  
  const embedPromise = ai.models.embedContent({
    model: "gemini-embedding-001",
    contents: text,
    config: {
      taskType,
      outputDimensionality: 768,
      abortSignal: signal,
    }
  });

  const timeoutMs = 15000;
  let timeoutId: any;
  let onAbortListener: any;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("Embedding request timed out"));
    }, timeoutMs);

    if (signal) {
      onAbortListener = () => {
        reject(new Error("Aborted"));
      };
      signal.addEventListener("abort", onAbortListener);
    }
  });

  try {
    const response = (await Promise.race([embedPromise, timeoutPromise])) as any;
    // @google/genai returns `embeddings[]`; accept the legacy singular shape too
    // so existing cached/test adapters remain compatible.
    const values = response?.embeddings?.[0]?.values ?? response?.embedding?.values;
    if (Array.isArray(values) && values.length > 0) {
      return new Float32Array(values);
    }
    throw new Error("Failed to generate text embedding: values missing from API response.");
  } finally {
    clearTimeout(timeoutId);
    if (signal && onAbortListener) {
      signal.removeEventListener("abort", onAbortListener);
    }
  }
}

// Helper to format PubMed/MeSH queries for Europe PMC Lucene/REST syntax
export function formatQueryForEuropePmc(query: string | undefined, gene: string): string {
  if (!query || !query.trim()) {
    return `${gene} AND (mutation OR variant OR functional OR "pathogenic")`;
  }
  const stripped = query
    .replace(/\[Gene\]/gi, "")
    .replace(/\[All\s+Fields\]/gi, "")
    .replace(/\[Title\/Abstract\]/gi, "")
    .replace(/\[TIAB\]/gi, "")
    .replace(/\[Mesh\]/gi, "")
    .trim();

  // A custom query used to *replace* the gene clause outright. The results were still
  // stored under the gene's bucket, so a bare `cancer` query filed unrelated papers as
  // this gene's literature. Scope the free-text terms to the gene instead.
  if (!stripped) return `${gene} AND (mutation OR variant OR functional OR "pathogenic")`;
  // Whole-word match, not substring: a plain `includes(gene)` check treated the token
  // `FACE` as containing gene `ACE` and silently skipped scoping, filing unscoped
  // papers under the gene's bucket. Symbols like `HLA-B` are matched as whole words too
  // (`HLA-B27` does not count as a mention of `HLA-B` and stays scoped).
  const escapedGene = gene.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${escapedGene}\\b`, "i").test(stripped)) return stripped;
  return `(${stripped}) AND ${gene}`;
}

/**
 * Europe PMC's `id` field carries PPR/PMC accessions for records that have no PubMed ID,
 * so the record must say which identifier it actually holds: `source` drives
 * `buildPaperUrl`, which picks each record's canonical page — PubMed, PMC, or Europe PMC
 * for preprints — instead of a dead `pubmed.ncbi.nlm.nih.gov/<id>/` deep link.
 */
export interface PmcPaper {
  pmid?: string;
  id?: string;
  source?: string;
  doi?: string;
  title?: string;
  abstractText?: string;
  synopsis?: string;
  authorString?: string;
  journalInfo?: { journal?: { title?: string } };
  journalTitle?: string;
  pubYear?: string;
  firstPublicationDate?: string;
}

export interface NormalizedCitation {
  id: string;
  title: string;
  abstract: string;
  authors: string;
  journal: string;
  year: number | null;
  url: string;
}

function normalizeYear(paper: PmcPaper): number | null {
  const raw = paper.pubYear ?? (paper.firstPublicationDate ? paper.firstPublicationDate.slice(0, 4) : undefined);
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Strip publisher markup from a title or abstract.
 *
 * Europe PMC copies inline markup from the publishers in two forms: raw tags (`<i>`)
 * and entity-encoded tags (`&lt;i&gt;`). The list view renders text nodes, so both must
 * end up as plain text. Decode *first*, then strip: the old order stripped tags before
 * decoding, so an entity-encoded `<i>` decoded into a raw tag that nothing removed and
 * titles rendered on screen as literal `&lt;i&gt;In Vivo&lt;/i&gt;`. `&amp;` decodes last
 * so an intentionally escaped entity (`ATP &amp;amp; …`) survives one level rather than
 * collapsing to `&`. Headings become paragraph breaks; `<br>` becomes a newline.
 */
export function cleanLiteratureText(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(h4|h3|h2|h1)>/gi, "\n\n")
    // Tag-shaped only: `<` + optional `/` + a letter. A decoded bare `<` from prose like
    // `p < 0.05` must not start a match that runs to the next `>` and eats everything
    // between — that silently deleted abstract text on entity-decoded input.
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Back-compat alias: the same cleaning applies to titles and abstracts alike. */
export const cleanAbstractText = cleanLiteratureText;

/**
 * Canonical link for a record. Registered PMIDs and PMC accessions get their own stable
 * PubMed/PMC path; anything else falls back to a Europe PMC search for the identifier.
 */
export function buildPaperUrl(pmid: string, paper: PmcPaper): string {
  const source = (paper.source || "").toUpperCase();
  if (source === "PPR") return `https://europepmc.org/article/PPR/${encodeURIComponent(pmid)}`;
  if (source === "PMC" || /^PMC\d+$/i.test(pmid)) return `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmid}/`;
  if (/^\d+$/.test(pmid)) return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
  return `https://europepmc.org/search?query=${encodeURIComponent(pmid)}`;
}

/**
 * Map one Europe PMC record to the citation shape the API returns, or `null` when the
 * record has no usable identity. Records without an abstract are now *kept*: dropping
 * them silently made the returned count disagree with Europe PMC's own hit count, and a
 * title-only citation is still a legitimate reference. Titles, authors, and journal are
 * run through the same cleaning — titles regularly carry the same entity-encoded markup
 * as abstracts, and un-decoded `&lt;i&gt;` was rendering literally in the list view.
 */
function toCitation(paper: PmcPaper): NormalizedCitation | null {
  const pmid = paper.pmid || paper.id;
  if (!pmid) return null;

  return {
    id: pmid,
    title: cleanLiteratureText(paper.title || "") || "Untitled Publication",
    abstract: cleanLiteratureText(paper.abstractText || paper.synopsis || ""),
    authors:
      cleanLiteratureText(paper.authorString || "").replace(/\s+/g, " ").trim() ||
      "Unknown Authors",
    journal:
      cleanLiteratureText(paper.journalInfo?.journal?.title || paper.journalTitle || "")
        .replace(/\s+/g, " ")
        .trim() || "Unknown Journal",
    year: normalizeYear(paper),
    url: buildPaperUrl(pmid, paper)
  };
}

function mapPapers(results: PmcPaper[]): { citations: NormalizedCitation[]; skipped: number } {
  const citations: NormalizedCitation[] = [];
  let skipped = 0;
  for (const paper of results) {
    const citation = toCitation(paper);
    if (citation) citations.push(citation);
    else skipped++;
  }
  return { citations, skipped };
}

function insertCitation(citation: NormalizedCitation, gene: string, cacheKey: string, embedding: Buffer, hasEmbedding: boolean): void {
  const db = getDb();
  const now = Date.now();

  // The abstract row is keyed by PMID alone, so a paper shared by several queries is
  // stored once. `INSERT OR REPLACE` would drop a previously-good embedding when a later
  // sync fails to embed, so keep the existing row's embedding when this one has none.
  db.prepare(
    `INSERT INTO literature_abstracts
       (id, gene, title, abstract, authors, journal, year, url, embedding, has_embedding, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       gene = excluded.gene,
       title = excluded.title,
       abstract = excluded.abstract,
       authors = excluded.authors,
       journal = excluded.journal,
       year = excluded.year,
       url = excluded.url,
       embedding = CASE WHEN excluded.has_embedding = 1 THEN excluded.embedding ELSE literature_abstracts.embedding END,
       has_embedding = CASE WHEN excluded.has_embedding = 1 THEN 1 ELSE literature_abstracts.has_embedding END,
       created_at = excluded.created_at`
  ).run(
    citation.id,
    gene,
    citation.title,
    citation.abstract,
    citation.authors,
    citation.journal,
    citation.year,
    citation.url,
    embedding,
    hasEmbedding ? 1 : 0,
    now
  );

  db.prepare(
    `INSERT OR REPLACE INTO literature_query_members (cache_key, paper_id, added_at) VALUES (?, ?, ?)`
  ).run(cacheKey, citation.id, now);
}

/** Europe PMC returns one page per request; this is that page's size. The UI reports the
 *  true hit count so a shorter list is explained rather than looking like a bug. */
export const EUROPE_PMC_PAGE_SIZE = 25;

// Fetch papers from Europe PMC Search JSON API
export async function syncLiteratureForGene(
  gene: string, 
  customApiKey?: string, 
  signal?: AbortSignal,
  customQuery?: string
): Promise<number> {
  const cleanGene = gene.trim().toUpperCase();
  const cacheKey = literatureCacheKey(cleanGene, customQuery);

  if (inFlightSyncs.has(cacheKey)) {
    console.log(`[RAG] Reusing in-flight literature sync for key: ${cacheKey}`);
    return inFlightSyncs.get(cacheKey)!;
  }

  const syncPromise = (async () => {
    const formattedQuery = formatQueryForEuropePmc(customQuery, cleanGene);
    console.log(`[RAG] Querying Europe PMC literature for: ${formattedQuery}...`);
    
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(formattedQuery)}&format=json&resultType=core&pageSize=${EUROPE_PMC_PAGE_SIZE}`;
    
    // Set a timeout of 30 seconds for the entire sync process
    const timeoutController = new AbortController();
    const syncTimeoutId = setTimeout(() => timeoutController.abort(), 30000);

    const onAbort = () => {
      timeoutController.abort();
    };

    if (signal) {
      if (signal.aborted) {
        // Return a benign result rather than throwing: this runs inside a detached async IIFE
        // whose rejection, when combined with the `.finally()` bookkeeping below, used to escape
        // as an unhandled rejection and terminate the Node process.
        clearTimeout(syncTimeoutId);
        return 0;
      }
      signal.addEventListener("abort", onAbort);
    }

    try {
      checkPmcCircuit();

      const fetchController = new AbortController();
      const fetchTimeoutId = setTimeout(() => fetchController.abort(), 15000);
      const cleanupAbort = () => fetchController.abort();

      timeoutController.signal.addEventListener("abort", cleanupAbort);

      let res: Response;
      try {
        res = await fetch(url, { 
          headers: { "Accept": "application/json" },
          signal: fetchController.signal
        });
      } finally {
        clearTimeout(fetchTimeoutId);
        timeoutController.signal.removeEventListener("abort", cleanupAbort);
      }

      if (!res.ok) {
        throw new Error(`Europe PMC API request failed: ${res.statusText}`);
      }
      
      const data = await res.json();
      recordPmcSuccess();

      const results: PmcPaper[] = data.resultList?.result || [];
      const { citations, skipped } = mapPapers(results);
      const hitCount = typeof data.hitCount === "number" ? data.hitCount : null;

      if (skipped > 0) {
        console.warn(`[RAG] Skipped ${skipped}/${results.length} Europe PMC records with no identifier for ${cleanGene}.`);
      }

      // Replace this query's cached set before inserting: a paper the fresh sweep no
      // longer matched loses its membership, and rows left unowned are deleted, so the
      // set tracks the live query instead of accumulating every paper ever matched.
      replaceLiteratureMembership(cacheKey, citations.map((citation) => citation.id));

      if (citations.length === 0) {
        console.log(`[RAG] No articles found on Europe PMC for gene: ${cleanGene}`);
        // An empty result is still a completed sweep: recording it stops every later
        // request from re-querying a gene that genuinely has no literature.
        recordLiteratureSync(cacheKey, formattedQuery, hitCount);
        return 0;
      }

      console.log(`[RAG] Found ${citations.length} papers for ${cleanGene}. Embedding and storing...`);

      let successCount = 0;
      for (const citation of citations) {
        if (timeoutController.signal.aborted) {
          console.warn(`[RAG Warning] Literature sync timed out or aborted.`);
          break;
        }

        let buffer: Buffer;
        let hasEmbedding = true;
        try {
          // Embed the abstract using gemini-embedding-001
          const textToEmbed = `Title: ${citation.title}\nAbstract: ${citation.abstract}`;
          const embedding = await getEmbedding(textToEmbed, customApiKey, timeoutController.signal);
          buffer = vectorToBuffer(embedding);
        } catch (embedErr: any) {
          console.warn(`[RAG Warning] Failed to embed abstract for PMID ${citation.id}:`, embedErr.message);
          // Store a zero vector and record that the row is unscorable, so RAG can skip it
          // rather than ranking it as a genuine similarity-0 match.
          buffer = vectorToBuffer(new Float32Array(768));
          hasEmbedding = false;
        }

        try {
          insertCitation(citation, cleanGene, cacheKey, buffer, hasEmbedding);
          successCount++;
        } catch (dbErr: any) {
          console.warn(`[RAG Warning] Failed to insert paper for PMID ${citation.id}:`, dbErr.message);
        }
      }

      // Only a completed sweep may claim the set as fresh: an interrupted sync must not
      // suppress the retry that would fill in the rows it never reached.
      if (!timeoutController.signal.aborted) {
        recordLiteratureSync(cacheKey, formattedQuery, hitCount);
      }

      console.log(`[RAG] Successfully synced and embedded ${successCount}/${citations.length} papers for ${cleanGene}`);
      return successCount;
    } catch (err: any) {
      if (err.message && err.message.includes("Europe PMC API")) {
        recordPmcFailure();
      }
      console.warn(`[RAG Warning] Gene literature sync failed for ${cleanGene}:`, err.message || err);
      return 0;
    } finally {
      clearTimeout(syncTimeoutId);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  })();

  inFlightSyncs.set(cacheKey, syncPromise);
  
  // Cleanup map when completed.
  //
  // Must be `.then(onFulfilled, onRejected)` and NOT `.finally(...)`: `.finally()` returns a
  // *derived* promise that rejects whenever `syncPromise` rejects, and nothing handles that
  // derived promise — which is an unhandled rejection, and Node 22 terminates the process on
  // those. That is how an aborted literature sync used to take the whole server down mid-request.
  const releaseSync = () => {
    inFlightSyncs.delete(cacheKey);
  };
  syncPromise.then(releaseSync, releaseSync);

  return syncPromise;
}

// Main RAG Retrieval logic
export interface LiteratureCitation {
  id: string;
  title: string;
  abstract: string;
  authors: string;
  journal: string;
  year: number | null;
  url: string | null;
  similarity: number;
}

/** A citation as returned to list UIs: no embedding, no similarity. */
export type CitationRow = Omit<LiteratureCitation, "similarity">;

interface AbstractRow {
  id: string;
  title: string;
  abstract: string;
  authors: string | null;
  journal: string | null;
  year: number | null;
  url: string | null;
}

function rowToCitation(row: AbstractRow): CitationRow {
  return {
    id: row.id,
    title: row.title,
    abstract: row.abstract,
    authors: row.authors || "Unknown Authors",
    journal: row.journal || "Unknown Journal",
    year: row.year,
    url: row.url
  };
}

/**
 * Rebuild a Float32Array from a SQLite BLOB.
 *
 * The driver hands back a Uint8Array that may be a view onto a larger pooled
 * ArrayBuffer, so `row.embedding.buffer` is not necessarily this row's bytes.
 * Respecting byteOffset/byteLength is what makes the reconstructed vector the stored one.
 */
function bufferToVector(blob: Uint8Array): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, Math.floor(blob.byteLength / 4));
}

export async function retrieveRelevantLiterature(
  gene: string,
  query: string,
  customApiKey?: string,
  signal?: AbortSignal
): Promise<LiteratureCitation[]> {
  const db = getDb();
  const cleanGene = gene.trim().toUpperCase();
  const cacheKey = literatureCacheKey(cleanGene);

  // 1. Check if we have records cached for this gene's default query
  const countRow = db
    .prepare("SELECT COUNT(*) as count FROM literature_query_members WHERE cache_key = ?")
    .get(cacheKey) as { count: number } | undefined;
  const count = countRow ? countRow.count : 0;

  // Sync only on a genuine miss: never fetched, or fetched so long ago the entry has
  // aged out. The old `count === 0` test alone re-queried Europe PMC on every retrieval
  // for a gene whose sweep had legitimately recorded zero hits — membership stays empty,
  // so "no rows" was true forever. A fresh empty sync is an answer, not a miss.
  if (count === 0 && isLiteratureCacheStale(cacheKey)) {
    console.log(`[RAG] Cache miss for gene ${cleanGene}. Triggering sync...`);
    await syncLiteratureForGene(cleanGene, customApiKey, signal).catch(() => {});
  }
  
  if (signal?.aborted) {
    return [];
  }

  // 2. Load cached literature that belongs to this gene's default set.
  // Keep the SELECT column list in sync with the cast below: node:sqlite returns
  // untyped rows, so a dropped/renamed column would silently widen to `unknown`.
  const rows = db
    .prepare(
      `SELECT a.id, a.title, a.abstract, a.authors, a.journal, a.year, a.url, a.embedding, a.has_embedding
         FROM literature_abstracts a
         JOIN literature_query_members m ON m.paper_id = a.id
        WHERE m.cache_key = ?`
    )
    .all(cacheKey) as unknown as Array<AbstractRow & { embedding: Uint8Array; has_embedding: number }>;

  if (rows.length === 0) {
    return [];
  }
  
  try {
    // 3. Embed the search query
    const queryVector = await getEmbedding(query, customApiKey, signal, "RETRIEVAL_QUERY");
    
    // 4. Compute cosine similarity in memory
    const citations: LiteratureCitation[] = [];
    for (const row of rows) {
      if (signal?.aborted) {
        return [];
      }
      // Rows whose embedding call failed hold a zero vector. cosineSimilarity would
      // report 0 for them, which is indistinguishable from a genuine non-match, so they
      // are excluded from ranking rather than returned as the weakest hits.
      if (!row.has_embedding) continue;

      const similarity = cosineSimilarity(queryVector, bufferToVector(row.embedding));
      citations.push({ ...rowToCitation(row), similarity });
    }
    
    // 5. Sort by relevance descending and return top 5
    return citations
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);
  } catch (err: any) {
    console.error(`[RAG Error] Retrieval failed for query on gene ${cleanGene}:`, err.message);
    return [];
  }
}

/**
 * Raw cached citations for a gene, newest first.
 *
 * When `customQuery` is given the rows for that query's own cache key are returned, so a
 * search shows its own result set instead of whatever the gene's default set contains.
 */
export async function getGeneCitations(
  gene: string,
  signal?: AbortSignal,
  customQuery?: string
): Promise<CitationRow[]> {
  const db = getDb();
  const cleanGene = gene.trim().toUpperCase();
  const cacheKey = literatureCacheKey(cleanGene, customQuery);

  const countRow = db
    .prepare("SELECT COUNT(*) as count FROM literature_query_members WHERE cache_key = ?")
    .get(cacheKey) as { count: number } | undefined;
  const count = countRow ? countRow.count : 0;

  // Pre-warm in the background: the caller gets an empty page immediately and the next
  // request is served from cache. Gated on staleness as well as emptiness — `count === 0`
  // stays true forever for a gene whose sweep recorded zero hits (membership is empty by
  // definition), and the ungated version fired a Europe PMC sync on *every* request for
  // such genes. A fresh empty sync is a real answer; only a miss or an aged entry re-syncs.
  if (count === 0 && isLiteratureCacheStale(cacheKey)) {
    syncLiteratureForGene(cleanGene, undefined, signal, customQuery).catch(() => {});
    return [];
  }

  // Keep the SELECT column list in sync with the AbstractRow cast below.
  const rows = db
    .prepare(
      `SELECT a.id, a.title, a.abstract, a.authors, a.journal, a.year, a.url
         FROM literature_abstracts a
         JOIN literature_query_members m ON m.paper_id = a.id
        WHERE m.cache_key = ?
        ORDER BY a.year IS NULL, a.year DESC, a.title ASC`
    )
    .all(cacheKey) as unknown as AbstractRow[];

  return rows.map(rowToCitation);
}

/** Result of a custom-query search. `degraded` marks an upstream-failure fallback whose
 *  rows came from the gene's cached default set rather than this query's own sweep — the
 *  route reports `hitCount: null` in that case instead of pairing this key's count with a
 *  different set's citations (which would make the UI's "showing X of Y" lie). */
export interface LiteratureSearchResult {
  citations: CitationRow[];
  degraded: boolean;
}

// Live remote search function for custom queries from the Literature Inspector / Search edit
export async function searchGeneLiterature(
  gene: string,
  customApiKey?: string,
  signal?: AbortSignal,
  customQuery?: string,
  force = false
): Promise<LiteratureSearchResult> {
  const cleanGene = gene.trim().toUpperCase();
  const formattedQuery = formatQueryForEuropePmc(customQuery, cleanGene);
  const cacheKey = literatureCacheKey(cleanGene, customQuery);

  // Searches run on Enter/apply, not per keystroke, so the common path is: a fresh
  // cached set is served without going upstream (re-running the same query is instant),
  // and only an expired or never-fetched query reaches Europe PMC. `force` — the Sync
  // button — bypasses this and re-queries even a fresh entry.
  if (!force && !isLiteratureCacheStale(cacheKey)) {
    const db = getDb();
    // Keep the SELECT column list in sync with the AbstractRow cast below.
    const cached = db
      .prepare(
        `SELECT a.id, a.title, a.abstract, a.authors, a.journal, a.year, a.url
           FROM literature_abstracts a
           JOIN literature_query_members m ON m.paper_id = a.id
          WHERE m.cache_key = ?
          ORDER BY a.year IS NULL, a.year DESC, a.title ASC`
      )
      .all(cacheKey) as unknown as AbstractRow[];
    // A fresh, empty set is a real answer ("no matches"), not a cache miss.
    return { citations: cached.map(rowToCitation), degraded: false };
  }

  // A live search is a completed sweep of its own query, so it writes the same cache the
  // list reads: membership of this key is replaced, and the rows are stored with a zero
  // embedding marked unscorable. `syncLiteratureForGene` (which embeds properly) is what
  // later upgrades them.
  const storeResults = (citations: NormalizedCitation[], hitCount: number | null): void => {
    replaceLiteratureMembership(cacheKey, citations.map((citation) => citation.id));
    const zeroVector = vectorToBuffer(new Float32Array(768));
    for (const citation of citations) {
      try {
        insertCitation(citation, cleanGene, cacheKey, zeroVector, false);
      } catch (_) {
        // A single failed row must not discard the rest of the result set.
      }
    }
    recordLiteratureSync(cacheKey, formattedQuery, hitCount);
  };

  try {
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(formattedQuery)}&format=json&resultType=core&pageSize=${EUROPE_PMC_PAGE_SIZE}`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal
    });

    if (res.ok) {
      const data = await res.json();
      const { citations } = mapPapers(data.resultList?.result || []);
      const hitCount = typeof data.hitCount === "number" ? data.hitCount : null;
      // A successful query with no matches is a real answer; recording it caches the
      // empty set so it is not re-queried the next time the same search is executed.
      storeResults(citations, hitCount);
      return { citations, degraded: false };
    }
  } catch (err: any) {
    console.warn(`[RAG Warning] Live Europe PMC search failed for "${formattedQuery}":`, err.message);
  }

  // Fallback (degraded): the upstream call failed, so search the cached abstracts for
  // this gene. These rows are NOT this query's own result set, which is exactly what
  // `degraded` tells the route so it does not report a mismatched hit count.
  if (customQuery && customQuery.trim()) {
    const rawTerms = customQuery
      .replace(/\[.*?\]/g, " ")
      .replace(/\b(AND|OR|NOT)\b/gi, " ")
      .replace(/[()",]/g, " ")
      .split(/\s+/)
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 2 && t !== cleanGene.toLowerCase());

    if (rawTerms.length > 0) {
      const cached = await getGeneCitations(cleanGene, signal);
      const matched = cached.filter((row) => {
        const text = `${row.title} ${row.abstract}`.toLowerCase();
        return rawTerms.every(t => text.includes(t));
      });
      if (matched.length > 0) {
        return { citations: matched, degraded: true };
      }
    }
  }

  return { citations: await getGeneCitations(cleanGene, signal), degraded: true };
}
