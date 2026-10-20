#!/usr/bin/env bash
set -euo pipefail

STAGING_DIR="/home/ubuntu/dbnsfp_staging"
REPO_DIR="/home/ubuntu/Missense-Structural-Explorer"
DATA_DIR="$REPO_DIR/data"
LOG_FILE="$STAGING_DIR/ingest.log"
ZIP_URL="https://dist.genos.us/academic/c88d62/dbNSFP5.4a.zip"
MD5_URL="https://dist.genos.us/academic/c88d62/dbNSFP5.4a.zip.md5"
DB_TARGET="$DATA_DIR/dbnsfp_v5.sqlite"

mkdir -p "$STAGING_DIR"
cd "$STAGING_DIR"

echo "=== dbNSFP v5.4a Pipeline Started at $(date -u) ===" | tee -a "$LOG_FILE"

# 1. Download MD5 if not present
if [ ! -f "dbNSFP5.4a.zip.md5" ]; then
  echo "[1/6] Downloading MD5 checksum..." | tee -a "$LOG_FILE"
  aria2c -c -x8 -s8 -k8M -m0 --retry-wait=5 "$MD5_URL" | tee -a "$LOG_FILE"
fi

# 2. Download dbNSFP5.4a.zip with aria2c
echo "[2/6] Downloading dbNSFP5.4a.zip..." | tee -a "$LOG_FILE"
aria2c -c -x8 -s8 -k8M -m0 --retry-wait=5 "$ZIP_URL" | tee -a "$LOG_FILE"

# 3. Verify MD5 checksum
echo "[3/6] Verifying MD5 checksum..." | tee -a "$LOG_FILE"
md5sum -c dbNSFP5.4a.zip.md5 | tee -a "$LOG_FILE"

# 4. Resolve Docker Image
IMAGE=$(docker inspect -f '{{.Config.Image}}' missense-resolve-blue 2>/dev/null || echo "missense-resolve:oci-latest")
echo "Using Docker image: $IMAGE" | tee -a "$LOG_FILE"

# Clean up partial target database if it exists
rm -f "$DB_TARGET" "${DB_TARGET}-shm" "${DB_TARGET}-wal"

# 5. Ingest chromosomes one by one
echo "[4/6] Streaming chromosome ingestion..." | tee -a "$LOG_FILE"
CHRS=$(unzip -l dbNSFP5.4a.zip | grep -o 'dbNSFP5\.4a/dbNSFP5\.4a_variant\.chr[0-9XYM]*\.gz' | sort -V)

for chr_file in $CHRS; do
  echo "--- Ingesting $chr_file at $(date -u) ---" | tee -a "$LOG_FILE"
  unzip -p dbNSFP5.4a.zip "$chr_file" | docker run -i --rm \
    -v "$DATA_DIR:/app/data" \
    -v "$REPO_DIR/tools/ingest_dbnsfp.ts:/app/tools/ingest_dbnsfp.ts" \
    "$IMAGE" \
    npx tsx tools/ingest_dbnsfp.ts - data/dbnsfp_v5.sqlite --version 5.4a --skip-indexes 2>&1 | tee -a "$LOG_FILE"
done

# 6. Build indexes
echo "[5/6] Building SQLite indexes at $(date -u)..." | tee -a "$LOG_FILE"
docker run --rm \
  -v "$DATA_DIR:/app/data" \
  -v "$REPO_DIR/tools/ingest_dbnsfp.ts:/app/tools/ingest_dbnsfp.ts" \
  "$IMAGE" \
  npx tsx tools/ingest_dbnsfp.ts --indexes-only data/dbnsfp_v5.sqlite 2>&1 | tee -a "$LOG_FILE"

# 7. Verification
echo "[6/6] Verifying SQLite database..." | tee -a "$LOG_FILE"
docker run --rm \
  -v "$DATA_DIR:/app/data" \
  "$IMAGE" \
  node -e "
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync('data/dbnsfp_v5.sqlite');
    const rowCount = db.prepare('SELECT count(*) as c FROM variant_scores;').get();
    const meta = db.prepare('SELECT key, value FROM build_meta;').all();
    console.log('Total variant rows:', rowCount.c);
    console.log('Build metadata:', JSON.stringify(meta, null, 2));
    const sample = db.prepare(\"SELECT gene, pos, revel, alphamissense, popeve, cadd FROM variant_scores WHERE gene = 'BRAF' AND pos = 600 LIMIT 3;\").all();
    console.log('Sample BRAF 600 lookup:', JSON.stringify(sample, null, 2));
  " 2>&1 | tee -a "$LOG_FILE"

# 8. Clean up staged zip archive to reclaim 48 GB disk space
echo "[7/7] Cleaning up zip archive to restore disk space..." | tee -a "$LOG_FILE"
rm -f "$STAGING_DIR/dbNSFP5.4a.zip"

echo "=== Pipeline Completed Successfully at $(date -u) ===" | tee -a "$LOG_FILE"
