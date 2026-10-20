#!/usr/bin/env bash
set -euo pipefail

STAGING_DIR="/home/ubuntu/dbnsfp_staging"
REPO_DIR="/home/ubuntu/Missense-Structural-Explorer"
DATA_DIR="$REPO_DIR/data"
LOG_FILE="$STAGING_DIR/ingest.log"
DB_TARGET="$DATA_DIR/dbnsfp_v5.sqlite"

mkdir -p "$STAGING_DIR"
cd "$STAGING_DIR"

echo "=== Resuming dbNSFP v5.4a Chromosome Ingestion (chr13+) at $(date -u) ===" | tee -a "$LOG_FILE"

# Resolve Docker Image
IMAGE=$(docker inspect -f '{{.Config.Image}}' missense-resolve-blue 2>/dev/null || echo "missense-resolve:oci-latest")
echo "Using Docker image: $IMAGE" | tee -a "$LOG_FILE"

# Ingest remaining chromosomes: 13-22, M, X, Y
REMAINING_CHRS="13 14 15 16 17 18 19 20 21 22 M X Y"

for chr in $REMAINING_CHRS; do
  chr_file="dbNSFP5.4a/dbNSFP5.4a_variant.chr${chr}.gz"
  echo "--- Ingesting $chr_file at $(date -u) ---" | tee -a "$LOG_FILE"
  
  unzip -p dbNSFP5.4a.zip "$chr_file" | docker run -i --rm \
    -u "$(id -u):$(id -g)" \
    -v "$DATA_DIR:/app/data" \
    -v "$REPO_DIR/tools/ingest_dbnsfp.ts:/app/tools/ingest_dbnsfp.ts" \
    "$IMAGE" \
    npx tsx tools/ingest_dbnsfp.ts --version 5.4a --skip-indexes --db data/dbnsfp_v5.sqlite - 2>&1 | tee -a "$LOG_FILE"
done

# Build SQLite indexes
echo "--- Building SQLite indexes at $(date -u) ---" | tee -a "$LOG_FILE"
docker run --rm \
  -u "$(id -u):$(id -g)" \
  -v "$DATA_DIR:/app/data" \
  -v "$REPO_DIR/tools/ingest_dbnsfp.ts:/app/tools/ingest_dbnsfp.ts" \
  "$IMAGE" \
  npx tsx tools/ingest_dbnsfp.ts --indexes-only --db data/dbnsfp_v5.sqlite 2>&1 | tee -a "$LOG_FILE"

# Verification
echo "--- Verifying SQLite database at $(date -u) ---" | tee -a "$LOG_FILE"
sqlite3 "$DB_TARGET" "SELECT key, value FROM build_meta;" | tee -a "$LOG_FILE"
sqlite3 "$DB_TARGET" "SELECT count(1) as total_variants FROM variant_scores;" | tee -a "$LOG_FILE"
sqlite3 "$DB_TARGET" "SELECT gene, pos, ref, alt, revel, alphamissense, popeve, cadd FROM variant_scores WHERE gene='BRAF' AND pos=600 LIMIT 3;" | tee -a "$LOG_FILE"

# Clean up staged zip archive to reclaim 48 GB disk space
echo "--- Cleaning up zip archive to restore disk space ---" | tee -a "$LOG_FILE"
rm -f "$STAGING_DIR/dbNSFP5.4a.zip"
df -h / | tee -a "$LOG_FILE"

echo "=== Pipeline Completed Successfully at $(date -u) ===" | tee -a "$LOG_FILE"
