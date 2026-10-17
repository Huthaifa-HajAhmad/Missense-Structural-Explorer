#!/usr/bin/env bash
# Check a finished dbNSFP store against the facts the loader is supposed to guarantee.
# Exits non-zero on the first violated expectation, so it can gate deleting the source archive.
#
# Every query is bounded or indexed: run it after tools/rebuild_dbnsfp.sh has built the indexes.
#
# Usage: tools/verify_dbnsfp.sh [store.sqlite]
set -uo pipefail

DB="${1:-$HOME/Missense-Structural-Explorer/data/dbnsfp_v5.sqlite}"
FAILED=0
q() { sqlite3 -readonly "$DB" "$1"; }
check() { # name, actual, "test" as shell arithmetic/string expectations
  local name="$1" ok="$2" detail="$3"
  if [ "$ok" = "1" ]; then echo "PASS  $name  ($detail)"; else echo "FAIL  $name  ($detail)"; FAILED=1; fi
}

[ -s "$DB" ] || { echo "No store at $DB"; exit 1; }

echo "== build_meta"
q "SELECT key, substr(value,1,120) FROM build_meta WHERE key NOT LIKE 'rows:%' ORDER BY key;"

# 1. Every chromosome loaded, and the per-chromosome counts add up to the table.
chroms=$(q "SELECT count(*) FROM build_meta WHERE key LIKE 'rows:%';")
meta_total=$(q "SELECT coalesce(sum(CAST(value AS INTEGER)),0) FROM build_meta WHERE key LIKE 'rows:%';")
table_total=$(q "SELECT count(*) FROM variant_scores;")
check "all 25 chromosomes recorded" "$([ "$chroms" = "25" ] && echo 1 || echo 0)" "$chroms recorded"
check "table rows equal the recorded per-chromosome sum" "$([ "$meta_total" = "$table_total" ] && echo 1 || echo 0)" "meta=$meta_total table=$table_total"

# 2. Transcript policy: MANE Select must have been the basis, not the first-listed fallback.
policy=$(q "SELECT value FROM build_meta WHERE key='transcript_policy';")
check "transcript policy is mane" "$([ "$policy" = "mane" ] && echo 1 || echo 0)" "policy=$policy"

# Per-row basis: the readers refuse `first-listed` rows, so every row must say how it was chosen, and the
# loader's own pick counts (stored rows only) must add up to the table exactly.
has_basis=$(q "SELECT count(*) FROM pragma_table_info('variant_scores') WHERE name='transcript_basis';")
check "rows record their transcript basis" "$([ "$has_basis" = "1" ] && echo 1 || echo 0)" "column present=$has_basis"
picks=$(q "SELECT value FROM build_meta WHERE key='transcript_pick_counts';")
pick_sum=$(q "SELECT coalesce(json_extract(value,'\$.mane'),0)+coalesce(json_extract(value,'\$.\"ensembl-canonical\"'),0)+coalesce(json_extract(value,'\$.\"first-listed\"'),0)+coalesce(json_extract(value,'\$.single'),0) FROM build_meta WHERE key='transcript_pick_counts';")
check "loader pick counts sum to the table" "$([ -n "$pick_sum" ] && [ "$pick_sum" = "$table_total" ] && echo 1 || echo 0)" "picks=$pick_sum table=$table_total"
echo "INFO  transcript picks: $picks"
null_basis=$(q "SELECT count(*) FROM variant_scores WHERE rowid % 997 = 0 AND (transcript_basis IS NULL OR transcript_basis NOT IN ('mane','ensembl-canonical','single','first-listed'));")
check "no sampled row lacks a valid basis (every 997th row)" "$([ "$null_basis" = "0" ] && echo 1 || echo 0)" "$null_basis"
# The store keeps no per-pick counts, so test the outcome on genes with a well-known MANE Select transcript.
# The remainder of each gene's rows are variants that do not touch the MANE transcript at all (another isoform
# is then the only option), which is why this is a share and not 100%. A loader that falls back to the
# first-listed transcript puts only ~20% of multi-transcript rows on MANE, so 75% separates the two cleanly.
mane_total=0; mane_on=0
for pair in BRAF:ENST00000646891 TP53:ENST00000269305 PAH:ENST00000553106 CFTR:ENST00000003084 NAE1:ENST00000290810 IL17RA:ENST00000319363; do
  g="${pair%%:*}"; t="${pair##*:}"
  n=$(q "SELECT count(*) FROM variant_scores WHERE gene='$g';")
  on=$(q "SELECT count(*) FROM variant_scores WHERE gene='$g' AND transcript='$t';")
  mane_total=$(( mane_total + n )); mane_on=$(( mane_on + on ))
  echo "INFO  $g: $on of $n rows on its MANE Select transcript $t"
done
check "most rows of six known genes sit on their MANE Select transcript (>= 75%)" "$([ "$mane_total" -gt 0 ] && [ $(( mane_on * 100 )) -ge $(( mane_total * 75 )) ] && echo 1 || echo 0)" "$mane_on of $mane_total"

# 3. Known residues: stored on the MANE Select numbering (UniProt-canonical for these genes).
brafc=$(q "SELECT count(*) FROM variant_scores WHERE gene='BRAF' AND pos=600 AND aa_change='p.Val600Glu';")
check "BRAF p.Val600Glu stored at residue 600" "$([ "$brafc" -ge 1 ] && echo 1 || echo 0)" "rows=$brafc"
# IL17RA is the gene where the first-listed transcript numbered a residue 198 and MANE Select numbered it 311.
il_mane=$(q "SELECT count(*) FROM variant_scores WHERE gene='IL17RA' AND transcript='ENST00000319363' AND pos=311;")
check "IL17RA rows carry the MANE Select numbering (residue 311 on ENST00000319363)" "$([ "$il_mane" -ge 1 ] && echo 1 || echo 0)" "rows=$il_mane"

# 4. Population counts present, and a zero is a zero (not NULL).
withpop=$(q "SELECT count(*) FROM variant_scores WHERE gene='BRAF' AND gnomad_an IS NOT NULL;")
zeros=$(q "SELECT count(*) FROM variant_scores WHERE gnomad_hom = 0 AND gene IN ('BRAF','TP53','PAH');")
nulls_with_ac=$(q "SELECT count(*) FROM variant_scores WHERE gene IN ('BRAF','TP53','PAH') AND gnomad_ac IS NOT NULL AND gnomad_hom IS NULL;")
check "gnomAD counts are stored" "$([ "$withpop" -ge 1 ] && echo 1 || echo 0)" "BRAF rows with AN=$withpop"
check "zero homozygote counts are kept as 0" "$([ "$zeros" -ge 1 ] && echo 1 || echo 0)" "rows with hom=0 in BRAF/TP53/PAH: $zeros"
check "no variant has an allele count but a missing homozygote count" "$([ "$nulls_with_ac" = "0" ] && echo 1 || echo 0)" "$nulls_with_ac"

# 5. Indexes the readers rely on exist.
for idx in idx_gene_pos idx_variant_scores_gene_pos_ref_alt idx_chr_pos_genomic_ref_alt; do
  has=$(q "SELECT count(*) FROM sqlite_master WHERE type='index' AND name='$idx';")
  check "index $idx" "$([ "$has" = "1" ] && echo 1 || echo 0)" "present=$has"
done

# 6. Exact-allele lookup is served by the index (not a table scan).
plan=$(q "EXPLAIN QUERY PLAN SELECT * FROM variant_scores WHERE chr='7' AND pos_genomic=140753336 AND ref='A' AND alt='T';" | tr '\n' ' ')
check "coordinate lookup uses idx_chr_pos_genomic_ref_alt" "$(echo "$plan" | grep -q idx_chr_pos_genomic_ref_alt && echo 1 || echo 0)" "$plan"

echo
if [ "$FAILED" = "0" ]; then echo "ALL CHECKS PASSED"; else echo "VERIFICATION FAILED"; fi
exit "$FAILED"
