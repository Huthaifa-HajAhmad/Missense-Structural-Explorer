# Release note: PP3/BP4 from one calibrated tool, Walker 2023 splicing PP3, and 113-spec VCEP rules

Phases 5b and 5c of `IN_SILICO_PRUNING_PLAN.md`, following `PRIMARY_PREDICTOR_DECISION.md`.

**What users will notice**

- **PP3/BP4 comes from one calibrated tool, at its calibrated strength.** For genes without a computable ClinGen VCEP specification, the engine reads REVEL, then BayesDel noAF, then AlphaMissense, then ESM1b, and the first one with a score sets the criterion at its published ClinGen band (Pejaver 2022; Bergquist 2025 for AlphaMissense and ESM1b). Before, a plurality vote of up to six tools gave PP3 or BP4 at Supporting only.
- **Version-pinned ClinGen VCEP gene overrides (113 active Released specs / 110 unique genes).** `src/shared/insilico/vcepRules.ts` applies the audited ClinGen Criteria Specification Registry snapshot (`2026-11-24`): REVEL single-cutoff and multi-strength rules, VCEP strength caps (e.g., `PTEN`, `MYH7`, `RASopathy`, `SCN1A`), REVEL → AlphaMissense (`CYP1B1`) and REVEL → CADD (`HBB`, `HBA2`) fallbacks without unauthorized spillover, multi-tool `all-of`/`k-of-n` combinations (`CTLA4`, `PIK3CD`, `PIK3R1`, `BMPR2`), single-tool non-REVEL VCEPs (`DDX41` AlphaMissense; `CEP290` CADD), missense exclusions (`PALB2`, `APC`, `CDH1` splicing-only; SCID/`GFAP`/`RMRP` excluded), and explicit curator notes for four typo-audited specs (`PAH`, `SLC9A6`, `AIPL1`, `CEP290`) and four uncomputable/competing advisory genes (`TP53`, `BRCA1`, `BRCA2`, `RYR1`).
- **Walker 2023 splicing PP3 ("PP3 once", never added on top of PVS1).** When `PVS1` does not already apply, SpliceAI `max Δ ≥ 0.20` (or the gene's VCEP splicing threshold) withholds missense BP4 and emits splicing `PP3` (or `PP3_Moderate` on `ABCA4` at `≥ 0.80`) if missense predictors read BP4, are indeterminate, or did not score. When missense already triggers PP3, `PP3` is emitted at most once (stronger band wins, with a corroboration note). When `PVS1` is met, splicing PP3 is never added.
- **Strict SpliceAI BP4 gating and MyVariant provenance.** BP4 is withheld when SpliceAI has not finished, when no verified GRCh38 nucleotide locus was resolved (including `serviceStatus.predictorData === "not_found"`, `canonicalBy === null`, or missing live SpliceAI on settled runs without a user-submitted GRCh37 coordinate), or when protein-selected MyVariant `spliceai` would otherwise leak across unresolved alleles.
- **A score between the bands gives no criterion.** If the active tool is indeterminate, neither PP3 nor BP4 is emitted from missense; later tools are not substituted unless SpliceAI splicing PP3 applies.
- **A disagreement note.** When another calibrated tool in the four-tool chain points the other way, the reason and summary note it without changing strength.
- **PP3 + PM1 is capped at Strong.** PM1 is withheld when PP3 reaches Strong.
- **BP4 Very Strong counts as −8 points** (Tavtigian 2020), labelled "Very strong", never "Stand-alone". Benign tiers subtract pathogenic points (net ≥ 2 for Likely Benign, net ≥ 7 for Benign) and revert to VUS when any Strong or Very Strong pathogenic criterion is present.
- **A failed dbNSFP lookup withholds PP3/BP4** except on VCEP rules that need no dbNSFP scores (`DDX41`, `CEP290`, and missense-excluded genes).
- **MetaRNN and ClinPred are gone.** CADD remains informational outside CADD-using VCEPs (`CTLA4`, `PIK3CD`, `PIK3R1`, `BMPR2`, `CEP290`, `HBB`, `HBA2`).
- **UI surfaces stay aligned.** Predictors tab & rail, Splicing tab & rail, Insights lanes/glossary, Report, and Contextual guides report the active VCEP specification, curator notes, and Walker 2023 splicing PP3 status from shared `decidePrimaryInsilico`.

**Measured effect on PP3/BP4 (ClinVar ≥ 2-star missense, OCI VM read-only dbNSFP 5.4a)**

Evaluated on 2026-11-24 against the Phase 5a/5b ClinVar ≥ 2-star missense join on the OCI VM (`variants.jsonl` from the read-only `dbnsfp_v5.sqlite` store; SpliceAI is absent from `dbnsfp_v5.sqlite`, so SpliceAI splicing PP3 and BP4 blocks do not apply in this table).

Held-out cohort `post_2023` (`N = 4,857` variants classified after every tool's training: `2,687` P/LP, `2,170` B/LB; `1,614` in VCEP genes — `1,364` computable, `83` excluded, `167` advisory):

| Measure | Old vote (Supporting only) | Phase 5b (default chain) | Phase 5c (default + VCEP table) |
|---|---:|---:|---:|
| PP3, any strength, on P/LP | 2,600 (96.8%) | 2,393 (89.1%) | 2,215 (82.4%) |
| BP4, any strength, on B/LB | 1,877 (86.5%) | 1,551 (71.5%) | 1,468 (67.6%) |
| Wrong direction: PP3 on B/LB | 197 (9.1%) | 126 (5.8%) | 111 (5.1%) |
| Wrong direction: BP4 on P/LP | 55 (2.0%) | 55 (2.0%) | 38 (1.4%) |
| Moderate or stronger, right direction, P/LP | 0 (0.0%) | 2,088 (77.7%) | 1,388 (51.7%) |
| Moderate or stronger, right direction, B/LB | 0 (0.0%) | 1,181 (54.4%) | 1,065 (49.1%) |

- `5b → 5c` on `post_2023`: `987` of `4,857` variants change code (`20.3%`): `672` keep direction at a lower VCEP strength cap, `303` move from a call to no-call/excluded (`199` `PP3 → none`, `104` `BP4 → none`), `10` move `none → call`, and `2` move `BP4 → PP3`.
- Phase 5c `post_2023` strength distribution: `PP3_Strong` `643`, `PP3_Moderate` `780`, `PP3` `903`, `none` `1,025` (including `83` VCEP-excluded), `BP4` `428`, `BP4_Moderate` `1,037`, `BP4_Strong` `39`, `BP4_VeryStrong` `2`.
- Phase 5c `post_2023` deciding tool: REVEL `4,014`, BayesDel noAF `491`, none/excluded `328`, AlphaMissense `17`, CADD `7`; disagreement note on `166` of `3,832` calls.
- Top VCEP genes changing calls in `post_2023`: `GCK` (`137`), `FBN1` (`54`), `HNF1A` (`42`), `DYSF` (`41`), `HNF4A` (`37`), `PTEN` (`32`), `LDLR` (`32`), `GAA` (`31`), `F8` (`28`), `RUNX1` (`28`).

Full ≥ 2-star coordinate set `full_2star` (`N = 66,847` rows, matching `PRIMARY_PREDICTOR_DECISION.md`; Phase 5b's note deduplicated 17 duplicate ClinVar IDs to `66,830`: `25,303` P/LP, `41,544` B/LB; `9,121` in VCEP genes — `7,570` computable, `450` excluded, `1,101` advisory):

| Measure | Phase 5b (default chain) | Phase 5c (default + VCEP table) |
|---|---:|---:|
| PP3, any strength, on P/LP | 21,796 (86.1%) | 20,309 (80.3%) |
| BP4, any strength, on B/LB | 32,216 (77.5%) | 31,838 (76.6%) |
| Wrong direction: PP3 on B/LB | 1,601 (3.9%) | 1,544 (3.7%) |
| Wrong direction: BP4 on P/LP | 537 (2.1%) | 514 (2.0%) |
| Moderate or stronger, right direction, P/LP | 18,756 (74.1%) | 14,643 (57.9%) |
| Moderate or stronger, right direction, B/LB | 24,981 (60.1%) | 24,460 (58.9%) |

- `5b → 5c` on `full_2star`: `5,517` of `66,847` rows change (`8.3%`), with `3,414` strength downgrades under VCEP caps and `450` missense exclusions. Deciding tools: REVEL `55,575`, BayesDel noAF `8,902`, none/excluded `2,098`, AlphaMissense `226`, ESM1b `26`, CADD `20`; disagreement note on `1,961` of `54,205` calls.

**Reference & canary variants (full engine)**

| Variant | Old vote | Phase 5c engine |
|---|---|---|
| `FGFR3 p.Gly380Arg` (saved in production) | Likely Pathogenic (`PS1 + PP3 + PM2`) | Likely Pathogenic (`PS1 + PP3 + PM2`, REVEL `0.696` `PP3`) |
| `NAE1 p.Asp116Gly` (reference fixture) | VUS (`PP3`, vote 3 to 1) | VUS (`BP4`, REVEL `0.231`) |
| Canary `PAH p.Arg408Trp` (`PS1 + PM1 + PM2`, REVEL `0.95`) | Likely Pathogenic | **Pathogenic** (`PS1 + PP3_Strong + PM2`; `GN006 v2.1`; `PM1` withheld by cap) |
| Canary `TP53 p.Arg273His`, `BRCA1 p.Cys61Gly` | Likely Pathogenic | **Pathogenic** (`PS1 + PP3_Strong + PM2`, default chain + VCEP advisory notes `GN009 v2.4` / `GN092 v1.2`) |
| `PTEN p.Arg130Gln` (`PS1 + PM2`, REVEL `0.95`) | Likely Pathogenic | Likely Pathogenic (`PS1 + PP3 + PM2`, `GN003 v3.2` Supporting cap) |
| `PALB2 p.Leu100Pro` (`PM2`, REVEL `0.95`, SpliceAI `0.01`) | VUS (`PP3 + PM2`) | VUS (`PM2`, missense excluded per `GN077 v1.3`) |
| `GBA1 p.Asn370Ser` (`PM2`, REVEL `0.002`, SpliceAI `0.45`) | VUS | VUS (`PP3 + PM2`, Walker 2023 splicing `PP3` overrides REVEL `BP4_VeryStrong`) |

**What happens at deploy**

- The browser's saved analyses move to cache version `v4.15`, so no stored vote result is replayed.
- A server-saved analysis that still carries a ClinPred field was classified by the vote; it is recomputed once on its next request. The cached dbNSFP record gets a new key (`ensemble2`), so the recompute cannot read the old record (which still has ClinPred) and save it back.
