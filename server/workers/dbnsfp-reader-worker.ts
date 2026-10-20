/**
 * dbnsfp-reader-worker.ts — runs the gene-sized dbNSFP reads off the HTTP event loop.
 *
 * Loaded by `server/services/prediction/dbnsfp-reader-pool.ts` (Piscina). Every function here calls
 * the same code the inline path uses (`dbnsfp-reader-core.ts`, `aggregateLandscape`), so moving a read
 * into the worker changes WHERE it runs, never what it returns.
 *
 * The connection is opened read-only and reused while the store's signature (size, mtime) is
 * unchanged; a replaced store is reopened on the next call.
 */
import { DatabaseSync } from "node:sqlite";
import {
  computeGeneNumbering,
  readLandscapeRows,
  type GeneNumbering,
  type LandscapeRowsResult,
} from "../services/prediction/dbnsfp-reader-core.ts";
import { aggregateLandscape, type AggregateOutput } from "../services/prediction/landscape-aggregate.ts";

let open: { key: string; db: DatabaseSync } | null = null;

function storeDb(dbPath: string, signature: string): DatabaseSync {
  const key = `${dbPath}|${signature}`;
  if (open?.key === key) return open.db;
  try {
    open?.db.close();
  } catch {
    /* already unusable */
  }
  open = { key, db: new DatabaseSync(dbPath, { open: true, readOnly: true }) };
  return open.db;
}

function storePolicy(db: DatabaseSync): () => string | null {
  return () => {
    try {
      const row = db.prepare("SELECT value FROM build_meta WHERE key = ?").get("transcript_policy") as { value?: string } | undefined;
      return row?.value ?? null;
    } catch {
      return null;
    }
  };
}

export function workerGeneNumbering({ dbPath, signature, gene }: { dbPath: string; signature: string; gene: string }): GeneNumbering {
  // `transcript: undefined` (a pre-basis store) survives the structured clone back to the caller.
  return computeGeneNumbering(storeDb(dbPath, signature), gene);
}

export interface WorkerLandscapeResult extends LandscapeRowsResult {
  /** Present when the caller asked for the aggregation too: the candidates are then not sent back. */
  aggregated?: AggregateOutput;
}

export function workerLandscape(params: {
  dbPath: string;
  signature: string;
  gene: string;
  startPos?: number;
  endPos?: number;
  /** Null: not known yet; a whole-gene window derives it from its own rows (see readLandscapeRows). */
  numbering: GeneNumbering | null;
  aggregate?: { start: number; end?: number; sequence: string | null };
}): WorkerLandscapeResult | null {
  const db = storeDb(params.dbPath, params.signature);
  const res = readLandscapeRows(db, params.gene, params.startPos, params.endPos, params.numbering, storePolicy(db));
  if (!res || !params.aggregate) return res;
  const aggregated = aggregateLandscape(res.candidates, {
    start: params.aggregate.start,
    end: params.aggregate.end ?? res.maxPos,
    sequence: params.aggregate.sequence,
    choice: { transcript: res.transcript, basis: res.transcriptBasis },
  });
  // 265k candidates are not worth cloning back across the thread boundary once aggregated.
  return { ...res, candidates: [], aggregated };
}
