# Coordinate resolver concordance, 2026-10-17

This study supplies the evidence for ordering the coordinate ladder: cache, then local dbNSFP, ProtVar, Ensembl VEP and VariantValidator. Its harness is `scripts/resolver_concordance.py`. The raw per-variant output was written to `.e2e/proof/resolver/full/` (gitignored), so re-run the harness to regenerate it.

## Method

- **Sample.** 248 GRCh38 SNVs, drawn by seeded random row id (`random.Random(20261017)`) from the VM store (dbNSFP 5.4a, 88,989,019 rows). The draw is stratified by stored `transcript_basis`: 120 `mane`, 60 `single`, 45 `ensembl-canonical` and 15 `first-listed`. Eight controls are added: PAH R408W, FGFR3 G380R, GBA1 L483P, CNNM2 E357K, TP53 R175H, BRAF V600E, IL17RA 311 and CFTR 508.
- **Providers.**
  - Local: the stored row, counted only when its transcript is the gene's numbering transcript (the rule in `dbnsfp_local.ts`).
  - ProtVar: `GET /ProtVar/api/mapping?q=chr-pos-ref-alt&assembly=GRCh38`, taking the canonical isoform.
  - VEP: batched `POST /vep/human/hgvs`, taking MANE, then canonical, then any protein change. This mirrors `selectProteinConsequence`.
  - VariantValidator: `/variantvalidator/GRCh38/chr-pos-ref-alt/mane`.
- **Oracle.** Does the UniProt canonical sequence (accession taken from VEP `swissprot`, else ProtVar) carry the reported wild type at the reported position? No provider controls this check, but it is a necessary condition, not a sufficient one.

## Results

| Provider | Answered (of 248) | Oracle pass / fail / unchecked | Median, p95 latency |
|---|---|---|---|
| Local (numbering rule) | 194 | 153 / 29 / 12 | under 1 ms (in-process) |
| ProtVar | 192 | 192 / 0 / 0 | 350 ms, 660 ms |
| Ensembl VEP | 248 | 164 / 39 / 45 | batched, so not comparable |
| VariantValidator | 188 | 150 / 31 / 7 | 482 ms, 4,075 ms |

- **MANE rows.** Local, VEP and VariantValidator agree on 120 of 120 rows on position, wild type and mutant. The 95% lower bound is about 97.5%.
- **Local against VEP:** 190 of 194 agree. All four differences come from rows on an Ensembl-canonical transcript of a second gene at the same locus: a readthrough gene (ANKHD1-EIF4EBP3), unnamed `ENSG…` genes, or an overlapping gene (PDF). The positions and amino acids are each gene's own; only the gene differs. No difference occurs within one gene.
- **Local oracle "fails":** 27 of 29 give the same position as VEP's MANE answer. That means the MANE protein is numbered differently from UniProt canonical, which `isoform-numbering.ts` already reconciles. This is not an error.
- **ProtVar against VEP:** 156 of 192 agree. In 29 cases only the position differs (UniProt canonical versus MANE numbering). In 7 cases the change is synonymous on the canonical protein, and VEP had fallen back to a non-MANE transcript. ProtVar never contradicted another provider on the canonical protein.
- **Rows outside the numbering rule:** 39 sampled rows fall outside the rule (37 `single` rows plus 2 Ensembl-canonical rows in genes that also have MANE rows). VEP picked MANE for only 4 of them, and ProtVar had no canonical missense answer for 29. Excluding these rows is correct.

## Implications for the ladder

1. **Local rung.** Serve only rows on a MANE transcript, and only when one gene's reading stands. A readthrough gene or a second gene at the locus defers to remote. Local is never a "not missense" verdict.
2. **ProtVar rung.** It reports UniProt canonical numbering directly, so its answers reconcile as `canonical` without a remap. A change that is synonymous on the canonical protein must be a miss that continues down the ladder, not a final answer. It has no MANE or HGVSc fields, so the response must say so.
3. **Recommended order:** cache, local (MANE), ProtVar, VEP, VariantValidator. Proceed only after the open items below, behind a shadow-mode flag, with the current ladder still serving.

## Shadow rollout (implemented)

`server/services/translation/shadow-tiers.ts` runs both candidate rungs after every fresh GRCh38 SNV resolution. It compares local against the served MANE consequence and ProtVar against the served canonical numbering. It never serves either rung.

- **Counters:** `resolverShadow` in `/api/v1/diagnostics` (agree, disagree, miss, no-reference, error per rung).
- **Disagreement log:** `[Resolver shadow] … disagrees with …` in the server log.
- **Switch:** `RESOLVER_SHADOW_TIERS`.
- **Promotion criterion:** promote a rung into the live ladder (and relabel the Search page's Services row) only after its disagreements on real traffic have been read one by one and none is an error of the rung.

## Limitations

- **Sample size.** 248 variants. Rare classes are thin: 15 `first-listed` rows, and chrM, X and Y appear only through random draw.
- **SNVs only.** No cDNA, indel or GRCh37 inputs were tested. Those paths are unchanged and still go to VEP or VariantValidator.
- **Oracle limits.** The oracle accession comes from VEP's `swissprot`, so ProtVar's 100% pass is checked against VEP's choice of canonical, not a fully independent one. The oracle is single-residue, so a wrong offset passes by chance about 1 time in 19.
- **Timing.** One run, from one network location, on one day. No rate limit was hit at about 2 requests per second.
- **ProtVar terms.** ProtVar's service terms and SLA were not reviewed.
