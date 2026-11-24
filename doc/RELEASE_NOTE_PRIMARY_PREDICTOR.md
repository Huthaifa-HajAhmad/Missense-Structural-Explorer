# Release note: PP3/BP4 from one calibrated tool; MetaRNN and ClinPred retired

Phase 5b of `IN_SILICO_PRUNING_PLAN.md`, following the decision in `PRIMARY_PREDICTOR_DECISION.md`.

**What users will notice**

- **PP3/BP4 comes from one calibrated tool, at its calibrated strength.** The engine reads REVEL, then
  BayesDel noAF, then AlphaMissense, then ESM1b, and the first one with a score gives the criterion at its
  published ClinGen band (Pejaver 2022; Bergquist 2025 for AlphaMissense and ESM1b). PP3 can now be
  Moderate or Strong, and BP4 Moderate, Strong or Very Strong. Before, a plurality vote of up to six tools
  gave PP3 or BP4 at Supporting only.
- **A score between the bands gives no criterion.** If the first tool with a score is indeterminate, there is
  no PP3 or BP4; the next tool is not asked.
- **A disagreement note.** When another of the four calibrated tools points the other way, the reason says
  so. It never changes the strength.
- **SpliceAI can stop BP4.** BP4 is withheld when SpliceAI's largest change is 0.20 or more (Walker 2023),
  while SpliceAI has not finished (re-run to get it), or when the input maps to several nucleotide changes
  or has no verified GRCh38 locus, so splicing was not checked. When SpliceAI answered with no score, BP4
  stands with a note to check splicing by hand.
- **PP3 + PM1 is capped at Strong.** PM1 is withheld when PP3 alone is Strong. The cap was already built and
  tested; it now applies because PP3 can be Strong.
- **BP4 Very Strong counts as −8 points** (Tavtigian 2020), which on its own gives Benign. It is labelled
  "Very strong", not "Stand-alone"; only BA1 stands alone.
- **Benign tiers now subtract pathogenic evidence.** Calibrated BP4 reaches Moderate and stronger, so a
  benign tier needs the benign points to clear their threshold after the pathogenic points are subtracted
  (net 2 for Likely Benign, net 7 for Benign). Without it, PS1 + PM2 + BP4 Moderate (+5 against −2) was
  Likely Benign; it is now VUS. A Strong or Very Strong pathogenic criterion (PVS1, PS1, PP3 Strong…)
  against any benign tier is VUS whatever the net, so one predictor score never turns PS1 Likely Benign.
  With no pathogenic evidence nothing changes. One older combination moves too: PS1 + BS1 goes from Likely
  Benign to VUS.
- **A failed dbNSFP lookup withholds PP3/BP4.** When the dbNSFP scores timed out or failed, REVEL and
  BayesDel are unknown, not missing, so the engine no longer falls through to AlphaMissense; re-run to get
  the call.
- **MetaRNN and ClinPred are gone.** Both are trained on ClinVar labels and take gnomAD allele frequency as
  input, so they were partly circular for variants already in ClinVar and overlapped PM2/BS1. CADD is still
  shown with its calibrated band, as a genome-wide model that does not set PP3/BP4.
- **Predictors tab.** "Voting tools" becomes "Calibrated tools, in order". The vote bar is replaced by a bar
  of the four tools in order with the one that answered marked, and the "calibrated reference" row by the
  answering tool on its own ruler. The rail's rule trace, the Insights lane, the Splicing tab and the report
  say the same.
- **Not yet:** ClinGen expert-panel (VCEP) gene rules. Every gene uses the default order until the audited
  VCEP table lands in its own change.

**Measured effect on PP3/BP4 (ClinVar ≥ 2-star missense, the Phase 5a set)**

Run on the VM in its own container on 2026-11-24, against the read-only dbNSFP 5.4a store. The old rule is
the deployed engine's own code (main at the PR #290 merge); the new rule is this branch's
`decidePrimaryInsilico`. ClinVar `variant_summary.txt.gz` is the same release as the benchmark (458,570,768
bytes), giving the same 66,847 variants. 17 ClinVar IDs that occur at two coordinates were counted once
(66,830). SpliceAI is not in the store, so its block on BP4 is not applied here: the BP4 figures are an upper
bound.

Held-out cohort `post_2023` (4,857 variants classified after every tool's training: 2,687 P/LP, 2,170 B/LB):

| Measure | Old vote (Supporting only) | New rule |
|---|---:|---:|
| PP3, any strength, on P/LP | 96.8% | 89.1% |
| BP4, any strength, on B/LB | 86.5% | 71.5% |
| Wrong direction: PP3 on B/LB | 9.1% | 5.8% |
| Wrong direction: BP4 on P/LP | 2.0% | 2.0% |
| Moderate or stronger, right direction, P/LP | 0% | 77.7% |
| Moderate or stronger, right direction, B/LB | 0% | 54.4% |

- The direction changes for 747 of 4,857 variants (15.4%). Most move from a vote call to no call: 289 PP3
  and 367 BP4 now sit in REVEL's indeterminate range. 24 go PP3 → BP4 and 15 BP4 → PP3.
- New strengths: PP3 Strong 1,043, PP3 Moderate 1,099, PP3 377, none 732, BP4 405, BP4 Moderate 1,155,
  BP4 Strong 44, BP4 Very Strong 2.
- Answered by REVEL 4,088, BayesDel noAF 759, AlphaMissense 5; no tool 5.
- The disagreement note appears on 187 of 4,125 calls.

On the full set (66,830) the pattern holds: wrong-direction PP3 on B/LB 4.0% → 3.9%, BP4 on P/LP 2.6% →
2.1%, Moderate-or-stronger correct calls 0% → 74.1% (P/LP) and 60.1% (B/LB); 16.0% change direction, mostly
to no call. The old vote's higher reach comes largely from MetaRNN and ClinPred, which were trained on these
ClinVar labels.

**Reference variants (full verdict, old and new engine, same inputs)**

| Variant | Old | New |
|---|---|---|
| FGFR3 p.Gly380Arg (the one analysis saved in production) | Likely Pathogenic: PS1 + PP3 + PM2 (vote 5/5) | Likely Pathogenic: PS1 + PP3 + PM2 (REVEL 0.696, PP3) |
| NAE1 p.Asp116Gly (reference fixture) | VUS: PP3 (vote 3 to 1) | VUS: BP4 (REVEL 0.231) |
| Canary PAH p.Arg408Trp, TP53 p.Arg273His, BRCA1 p.Cys61Gly (synthetic inputs) | Likely Pathogenic | **Pathogenic**: REVEL ≥ 0.932 gives PP3 Strong; PS1 + PP3 Strong is two Strong. PM1 is withheld by the cap. All three are Pathogenic in ClinVar. |

**What happens at deploy**

- The browser's saved analyses move to cache version `v4.15`, so no stored vote result is replayed.
- A server-saved analysis that still carries a ClinPred field was classified by the vote; it is recomputed
  once on its next request. The cached dbNSFP record gets a new key (`ensemble2`), so the recompute cannot
  read the old record (which still has ClinPred) and save it back. The new analysis has no such field, so it
  stays cached.
