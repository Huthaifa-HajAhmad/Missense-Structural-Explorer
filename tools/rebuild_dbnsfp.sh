#!/usr/bin/env bash
# Rebuild the local dbNSFP store from the staged release archive, one chromosome at a time.
#
#   unzip -p <zip> <member>.gz | docker run -i <image> tools/ingest_dbnsfp.ts - --skip-indexes
#
# so the 130 GB of unzipped text never touches the disk. Indexes are built once at the end.
#
# What this script deliberately does NOT do: delete the archive. A load is only as good as the loader
# that read it (a loader that misread dbNSFP 5.4a's MANE column stored the wrong residue for ~21% of
# multi-transcript rows and nothing failed), so the archive stays until tools/verify_dbnsfp.sh has
# passed against the finished store. Re-run this script only after removing the old store.
#
# Usage (on the host that holds the archive):  tools/rebuild_dbnsfp.sh
set -euo pipefail

VERSION="${DBNSFP_VERSION:-5.4a}"
STAGING_DIR="${DBNSFP_STAGING_DIR:-$HOME/dbnsfp_staging}"
REPO_DIR="${REPO_DIR:-$HOME/Missense-Structural-Explorer}"
DATA_DIR="$REPO_DIR/data"
ZIP="$STAGING_DIR/dbNSFP${VERSION}.zip"
LOG_FILE="$STAGING_DIR/rebuild.log"
DB_TARGET="$DATA_DIR/dbnsfp_v5.sqlite"
CHROMOSOMES="${DBNSFP_CHROMOSOMES:-1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 X Y M}"

log() { echo "$@" | tee -a "$LOG_FILE"; }

[ -f "$ZIP" ] || { echo "Archive not found: $ZIP" >&2; exit 1; }
# A second run over an existing store would load every chromosome again (the loader refuses that, but
# only after the first batch). Make the operator remove the store on purpose.
if [ -s "$DB_TARGET" ]; then
  echo "Refusing to start: $DB_TARGET already holds data. Remove it first if a full rebuild is intended." >&2
  exit 1
fi

cd "$STAGING_DIR"
IMAGE="${DBNSFP_IMAGE:-$(docker inspect -f '{{.Config.Image}}' missense-resolve-green 2>/dev/null || docker inspect -f '{{.Config.Image}}' missense-resolve-blue 2>/dev/null || true)}"
[ -n "$IMAGE" ] || { echo "No image found; set DBNSFP_IMAGE." >&2; exit 1; }

log "=== Rebuilding dbNSFP $VERSION store at $(date -u) ==="
log "Image: $IMAGE"
log "Archive: $ZIP ($(du -h "$ZIP" | cut -f1)); free disk: $(df -h / | awk 'NR==2{print $4}')"

for chr in $CHROMOSOMES; do
  member="dbNSFP${VERSION}/dbNSFP${VERSION}_variant.chr${chr}.gz"
  log "--- chr${chr}: $member at $(date -u) ---"
  # pipefail: a failing unzip (corrupt member) or a refused load (unreadable column format) stops here.
  unzip -p "$ZIP" "$member" | docker run -i --rm \
    -u "$(id -u):$(id -g)" \
    -v "$DATA_DIR:/app/data" \
    -v "$REPO_DIR/tools/ingest_dbnsfp.ts:/app/tools/ingest_dbnsfp.ts" \
    "$IMAGE" \
    npx tsx tools/ingest_dbnsfp.ts --version "$VERSION" --skip-indexes --db data/dbnsfp_v5.sqlite - 2>&1 | tee -a "$LOG_FILE"
  log "    free disk: $(df -h / | awk 'NR==2{print $4}')"
done

log "--- Building indexes at $(date -u) ---"
docker run --rm \
  -u "$(id -u):$(id -g)" \
  -v "$DATA_DIR:/app/data" \
  -v "$REPO_DIR/tools/ingest_dbnsfp.ts:/app/tools/ingest_dbnsfp.ts" \
  "$IMAGE" \
  npx tsx tools/ingest_dbnsfp.ts --indexes-only --db data/dbnsfp_v5.sqlite 2>&1 | tee -a "$LOG_FILE"

log "=== Load finished at $(date -u). Archive kept. Next: tools/verify_dbnsfp.sh, then delete $ZIP yourself. ==="
