#!/usr/bin/env python3
"""
finish_rasp_indexing.py

Safe, low-memory completion script for the RaSP SQLite lookup index.
Uses disk-backed temporary storage (PRAGMA temp_store = FILE) and a 64MB cache
to prevent OOM exhaustion during B-tree index construction on large 9.4GB tables.
"""

import json
import os
import sqlite3
import sys
import time

SCHEMA_VERSION = 3


def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(base_dir, "data")
    db_path = os.path.join(data_dir, "df_rasp_gnomad_clinvar.sqlite")
    temp_db_path = f"{db_path}.building"
    csv_path = os.path.join(data_dir, "df_rasp_gnomad_clinvar.csv")
    zip_path = os.path.join(data_dir, "rasp_preds_alphafold_UP000005640_9606_HUMAN_v2.zip")

    if not os.path.exists(temp_db_path):
        print(f"ERROR: Target building database not found at: {temp_db_path}", file=sys.stderr)
        sys.exit(1)

    print(f"[RaSP Finish] Opening {temp_db_path} ({os.stat(temp_db_path).st_size / (1024**3):.2f} GB)...", flush=True)
    conn = sqlite3.connect(temp_db_path)
    cur = conn.cursor()

    # Configure strictly bounded memory PRAGMAs to prevent OOM
    cur.execute("PRAGMA cache_size = -64000;")   # 64 MB RAM cache only
    cur.execute("PRAGMA temp_store = FILE;")     # Force temp sort tables to disk
    cur.execute("PRAGMA synchronous = NORMAL;")

    # 1. Drop existing indexes if left half-created
    print("[RaSP Finish] Dropping existing index stubs if any...", flush=True)
    cur.execute("DROP INDEX IF EXISTS idx_rasp_exact;")
    cur.execute("DROP INDEX IF EXISTS idx_rasp_protein;")
    conn.commit()

    # 2. Build B-Tree Indexes
    print("[RaSP Finish] Building idx_rasp_exact (uniprot_id, pos, wt, mut)...", flush=True)
    t0 = time.time()
    cur.execute("CREATE INDEX idx_rasp_exact ON rasp_variants(uniprot_id, pos, wt, mut);")
    conn.commit()
    print(f"[RaSP Finish] idx_rasp_exact completed in {time.time() - t0:.1f}s", flush=True)

    print("[RaSP Finish] Building idx_rasp_protein (uniprot_id, pos)...", flush=True)
    t0 = time.time()
    cur.execute("CREATE INDEX idx_rasp_protein ON rasp_variants(uniprot_id, pos);")
    conn.commit()
    print(f"[RaSP Finish] idx_rasp_protein completed in {time.time() - t0:.1f}s", flush=True)

    # 3. Compute verification counts and metadata
    print("[RaSP Finish] Counting totals for schema v3 metadata...", flush=True)
    actual_rows = cur.execute("SELECT COUNT(*) FROM rasp_variants").fetchone()[0]
    actual_proteins = cur.execute("SELECT COUNT(DISTINCT uniprot_id) FROM rasp_variants").fetchone()[0]

    sources_counts = {}
    for s, c in cur.execute("SELECT source, COUNT(DISTINCT uniprot_id) FROM rasp_variants GROUP BY source").fetchall():
        sources_counts[s] = int(c)

    print(f"[RaSP Finish] Verified rows: {actual_rows:,}, unique proteins: {actual_proteins:,}", flush=True)
    print(f"[RaSP Finish] Sources distribution: {sources_counts}", flush=True)

    cur.executescript("""
        DROP TABLE IF EXISTS rasp_index_meta;
        CREATE TABLE rasp_index_meta (
            schema_version INTEGER NOT NULL,
            rows           INTEGER NOT NULL,
            proteins       INTEGER NOT NULL,
            source_file    TEXT,
            source_bytes   INTEGER,
            built_at       TEXT    NOT NULL,
            sources        TEXT
        );
    """)

    source_names = []
    total_bytes = 0
    if os.path.exists(csv_path):
        source_names.append(os.path.basename(csv_path))
        total_bytes += os.stat(csv_path).st_size
    if os.path.exists(zip_path):
        source_names.append(os.path.basename(zip_path))
        total_bytes += os.stat(zip_path).st_size

    cur.execute("""
        INSERT INTO rasp_index_meta
          (schema_version, rows, proteins, source_file, source_bytes, built_at, sources)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        SCHEMA_VERSION,
        actual_rows,
        actual_proteins,
        " + ".join(source_names),
        total_bytes,
        time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        json.dumps(sources_counts)
    ))
    conn.commit()
    conn.close()

    print(f"[RaSP Finish] Swapping {temp_db_path} -> {db_path} ...", flush=True)
    os.replace(temp_db_path, db_path)
    print(f"[RaSP Finish] SUCCESS: Whole-proteome RaSP index installed -> {db_path}", flush=True)


if __name__ == "__main__":
    main()
