#!/usr/bin/env bash
# Streamed download & optimization pipeline for popEVE GRCh38 VCF.
# Strips empty QUAL/ID/FILTER fields and rounds popEVE scores to 3 decimals.
# Final size: ~280 MB (down from ~5 GB).
set -e

OUTDIR="$(dirname "$0")/../data/popeve"
mkdir -p "$OUTDIR"

echo "[setup-popeve] Streaming and optimizing popEVE GRCh38 VCF (~280 MB target)..."
curl -sSL "https://pop.evemodel.org/downloads/grch38_popEVE_ukbb.vcf.gz" \
  | zcat \
  | awk -F'\t' 'BEGIN{OFS="\t"} /^#/ {if (/^##INFO=<ID=popEVE/ || /^#CHROM/) print; next} { match($8, /popEVE=([0-9.]+)/, m); if (m[1] != "") printf "%s\t%s\t.\t%s\t%s\t.\tPASS\tpopEVE=%.3f\n", $1, $2, $4, $5, m[1] }' \
  | bgzip -c > "$OUTDIR/popeve_grch38.vcf.gz"

echo "[setup-popeve] Building tabix index..."
tabix -p vcf "$OUTDIR/popeve_grch38.vcf.gz"

echo "[setup-popeve] Done. File footprint:"
ls -lh "$OUTDIR/"
