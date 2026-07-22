# Canonical Strategy: Upgrading to dbNSFP v5.0 Local Deployment

> [!NOTE]
> **Current Status**: Local dbNSFP query execution is currently **deferred** in favor of live MyVariant.info API queries. The local SQLite database layer requires setting `ENABLE_LOCAL_DBNSFP=true` in environment variables and running `tools/ingest_dbnsfp.ts` to full completion (>50M rows).

---

## 1. Rationale for Local Upgrade
- **Outdated Annotations**: MyVariant.info operates on an older update cycle. Upgrading to dbNSFP v5.x provides current predictors (e.g. latest REVEL, AlphaMissense 3D-calibrated scores, updated conservation indices).
- **Latency & Reliability**: Removes third-party HTTP requests during variant analysis. Batch scans for a 101-residue window execute locally in `< 5ms` vs `200ms - 1500ms` via external endpoints.
- **Privacy & Offline Operations**: Fully offline capabilities without genomic query leaks.

---

## 2. Infrastructure Setup & Database Extraction

### Step A: Download dbNSFP 5.x Source
1. Download the dbNSFP release from [dbNSFP Official Releases](https://www.dbnsfp.org/releases/):
   ```bash
   wget http://database.liulab.science/dbNSFP/dbNSFP5.0a.zip
   unzip dbNSFP5.0a.zip
   ```
2. The dataset contains chromosome-specific tab-separated text files (e.g. `dbNSFP5.0a_variant.chr1`, `dbNSFP5.0a_variant.chr2`, ...).

### Step B: Filter and Build a Compressed SQLite / DuckDB Database
Since the raw dbNSFP v5.0 dataset exceeds **40 GB**, we filter it to index only the columns needed by the explorer app.

Create a Node.js ingestion script (`tools/ingest_dbnsfp.ts`) using `sqlite3` or `better-sqlite3`:

```typescript
import Database from 'better-sqlite3';
import fs from 'fs';
import readline from 'readline';

const db = new Database('data/dbnsfp_v5.sqlite');

// Initialize schema with strict types and composite indexing
db.exec(`
  CREATE TABLE IF NOT EXISTS variant_scores (
    gene TEXT NOT NULL,
    pos INTEGER NOT NULL,
    revel REAL,
    alphamissense REAL,
    gerp REAL,
    phylop REAL
  );
  CREATE INDEX IF NOT EXISTS idx_gene_pos ON variant_scores (gene, pos);
`);

const insert = db.prepare(`
  INSERT INTO variant_scores (gene, pos, revel, alphamissense, gerp, phylop)
  VALUES (?, ?, ?, ?, ?, ?)
`);

// Ingest chromosome files line-by-line
async function ingestFile(filepath: string) {
  const fileStream = fs.createReadStream(filepath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let isHeader = true;
  let indices = { gene: -1, pos: -1, revel: -1, am: -1, gerp: -1, phylop: -1 };

  for await (const line of rl) {
    const parts = line.split('\t');
    if (isHeader) {
      // Map columns dynamically based on header names
      indices.gene = parts.indexOf('geneName');
      indices.pos = parts.indexOf('aaPos');
      indices.revel = parts.indexOf('REVEL_score');
      indices.am = parts.indexOf('AlphaMissense_score');
      indices.gerp = parts.indexOf('GERP++_RS');
      indices.phylop = parts.indexOf('phyloP100way_vertebrate');
      isHeader = false;
      continue;
    }

    const gene = parts[indices.gene];
    const pos = parseInt(parts[indices.pos], 10);
    if (!gene || isNaN(pos)) continue;

    const revel = parseFloat(parts[indices.revel]) || null;
    const am = parseFloat(parts[indices.am]) || null;
    const gerp = parseFloat(parts[indices.gerp]) || null;
    const phylop = parseFloat(parts[indices.phylop]) || null;

    insert.run(gene, pos, revel, am, gerp, phylop);
  }
}
```

*Estimated Output Database Size*: A filtered and indexed SQLite database containing only these essential columns for the entire exome is ~**1.8 GB** (highly portable and easy to distribute via Docker or git-lfs).

---

## 3. Backend Integration

Modify `server/services/external.ts` to swap the remote fetch request with a fast local SQL query:

```typescript
import Database from 'better-sqlite3';
const localDb = new Database('data/dbnsfp_v5.sqlite', { readonly: true });

export async function fetchLandscapeDataLocal(
  gene: string,
  startPos: number,
  endPos: number
): Promise<LandscapePositionData[]> {
  // Query all variants in the amino acid range
  const stmt = localDb.prepare(`
    SELECT pos, revel, alphamissense, gerp, phylop
    FROM variant_scores
    WHERE gene = ? AND pos BETWEEN ? AND ?
  `);
  const rows = stmt.all(gene, startPos, endPos) as any[];

  // Group scores by position
  const landscapeMap = new Map<number, {
    revelScores: number[];
    amScores: number[];
    gerpScores: number[];
    phylopScores: number[];
  }>();

  for (let pos = startPos; pos <= endPos; pos++) {
    landscapeMap.set(pos, { revelScores: [], amScores: [], gerpScores: [], phylopScores: [] });
  }

  rows.forEach(row => {
    const d = landscapeMap.get(row.pos);
    if (d) {
      if (row.revel !== null) d.revelScores.push(row.revel);
      if (row.alphamissense !== null) d.amScores.push(row.alphamissense);
      if (row.gerp !== null) d.gerpScores.push(row.gerp);
      if (row.phylop !== null) d.phylopScores.push(row.phylop);
    }
  });

  // Calculate stats exactly as defined in current pipelines
  const result: LandscapePositionData[] = [];
  for (let pos = startPos; pos <= endPos; pos++) {
    const d = landscapeMap.get(pos)!;
    const revelCount = d.revelScores.length;
    const amCount = d.amScores.length;

    result.push({
      residx: pos,
      revelMean: revelCount > 0 ? d.revelScores.reduce((a,b)=>a+b,0) / revelCount : null,
      revelMedian: getMedian(d.revelScores),
      revelMin: revelCount > 0 ? Math.min(...d.revelScores) : null,
      revelMax: revelCount > 0 ? Math.max(...d.revelScores) : null,
      revelCount,
      amMean: amCount > 0 ? d.amScores.reduce((a,b)=>a+b,0) / amCount : null,
      amMedian: getMedian(d.amScores),
      amMin: amCount > 0 ? Math.min(...d.amScores) : null,
      amMax: amCount > 0 ? Math.max(...d.amScores) : null,
      amCount,
      gerp: d.gerpScores.length > 0 ? d.gerpScores.reduce((a,b)=>a+b,0) / d.gerpScores.length : null,
      phylop: d.phylopScores.length > 0 ? d.phylopScores.reduce((a,b)=>a+b,0) / d.phylopScores.length : null
    });
  }

  return result;
}
```

---

## 4. Deployment Checkpoints
1. **Container Volume Mapping**: Mount `data/dbnsfp_v5.sqlite` as a read-only Docker volume on server deployment.
2. **Graceful Fallback**: If SQLite database file is missing on start, fall back to remote MyVariant.info API with warnings logged.
