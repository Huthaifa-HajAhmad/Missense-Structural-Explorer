#!/usr/bin/env python3
"""
build_rasp_sqlite_streaming.py

High-performance streaming builder for the RaSP SQLite lookup index.
Streams PRISM/CSV predictions directly from the AlphaFold proteome zip file
without extracting 300GB of uncompressed text to disk.

Schema Version: 3
Matches src/shared/raspIndex.ts and server/services/stability/build-rasp-sqlite.ts.
"""

import csv
import io
import json
import os
import re
import sqlite3
import sys
import time
import zipfile

SCHEMA_VERSION = 3
BATCH_SIZE = 25000
VARIANT_REGEX = re.compile(r"^([A-Za-z])(\d+)([A-Za-z])$")
AF_FILE_REGEX = re.compile(r"rasp_pred_AF-([A-Za-z0-9]+)-F(\d+)-", re.IGNORECASE)


def parse_variant(v: str):
    m = VARIANT_REGEX.match(v.strip())
    if not m:
        return None
    wt, pos_str, mut = m.groups()
    return wt.upper(), int(pos_str), mut.upper()


def build_index(data_dir: str, zip_path: str, csv_path: str, db_path: str):
    temp_db_path = f"{db_path}.building"
    if os.path.exists(temp_db_path):
        try:
            os.remove(temp_db_path)
        except Exception:
            pass

    started_at = time.time()
    conn = sqlite3.connect(temp_db_path)
    cur = conn.cursor()

    # Performance PRAGMAs for massive bulk inserts
    cur.execute("PRAGMA synchronous = OFF;")
    cur.execute("PRAGMA journal_mode = MEMORY;")
    cur.execute("PRAGMA cache_size = -1000000;")  # 1GB cache
    cur.execute("PRAGMA temp_store = MEMORY;")

    cur.executescript("""
        DROP TABLE IF EXISTS rasp_variants;
        CREATE TABLE rasp_variants (
            uniprot_id           TEXT    NOT NULL,
            pos                  INTEGER NOT NULL,
            wt                   TEXT    NOT NULL,
            mut                  TEXT    NOT NULL,
            pdb                  TEXT,
            pdb_chain            TEXT,
            chain_id             TEXT,
            rasp_score           REAL,
            clinvar_significance TEXT,
            gnomad_af            REAL,
            source               TEXT    NOT NULL DEFAULT 'experimental'
        );
    """)

    insert_sql = """
        INSERT INTO rasp_variants
          (uniprot_id, pos, wt, mut, pdb, pdb_chain, chain_id,
           rasp_score, clinvar_significance, gnomad_af, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    total_rows = 0
    total_skipped = 0
    batch = []

    def flush_batch():
        nonlocal batch
        if batch:
            cur.executemany(insert_sql, batch)
            conn.commit()
            batch = []

    # 1. Ingest Zenodo CSV if present
    if os.path.exists(csv_path):
        print(f"[RaSP Builder] Ingesting Zenodo CSV: {csv_path} ...", flush=True)
        with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            for parts in reader:
                if len(parts) < 6:
                    total_skipped += 1
                    continue
                uniprot_id, pdb_chain, pdb, chain_id, variant = parts[0], parts[1], parts[2], parts[3], parts[4]
                parsed = parse_variant(variant)
                if not parsed:
                    total_skipped += 1
                    continue
                wt, pos, mut = parsed
                try:
                    rasp_score = float(parts[5]) if parts[5].strip() else None
                except ValueError:
                    rasp_score = None
                clinvar_sig = parts[6].strip() if len(parts) > 6 and parts[6].strip() else None
                try:
                    gnomad_af = float(parts[7]) if len(parts) > 7 and parts[7].strip() else None
                except ValueError:
                    gnomad_af = None

                batch.append((
                    uniprot_id.strip(), pos, wt, mut,
                    pdb.strip() if pdb else None,
                    pdb_chain.strip() if pdb_chain else None,
                    chain_id.strip() if chain_id else None,
                    rasp_score, clinvar_sig, gnomad_af, "experimental"
                ))
                total_rows += 1
                if len(batch) >= BATCH_SIZE:
                    flush_batch()
                    if total_rows % 500000 == 0:
                        print(f"[RaSP Builder] CSV Imported {total_rows:,} rows...", flush=True)
        flush_batch()
        print(f"[RaSP Builder] Zenodo CSV complete. Total rows: {total_rows:,}", flush=True)

    # 2. Stream AlphaFold proteome from ZIP directly
    if os.path.exists(zip_path):
        print(f"[RaSP Builder] Streaming AlphaFold proteome from {zip_path} ...", flush=True)
        zip_stat = os.stat(zip_path)
        with zipfile.ZipFile(zip_path, "r") as z:
            csv_files = [n for n in z.namelist() if n.endswith(".csv")]
            print(f"[RaSP Builder] Found {len(csv_files):,} CSV files in zip.", flush=True)
            files_processed = 0
            files_skipped_fragment = 0

            for fname in csv_files:
                base = os.path.basename(fname)
                af_match = AF_FILE_REGEX.match(base)
                if af_match:
                    acc = af_match.group(1).upper()
                    frag = int(af_match.group(2))
                else:
                    acc = None
                    frag = 1

                if frag > 1:
                    files_skipped_fragment += 1
                    continue

                with z.open(fname) as zf:
                    text_io = io.TextIOWrapper(zf, encoding="utf-8", errors="replace")
                    reader = csv.reader(text_io)
                    header = next(reader, None)
                    if not header:
                        continue

                    # header: uniprot, pdbid, chainid, sequence, variant, wt_nlf, mt_nlf, score_ml_fermi, score_ml, b_factors
                    # locate score_ml index, variant index, sequence index
                    try:
                        v_idx = header.index("variant")
                        s_idx = header.index("score_ml")
                        seq_idx = header.index("sequence") if "sequence" in header else 3
                    except ValueError:
                        # Fallback default positions
                        v_idx = 4
                        s_idx = 8
                        seq_idx = 3

                    seq = None
                    for row in reader:
                        if len(row) <= max(v_idx, s_idx):
                            total_skipped += 1
                            continue
                        parsed = parse_variant(row[v_idx])
                        if not parsed:
                            total_skipped += 1
                            continue
                        wt, pos, mut = parsed
                        if wt == mut:
                            total_skipped += 1
                            continue

                        # Check wild-type consistency against sequence
                        if seq is None and len(row) > seq_idx:
                            seq = row[seq_idx].strip().upper()
                        if seq and 0 < pos <= len(seq):
                            if seq[pos - 1] != wt:
                                total_skipped += 1
                                continue

                        try:
                            score = float(row[s_idx])
                        except ValueError:
                            total_skipped += 1
                            continue

                        uniprot = acc or (row[0].strip() if len(row) > 0 else "")
                        if not uniprot:
                            total_skipped += 1
                            continue

                        batch.append((
                            uniprot, pos, wt, mut,
                            None, None, None, score, None, None, "alphafold"
                        ))
                        total_rows += 1
                        if len(batch) >= BATCH_SIZE:
                            flush_batch()
                            if total_rows % 1000000 == 0:
                                print(f"[RaSP Builder] Processed {files_processed:,} proteins, {total_rows:,} variants...", flush=True)

                files_processed += 1
                if files_processed % 2000 == 0:
                    print(f"[RaSP Builder] Ingested {files_processed:,} / {len(csv_files):,} proteins...", flush=True)

            flush_batch()
            print(f"[RaSP Builder] Finished reading zip. Processed {files_processed:,} proteins (skipped {files_skipped_fragment:,} F2+ fragments).", flush=True)

    # 3. Create Indexes
    print("[RaSP Builder] Building SQLite indexes (idx_rasp_exact, idx_rasp_protein)...", flush=True)
    idx_start = time.time()
    cur.execute("CREATE INDEX idx_rasp_exact   ON rasp_variants(uniprot_id, pos, wt, mut);")
    cur.execute("CREATE INDEX idx_rasp_protein ON rasp_variants(uniprot_id, pos);")
    conn.commit()
    print(f"[RaSP Builder] Indexes built in {time.time() - idx_start:.1f}s", flush=True)

    # 4. Verify Counts & Metadata
    print("[RaSP Builder] Counting totals for schema v3 metadata...", flush=True)
    actual_rows = cur.execute("SELECT COUNT(*) FROM rasp_variants").fetchone()[0]
    actual_proteins = cur.execute("SELECT COUNT(DISTINCT uniprot_id) FROM rasp_variants").fetchone()[0]

    sources_counts = {}
    for s, c in cur.execute("SELECT source, COUNT(DISTINCT uniprot_id) FROM rasp_variants GROUP BY source").fetchall():
        sources_counts[s] = int(c)

    print(f"[RaSP Builder] Verified rows: {actual_rows:,}, unique proteins: {actual_proteins:,}")
    print(f"[RaSP Builder] Sources distribution: {sources_counts}")

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

    # 5. Atomic swap
    db_size = os.stat(temp_db_path).st_size
    print(f"[RaSP Builder] Built index size: {db_size / (1024*1024):.1f} MB. Swapping into {db_path}...", flush=True)
    os.replace(temp_db_path, db_path)
    os.chmod(db_path, 0o644)
    elapsed = time.time() - started_at
    print(f"[RaSP Builder] SUCCESS: Whole-proteome RaSP index installed in {elapsed:.1f}s ({elapsed/60:.1f} min) -> {db_path}", flush=True)


if __name__ == "__main__":
    base_dir = "/home/ubuntu/Missense-Structural-Explorer" if os.path.exists("/home/ubuntu/Missense-Structural-Explorer") else os.getcwd()
    data = os.path.join(base_dir, "data")
    z = os.path.join(data, "rasp_preds_alphafold_UP000005640_9606_HUMAN_v2.zip")
    c = os.path.join(data, "df_rasp_gnomad_clinvar.csv")
    d = os.path.join(data, "df_rasp_gnomad_clinvar.sqlite")

    build_index(data, z, c, d)
