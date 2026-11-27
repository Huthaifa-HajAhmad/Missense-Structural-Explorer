#!/bin/sh
# Runs capture.mjs once per panel variant, in its own Node process, so one crash cannot stop the rest.
# Each variant's tabs/, views/, api/, axe.json and meta.json are cleared first, so a rerun overwrites.
# Set KEEP_OK=1 to skip variants whose meta.json already says "status": "ok" (resume mode).
# Usage (from the worktree root): sh doc/release-audit/tools/run-all.sh
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RAW="$ROOT/doc/release-audit/raw"
cd "$ROOT" || exit 1

for id in $(node -e 'const p = require("./doc/release-audit/panel.json"); console.log(p.variants.map(v => v.id).join(" "))'); do
  mkdir -p "$RAW/$id"
  if [ "${KEEP_OK:-0}" = "1" ] && grep -q '"status": "ok"' "$RAW/$id/meta.json" 2>/dev/null; then
    echo "skip $id (already ok)"
    continue
  fi
  rm -rf "$RAW/$id/tabs" "$RAW/$id/views" "$RAW/$id/api" "$RAW/$id/axe.json" "$RAW/$id/meta.json"
  echo "run  $id $(date -u +%H:%M:%S)"
  node doc/release-audit/tools/capture.mjs --only "$id" > "$RAW/$id/run.log" 2>&1
  echo "done $id exit=$? $(grep -o '"status": "[a-z]*"' "$RAW/$id/meta.json" 2>/dev/null | head -1)"
done
echo ALL_DONE
