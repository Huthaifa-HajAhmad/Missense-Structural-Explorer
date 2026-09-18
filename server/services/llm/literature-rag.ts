import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import { getGeminiClient } from "./gemini.ts";

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
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_literature_gene ON literature_abstracts(gene);
    `);
  }
  return dbInstance;
}

export function resetDbForTesting(): void {
  dbInstance = null;
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
  return query
    .replace(/\[Gene\]/gi, "")
    .replace(/\[All\s+Fields\]/gi, "")
    .replace(/\[Title\/Abstract\]/gi, "")
    .replace(/\[TIAB\]/gi, "")
    .replace(/\[Mesh\]/gi, "")
    .trim();
}

// Fetch papers from Europe PMC Search JSON API
export async function syncLiteratureForGene(
  gene: string, 
  customApiKey?: string, 
  signal?: AbortSignal,
  customQuery?: string
): Promise<number> {
  const cleanGene = gene.trim().toUpperCase();
  const syncKey = customQuery ? `${cleanGene}::${customQuery.trim()}` : cleanGene;

  if (inFlightSyncs.has(syncKey)) {
    console.log(`[RAG] Reusing in-flight literature sync for key: ${syncKey}`);
    return inFlightSyncs.get(syncKey)!;
  }

  const syncPromise = (async () => {
    const formattedQuery = formatQueryForEuropePmc(customQuery, cleanGene);
    console.log(`[RAG] Querying Europe PMC literature for: ${formattedQuery}...`);
    
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(formattedQuery)}&format=json&resultType=core&pageSize=25`;
    
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

      const results = data.resultList?.result || [];
      if (results.length === 0) {
        console.log(`[RAG] No articles found on Europe PMC for gene: ${cleanGene}`);
        return 0;
      }
      
      console.log(`[RAG] Found ${results.length} papers for ${cleanGene}. Embedding and storing...`);
      const db = getDb();
      const insertStmt = db.prepare(`
        INSERT OR REPLACE INTO literature_abstracts (id, gene, title, abstract, authors, journal, year, embedding, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      let successCount = 0;
      for (const paper of results) {
        if (timeoutController.signal.aborted) {
          console.warn(`[RAG Warning] Literature sync timed out or aborted.`);
          break;
        }

        const pmid = paper.pmid || paper.id;
        const title = paper.title || "Untitled Publication";
        const abstract = paper.abstractText || paper.synopsis || "";
        
        // Skip articles with completely empty abstracts since they are useless for RAG
        if (!pmid || !abstract.trim()) continue;
        
        const authors = paper.authorString || "Unknown Authors";
        const journal = paper.journalInfo?.journal?.title || paper.journalTitle || "Unknown Journal";
        const year = paper.pubYear ? parseInt(paper.pubYear, 10) : null;
        
        let buffer: Buffer;
        try {
          // Embed the abstract using gemini-embedding-001
          const textToEmbed = `Title: ${title}\nAbstract: ${abstract}`;
          const embedding = await getEmbedding(textToEmbed, customApiKey, timeoutController.signal);
          buffer = Buffer.from(embedding.buffer);
        } catch (embedErr: any) {
          console.warn(`[RAG Warning] Failed to embed abstract for PMID ${pmid}:`, embedErr.message);
          // Fallback: use a dummy vector of 768 zeros so we can still save the paper data
          const dummyVector = new Float32Array(768);
          buffer = Buffer.from(dummyVector.buffer);
        }

        try {
          insertStmt.run(
            pmid,
            cleanGene,
            title,
            abstract,
            authors,
            journal,
            year,
            buffer,
            Date.now()
          );
          successCount++;
        } catch (dbErr: any) {
          console.warn(`[RAG Warning] Failed to insert paper for PMID ${pmid}:`, dbErr.message);
        }
      }
      
      console.log(`[RAG] Successfully synced and embedded ${successCount}/${results.length} papers for ${cleanGene}`);
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

  inFlightSyncs.set(syncKey, syncPromise);
  
  // Cleanup map when completed.
  //
  // Must be `.then(onFulfilled, onRejected)` and NOT `.finally(...)`: `.finally()` returns a
  // *derived* promise that rejects whenever `syncPromise` rejects, and nothing handles that
  // derived promise — which is an unhandled rejection, and Node 22 terminates the process on
  // those. That is how an aborted literature sync used to take the whole server down mid-request.
  const releaseSync = () => {
    inFlightSyncs.delete(syncKey);
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
  similarity: number;
}

export async function retrieveRelevantLiterature(
  gene: string,
  query: string,
  customApiKey?: string,
  signal?: AbortSignal
): Promise<LiteratureCitation[]> {
  const db = getDb();
  const cleanGene = gene.trim().toUpperCase();
  
  // 1. Check if we have records cached
  const countRow = db.prepare("SELECT COUNT(*) as count FROM literature_abstracts WHERE gene = ?").get(cleanGene) as any;
  const count = countRow ? countRow.count : 0;
  
  if (count === 0) {
    console.log(`[RAG] Cache miss for gene ${cleanGene}. Triggering sync...`);
    await syncLiteratureForGene(cleanGene, customApiKey, signal).catch(() => {});
  }
  
  if (signal?.aborted) {
    return [];
  }

  // 2. Load cached literature
  const rows = db.prepare("SELECT id, title, abstract, authors, journal, year, embedding FROM literature_abstracts WHERE gene = ?").all(cleanGene) as any[];
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
      // Reconstruct Float32Array from SQLite BLOB buffer
      const embeddingVector = new Float32Array(row.embedding.buffer);
      const similarity = cosineSimilarity(queryVector, embeddingVector);
      
      citations.push({
        id: row.id,
        title: row.title,
        abstract: row.abstract,
        authors: row.authors || "Unknown Authors",
        journal: row.journal || "Unknown Journal",
        year: row.year,
        similarity
      });
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

// Simple export to fetch raw cached items without embedding (useful for list tabs in UI)
export async function getGeneCitations(gene: string, signal?: AbortSignal): Promise<Omit<LiteratureCitation, "similarity">[]> {
  const db = getDb();
  const cleanGene = gene.trim().toUpperCase();
  
  const countRow = db.prepare("SELECT COUNT(*) as count FROM literature_abstracts WHERE gene = ?").get(cleanGene) as any;
  const count = countRow ? countRow.count : 0;
  
  if (count === 0) {
    // Attempt async pre-warm sync without blocking the UI response (background pre-warm)
    syncLiteratureForGene(cleanGene, undefined, signal).catch(() => {});
    return [];
  }
  
  const rows = db.prepare("SELECT id, title, abstract, authors, journal, year FROM literature_abstracts WHERE gene = ? ORDER BY year DESC").all(cleanGene) as any[];
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    abstract: row.abstract,
    authors: row.authors || "Unknown Authors",
    journal: row.journal || "Unknown Journal",
    year: row.year
  }));
}

// Live remote search function for custom queries from the Literature Inspector / Search edit
export async function searchGeneLiterature(
  gene: string,
  customApiKey?: string,
  signal?: AbortSignal,
  customQuery?: string
): Promise<Omit<LiteratureCitation, "similarity">[]> {
  const cleanGene = gene.trim().toUpperCase();
  const formattedQuery = formatQueryForEuropePmc(customQuery, cleanGene);
  
  try {
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(formattedQuery)}&format=json&resultType=core&pageSize=25`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal
    });

    if (res.ok) {
      const data = await res.json();
      const results = data.resultList?.result || [];
      if (results.length > 0) {
        const db = getDb();
        const insertStmt = db.prepare(`
          INSERT OR REPLACE INTO literature_abstracts (id, gene, title, abstract, authors, journal, year, embedding, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const matchedCitations: Omit<LiteratureCitation, "similarity">[] = [];
        const dummyVector = new Float32Array(768);
        const buffer = Buffer.from(dummyVector.buffer);

        for (const paper of results) {
          const pmid = paper.pmid || paper.id;
          const title = paper.title || "Untitled Publication";
          const abstract = paper.abstractText || paper.synopsis || "";
          if (!pmid || !abstract.trim()) continue;

          const authors = paper.authorString || "Unknown Authors";
          const journal = paper.journalInfo?.journal?.title || paper.journalTitle || "Unknown Journal";
          const year = paper.pubYear ? parseInt(paper.pubYear, 10) : null;

          try {
            insertStmt.run(pmid, cleanGene, title, abstract, authors, journal, year, buffer, Date.now());
          } catch (_) {}

          matchedCitations.push({
            id: pmid,
            title,
            abstract,
            authors,
            journal,
            year
          });
        }

        if (matchedCitations.length > 0) {
          return matchedCitations;
        }
      }
    }
  } catch (err: any) {
    console.warn(`[RAG Warning] Live Europe PMC search failed for "${formattedQuery}":`, err.message);
  }

  // Fallback: search SQLite database for matching terms
  const db = getDb();
  if (customQuery && customQuery.trim()) {
    const rawTerms = customQuery
      .replace(/\[.*?\]/g, " ")
      .replace(/\b(AND|OR|NOT)\b/gi, " ")
      .replace(/[()",]/g, " ")
      .split(/\s+/)
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 2 && t !== cleanGene.toLowerCase());

    if (rawTerms.length > 0) {
      const rows = db.prepare("SELECT id, title, abstract, authors, journal, year FROM literature_abstracts WHERE gene = ? ORDER BY year DESC").all(cleanGene) as any[];
      const matched = rows.filter(r => {
        const text = `${r.title} ${r.abstract}`.toLowerCase();
        return rawTerms.some(t => text.includes(t));
      });
      if (matched.length > 0) {
        return matched.map(r => ({
          id: r.id,
          title: r.title,
          abstract: r.abstract,
          authors: r.authors || "Unknown Authors",
          journal: r.journal || "Unknown Journal",
          year: r.year
        }));
      }
    }
  }

  return getGeneCitations(cleanGene, signal);
}
