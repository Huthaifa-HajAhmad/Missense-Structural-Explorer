import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import * as self from './dbnsfp_local.ts';

const DB_PATH = path.join(process.cwd(), 'data', 'dbnsfp_v5.sqlite');

let localDb: DatabaseSync | null = null;
let dbCheckFailed = false;

export function isLocalDbnsfpAvailable(): boolean {
  if (process.env.ENABLE_LOCAL_DBNSFP !== 'true') return false;
  if (!fs.existsSync(DB_PATH)) return false;
  try {
    const stat = fs.statSync(DB_PATH);
    return stat.size > 1024;
  } catch {
    return false;
  }
}

export function getDbInstance(): DatabaseSync | null {
  if (!isLocalDbnsfpAvailable() || dbCheckFailed) return null;
  if (!localDb) {
    try {
      const db = new DatabaseSync(DB_PATH, { open: true });
      const stmt = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='variant_scores'");
      const row = stmt.get() as { count: number } | undefined;
      if (!row || row.count === 0) {
        console.warn("[Local dbNSFP] Table variant_scores does not exist in SQLite DB. Disabling local mode.");
        dbCheckFailed = true;
        return null;
      }
      const countStmt = db.prepare("SELECT COUNT(*) as cnt FROM variant_scores LIMIT 1");
      const countRow = countStmt.get() as { cnt: number } | undefined;
      if (!countRow || countRow.cnt === 0) {
        console.warn("[Local dbNSFP] Local database is empty (0 records). Disabling local mode.");
        dbCheckFailed = true;
        return null;
      }
      localDb = db;
    } catch (err: any) {
      console.warn(`[Local dbNSFP] Failed to initialize SQLite database connection: ${err.message}`);
      dbCheckFailed = true;
      localDb = null;
    }
  }
  return localDb;
}

export interface LocalDbnsfpRecord {
  gene: string;
  pos: number;
  ref: string | null;
  alt: string | null;
  aa_change: string | null;
  revel: number | null;
  alphamissense: number | null;
  gerp: number | null;
  phylop: number | null;
  bayesdel: number | null;
  metarnn: number | null;
  clinpred: number | null;
  dann: number | null;
  eigen: number | null;
  esm1b: number | null;
  popeve: number | null;
  cadd: number | null;
  gnomad_ac: number | null;
  gnomad_an: number | null;
  gnomad_hom: number | null;
  aou_ac: number | null;
  aou_an: number | null;
  aou_het: number | null;
  aou_hom: number | null;
}

function matchAminoAcidChange(variantStr: string, dbAaChange: string | null): boolean {
  if (!dbAaChange) return false;
  const norm1 = variantStr.replace(/^p\./, '').toUpperCase();
  const norm2 = dbAaChange.replace(/^p\./, '').toUpperCase();
  if (norm1 === norm2) return true;

  const parse = (s: string) => {
    const m = s.match(/([A-Z]{1,3})[=:/]?(\d+)[=:/]?([A-Z]{1,3})/i);
    if (!m) return null;
    return {
      ref: m[1],
      pos: parseInt(m[2], 10),
      alt: m[3]
    };
  };

  const p1 = parse(norm1);
  const p2 = parse(norm2);
  if (!p1 || !p2) return false;

  if (p1.pos !== p2.pos) return false;

  const toSingle = (aa: string) => {
    if (aa.length === 1) return aa;
    const map: Record<string, string> = {
      ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C',
      GLU: 'E', GLN: 'Q', GLY: 'G', HIS: 'H', ILE: 'I',
      LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P',
      SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V'
    };
    return map[aa] || aa;
  };

  return toSingle(p1.ref) === toSingle(p2.ref) && toSingle(p1.alt) === toSingle(p2.alt);
}

/**
 * Fetch scores and population counts for a single variant
 */
export async function queryLocalDbnsfpVariant(
  gene: string,
  pos: number,
  ref?: string | null,
  alt?: string | null,
  aaChange?: string | null
): Promise<LocalDbnsfpRecord | null> {
  const db = self.getDbInstance();
  if (!db) return null;

  try {
    let stmt;
    let rows: any[] = [];
    if (ref && alt) {
      stmt = db.prepare(`
        SELECT * FROM variant_scores
        WHERE gene = ? AND pos = ? AND ref = ? AND alt = ?
        LIMIT 1
      `);
      rows = (stmt.all as any)(gene.trim().toUpperCase(), pos, ref.trim().toUpperCase(), alt.trim().toUpperCase());
    } else {
      stmt = db.prepare(`
        SELECT * FROM variant_scores
        WHERE gene = ? AND pos = ?
      `);
      rows = (stmt.all as any)(gene.trim().toUpperCase(), pos);
      if (aaChange && rows.length > 0) {
        const found = rows.find(r => matchAminoAcidChange(aaChange, r.aa_change));
        if (found) return found as LocalDbnsfpRecord;
      }
    }

    if (rows.length > 0) {
      return rows[0] as LocalDbnsfpRecord;
    }
  } catch (err: any) {
    console.warn(`[Local dbNSFP Error] single variant lookup failed:`, err.message);
  }
  return null;
}

function getMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Fetch all variant positions in range and compute landscape statistics
 */
export async function queryLocalDbnsfpLandscape(
  gene: string,
  startPos?: number,
  endPos?: number
): Promise<any[] | null> {
  const db = self.getDbInstance();
  if (!db) return null;

  try {
    let sPos: number;
    let ePos: number;

    if (startPos === undefined || endPos === undefined) {
      const boundaryStmt = db.prepare(`
        SELECT MIN(pos) as min_pos, MAX(pos) as max_pos
        FROM variant_scores
        WHERE gene = ?
      `);
      const boundary = (boundaryStmt.get as any)(gene.trim().toUpperCase());
      if (!boundary || boundary.min_pos === null) {
        return [];
      }
      sPos = boundary.min_pos;
      ePos = boundary.max_pos;
    } else {
      sPos = startPos;
      ePos = endPos;
    }

    const stmt = db.prepare(`
      SELECT pos, revel, alphamissense, gerp, phylop
      FROM variant_scores
      WHERE gene = ? AND pos BETWEEN ? AND ?
    `);
    const rows = (stmt.all as any)(gene.trim().toUpperCase(), sPos, ePos) as any[];

    // Group scores by position
    const landscapeMap = new Map<number, {
      revelScores: number[];
      amScores: number[];
      gerpScores: number[];
      phylopScores: number[];
    }>();

    for (let pos = sPos; pos <= ePos; pos++) {
      landscapeMap.set(pos, { revelScores: [], amScores: [], gerpScores: [], phylopScores: [] });
    }

    rows.forEach(row => {
      const d = landscapeMap.get(row.pos);
      if (d) {
        if (row.revel !== null && row.revel !== undefined) d.revelScores.push(row.revel);
        if (row.alphamissense !== null && row.alphamissense !== undefined) d.amScores.push(row.alphamissense);
        if (row.gerp !== null && row.gerp !== undefined) d.gerpScores.push(row.gerp);
        if (row.phylop !== null && row.phylop !== undefined) d.phylopScores.push(row.phylop);
      }
    });

    const result: any[] = [];
    for (let pos = sPos; pos <= ePos; pos++) {
      const d = landscapeMap.get(pos)!;
      const revelCount = d.revelScores.length;
      const amCount = d.amScores.length;

      result.push({
        residx: pos,
        revelMean: revelCount > 0 ? d.revelScores.reduce((a, b) => a + b, 0) / revelCount : null,
        revelMedian: getMedian(d.revelScores),
        revelMin: revelCount > 0 ? Math.min(...d.revelScores) : null,
        revelMax: revelCount > 0 ? Math.max(...d.revelScores) : null,
        revelCount,
        amMean: amCount > 0 ? d.amScores.reduce((a, b) => a + b, 0) / amCount : null,
        amMedian: getMedian(d.amScores),
        amMin: amCount > 0 ? Math.min(...d.amScores) : null,
        amMax: amCount > 0 ? Math.max(...d.amScores) : null,
        amCount,
        gerp: d.gerpScores.length > 0 ? d.gerpScores.reduce((a, b) => a + b, 0) / d.gerpScores.length : null,
        phylop: d.phylopScores.length > 0 ? d.phylopScores.reduce((a, b) => a + b, 0) / d.phylopScores.length : null
      });
    }

    const nonNullCount = result.filter(r => r.revelMean !== null || r.amMean !== null || r.gerp !== null).length;
    const totalExpected = (ePos - sPos + 1);
    if (sPos === ePos || nonNullCount === 0 || (totalExpected > 1 && nonNullCount < totalExpected * 0.2)) {
      console.log(`[Local dbNSFP Landscape] Insufficient local window coverage (${nonNullCount}/${totalExpected}), falling back to remote API.`);
      return null;
    }

    return result;
  } catch (err: any) {
    console.warn(`[Local dbNSFP Error] landscape query failed:`, err.message);
  }
  return null;
}
