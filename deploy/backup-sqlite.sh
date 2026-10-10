#!/usr/bin/env bash
# ==============================================================================
# backup-sqlite.sh — Safe Live SQLite Backup for Missense-Structural-Explorer
# Performs an atomic, non-blocking online backup of analyses.sqlite and accounts.sqlite
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${SCRIPT_DIR}/../data"
BACKUP_DIR="${SCRIPT_DIR}/../backups"
TIMESTAMP="$(date +'%Y%m%d_%H%M%S')"

mkdir -p "${BACKUP_DIR}"

echo "[$(date +'%Y-%m-%d %H:%M:%S')] Starting SQLite backup..."

# 1. Back up the analysis provenance database and the account database, each if present.
#    accounts.sqlite holds the team's logins (scrypt hashes only, never passwords); losing it means
#    re-inviting everyone, so it is backed up with the same online .backup as the analyses.
for DB_NAME in analyses accounts; do
    if [ -f "${DATA_DIR}/${DB_NAME}.sqlite" ]; then
        TARGET_BACKUP="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sqlite"
        sqlite3 "${DATA_DIR}/${DB_NAME}.sqlite" ".backup '${TARGET_BACKUP}'"
        gzip -f "${TARGET_BACKUP}"
        echo "[$(date +'%Y-%m-%d %H:%M:%S')] Backup complete: ${TARGET_BACKUP}.gz"
    fi
done

# 2. Rotate local backups: keep only backups from the last 14 days
find "${BACKUP_DIR}" -type f \( -name "analyses_*.sqlite.gz" -o -name "accounts_*.sqlite.gz" \) -mtime +14 -delete
echo "[$(date +'%Y-%m-%d %H:%M:%S')] Old local backups rotated successfully (14-day retention)."

# 3. Offsite Sync to Cloudflare R2 (10GB Free Tier, Zero Egress) via rclone
R2_REMOTE="${R2_REMOTE:-r2:missense-resolve-backups}"
if command -v rclone &> /dev/null && rclone listremotes | grep -q "^${R2_REMOTE%%:*}:"; then
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] Syncing backups to offsite Cloudflare R2 bucket (${R2_REMOTE})..."
    rclone sync "${BACKUP_DIR}/" "${R2_REMOTE}" --transfers 4 --fast-list
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] Offsite Cloudflare R2 backup sync complete."
else
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] Offsite backup skipped (rclone remote '${R2_REMOTE}' not configured). Local backup preserved."
fi
