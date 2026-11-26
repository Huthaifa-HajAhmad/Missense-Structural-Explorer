#!/usr/bin/env bash
# Streamed download & slimming pipeline for popEVE's GRCh38 VCF (v1.1, 2025-07-15 release, 1.5 GB).
# Each row keeps three INFO fields: the protein popEVE scored (one RefSeq protein per gene, not always
# UniProt's main isoform), the substitution on that protein, and the popEVE score. The resolver reads
# all three, so the app can say which protein and residue a score belongs to.
# Needs gawk (for match() with a capture array), bgzip and tabix.
set -euo pipefail

OUTDIR="$(dirname "$0")/../data/popeve"
mkdir -p "$OUTDIR"

echo "[setup-popeve] Streaming and slimming popEVE GRCh38 VCF..."
curl -fsSL "https://data.evemodel.org/popeve/v1.1/downloads/grch38_popEVE_ukbb_20250715.vcf.gz" \
  | zcat \
  | gawk -F'\t' '/^#/ {if (/^#CHROM/) print; next} {
      # popEVE scores are negative, so the sign must be part of the match.
      match($8, /(^|;)popEVE=(-?[0-9.]+)/, s); match($8, /(^|;)protein=([^;]+)/, p); match($8, /(^|;)mutant=([^;]+)/, m);
      if (s[2] != "") printf "%s\t%s\t.\t%s\t%s\t.\tPASS\tprotein=%s;mutant=%s;popEVE=%s\n", $1, $2, $4, $5, p[2], m[2], s[2] }' \
  | bgzip -c > "$OUTDIR/popeve_grch38.vcf.gz"

echo "[setup-popeve] Building tabix index..."
tabix -p vcf "$OUTDIR/popeve_grch38.vcf.gz"

echo "[setup-popeve] Done. File footprint:"
ls -lh "$OUTDIR/"
