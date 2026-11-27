# ClinGen expert-panel comparison

This is a comparison of captured automated evidence, not a clinical reclassification. Categories: **(a)** expected by design / out of scope; **(b)** input-limited; **(c)** real discrepancy requiring owner review. A missing criterion is not a finding that its requirements were disproved. All queries used the protein notation in panel.json; a resolved allele is recorded only where the payload establishes it.

Release Gate #2 remains open for an independent second review of TP53 K132N PS1, the TP53 P295S source-strength inconsistency, and interpretation of alternate-rule PP2 strengths. No second reviewer sign-off is claimed here.

Sources: captured raw/<ID>/api/*analyze-variant-stream.json and *structural.json, tabs/predictors__comparison.txt, tabs/function__hotspots.txt, tabs/clinical__comparison.txt and views/view__insights.txt; assertion metadata and panel evidence from raw/erepo/erepo.tsv. These are the saved audit inputs, not newly fetched current assertions.

The engine can evaluate PP3/BP4, generic BA1 and PM2, a restricted UniProt-site PM1, regional-constraint PP2, and ClinVar-comparison PS1 (plus null/indel rules irrelevant to these missense cases). PM5, BP1, BS1 and BS2 are not automatically counted; functional assays, segregation, phenotype, case enrichment and co-occurrence evidence are outside this calculation. Gene-specific computational rules do not imply that the engine implements all VCEP rules for that gene/condition.

PM2 is stored as `PM2` but explicitly applied at Supporting strength; its rows below are strength agreements. TP53 K132N PP3 has the same strength as the panel but uses REVEL 0.895 under general Pejaver bands, not the panel's BayesDel 0.3138 plus Align-GVGD C65. Captured BayesDel 0.476 is not the predictor counted. The source and rule are not interchangeable.

## Allele and assertion identity

GRCh38 coordinates below are those in the erepo HGVS column. Dates are approval / publication. The assertion links in erepo.tsv identify the condition-specific source.

| Case | erepo transcript allele; GRCh38 | App resolved GRCh38 allele | Condition; VCEP; dates |
|---|---|---|---|
| PAH_R261L | NM_000277.2(PAH):c.782G>T (p.Arg261Leu); NC_000012.12:g.102852875C>A | 12-102852875-C-A | phenylketonuria; [Phenylketonuria VCEP](https://erepo.genome.network/evrepo/ui/classification/CA386295444/MONDO:0009861/006); 2024-11-17 / 2024-11-18 |
| TP53_K132N | NM_000546.6(TP53):c.396G>C (p.Lys132Asn); NC_000017.11:g.7675216C>G | unresolved; ambiguous candidates | Li-Fraumeni syndrome; [TP53 VCEP](https://erepo.genome.network/evrepo/ui/classification/CA16603044/MONDO:0018875/009); 2026-09-22 / 2026-09-22 |
| TP53_P295S | NM_000546.6(TP53):c.883C>T (p.Pro295Ser); NC_000017.11:g.7673737G>A | 17-7673737-G-A | Li-Fraumeni syndrome; [TP53 VCEP](https://erepo.genome.network/evrepo/ui/classification/CA397836496/MONDO:0018875/009); 2026-08-06 / 2026-09-22 |
| MYH7_R787H | NM_000257.3(MYH7):c.2360G>A (p.Arg787His); NC_000014.9:g.23425345C>T | 14-23425345-C-T | hypertrophic cardiomyopathy; [Cardiomyopathy VCEP](https://erepo.genome.network/evrepo/ui/classification/CA012239/MONDO:0005045/002); 2025-11-14 / 2025-11-14 |
| PTEN_A79T | NM_000314.8(PTEN):c.235G>A (p.Ala79Thr); NC_000010.11:g.87931071G>A | 10-87931071-G-A | PTEN hamartoma tumor syndrome; [PTEN VCEP](https://erepo.genome.network/evrepo/ui/classification/CA000358/MONDO:0017623/003); 2026-02-18 / 2026-06-09 |
| LDLR_T726I | NM_000527.5(LDLR):c.2177C>T (p.Thr726Ile); NC_000019.10:g.11123210C>T | 19-11123210-C-T | hypercholesterolemia, familial; [Familial Hypercholesterolemia VCEP](https://erepo.genome.network/evrepo/ui/classification/CA023649/MONDO:0007750/013); 2022-05-24 / 2022-12-24 |
| GCK_R377H | NM_000162.5(GCK):c.1130G>A (p.Arg377His); NC_000007.14:g.44145620C>T | 7-44145620-C-T | monogenic diabetes; [Monogenic Diabetes VCEP](https://erepo.genome.network/evrepo/ui/classification/CA213715/MONDO:0015967/086); 2026-10-29 / 2026-10-29 |
| BRCA2_N277K | NM_000059.4(BRCA2):c.831T>G (p.Asn277Lys); NC_000013.11:g.32332309T>G | unresolved; T>G / T>A candidates | BRCA2-related cancer predisposition; [ENIGMA BRCA1 and BRCA2 VCEP](https://erepo.genome.network/evrepo/ui/classification/CA025568/MONDO:0012933/097); 2024-06-12 / 2024-06-12 |

Only the six uniquely resolved cases match the panel genomic allele directly. TP53 K132N and BRCA2 N277K are protein-level comparisons until the specified nucleotide allele is replayed. MYH7 also had an initial numbering-proof failure before subsequent API results; see capture-diagnostics.md.

Compared panel criteria include both implemented and out-of-scope rules. 'app misses' means the panel applied it and the app did not; the reason column explains whether the engine could evaluate that rule.
Totals: agree 6, agree (neither) 20, app extra 1, app misses 14, app only (panel silent) 1, strength differs 1


## PAH_R261L — panel: Likely Pathogenic
App engine criteria: PP3_Strong, PM2

| Criterion | Panel | App | Result | Reason (lead) |
|---|---|---|---|---|
| PP3 | PP3_Strong | PP3_Strong | agree |  |
| PM2 | PM2_Supporting | PM2 | agree |  |
| PM5 | PM5 | not applied | app misses | (a) Out of scope: the engine has no PM5 evaluation. The panel cites pathogenic Arg261Gln/Gly/Pro; same-residue evidence is not computed. |

## TP53_K132N — panel: Pathogenic
App engine criteria: PS1, PP3_Moderate

| Criterion | Panel | App | Result | Reason (lead) |
|---|---|---|---|---|
| PP3 | PP3_Moderate | PP3_Moderate | agree |  |
| BP4 | not met | not applied | agree (neither) |  |
| PM2 | PM2_Supporting | not applied | app misses | (b) Input-limited: p.Lys132Asn did not establish a unique GRCh38 allele. VEP could not determine the nucleotide change; ProtVar and MyVariant candidate sets disagreed. gnomadFrequency is null and status unsupported-build withholds PM2. This is not evidence that the panel allele is present in gnomAD. |
| PM1 | PM1 | not applied | app misses | (a) Out of scope: app PM1 tests experimentally supported UniProt active/binding/metal/disulfide sites; it does not evaluate cancerhotspots.org somatic counts. Panel cites 30 somatic occurrences (threshold 10). No PM1 cap withholding is recorded here. |
| BS1 | not met | not applied | agree (neither) |  |
| BA1 | not met | not applied | agree (neither) |  |
| PM5 | not met | not applied | agree (neither) |  |
| PS1 | not met | PS1 | app extra | (c) Owner review required: captured clinvar.hasOtherPathogenicVariantSameAA=true directly triggers PS1. ClinVar matching compares different c. titles among protein matches, but the input has no resolved nucleotide allele; the asserted different nucleotide change is not established for this query. Panel explicitly records PS1 not met. Repeat with c.396G>C and verify comparator identity before release. |

## TP53_P295S — panel: Likely Benign
App engine criteria: PM2

| Criterion | Panel | App | Result | Reason (lead) |
|---|---|---|---|---|
| PP3 | not met | not applied | agree (neither) |  |
| BP4 | BP4 | not applied | app misses | (a) Expected fallback, not panel-rule agreement: TP53 requires BayesDel plus Align-GVGD; Align-GVGD is not computed, so REVEL 0.308 is primary and neutral in general bands. BayesDel -0.2078 does not override it. SpliceAI also timed out, but the captured primary reason is the neutral REVEL band, not a BP4 splice hold. Panel summary specifies BP4_Moderate although its structured code is BP4; owner must reconcile source strength. |
| PM2 | PM2_Supporting | PM2 | agree |  |
| PM1 | not met | not applied | agree (neither) |  |
| BS1 | not met | not applied | agree (neither) |  |
| BA1 | not met | not applied | agree (neither) |  |
| PM5 | not met | not applied | agree (neither) |  |
| PS1 | not met | not applied | agree (neither) |  |

## MYH7_R787H — panel: Benign
App engine criteria: none

| Criterion | Panel | App | Result | Reason (lead) |
|---|---|---|---|---|
| PP3 | not met | not applied | agree (neither) |  |
| BP4 | not met | not applied | agree (neither) |  |
| PM2 | not met | not applied | agree (neither) |  |
| PM1 | PM1 | not applied | app misses | (a) Out of scope: panel uses a statistically enriched disease-associated region (Walsh 2019), not the experimentally evidenced UniProt site rule used by app PM1. No PM1 withholding is recorded. |
| BS1 | not met | not applied | agree (neither) |  |
| BA1 | BA1 | not applied | app misses | (a) Expected scope difference: gnomAD r4 FAF95 0.00194684 = 0.194684% is below generic app BA1 >5%. Panel applies cardiomyopathy-specific BA1 (summary cites 0.2% South Asian FAF95). The app does not implement that condition-specific population cutoff. |
| PM5 | not met | not applied | agree (neither) |  |

## PTEN_A79T — panel: Benign
App engine criteria: BP4, PP2_Moderate

| Criterion | Panel | App | Result | Reason (lead) |
|---|---|---|---|---|
| BP4 | not stated | BP4 | app only (panel silent) | (a) Expected additional evidence, not a contradiction: panel is silent on BP4. App PTEN GN003 v3.2 REVEL <0.5 rule counts REVEL 0.485 at Supporting. Silence does not mean not met. |
| BA1 | BA1 | not applied | app misses | (a) Expected scope difference: captured FAF95 0.00090022 = 0.090022%, exactly the figure cited by the panel, is below generic app BA1 >5%. PTEN-specific population criteria are not implemented. |
| PP2 | PP2 | PP2_Moderate | strength differs | (a) Different rule: app uses regional gnomAD v4.1.1 observed/expected 0.27, meeting the <=0.36 Moderate calibration (Chao 2026 preprint). Panel PP2 is Supporting from its curated PTEN disease mechanism, not that regional calibration. Not evidence of equivalent strengths. |
| BS2 | BS2_Supporting | not applied | app misses | (a) Out of scope: app does not count BS2 automatically because gnomAD does not establish unaffected status. Panel uses an internal documented healthy/PHTS-unaffected homozygote; captured gnomAD has zero homozygotes. These are different sources. |

## LDLR_T726I — panel: Benign
App engine criteria: none

| Criterion | Panel | App | Result | Reason (lead) |
|---|---|---|---|---|
| PP3 | not met | not applied | agree (neither) |  |
| BP4 | BP4 | not applied | app misses | (b) Input-limited: REVEL is null, so LDLR GN013 v1.2 required tools did not score this variant; general BayesDel/AlphaMissense/ESM1b do not replace its REVEL rule. SpliceAI max 0.012 is available, so this is not a splicing hold. Panel used REVEL 0.454 plus its splicing assessment. |
| PM2 | not met | not applied | agree (neither) |  |
| PM1 | not met | not applied | agree (neither) |  |
| BS1 | not met | not applied | agree (neither) |  |
| BA1 | BA1 | not applied | app misses | (a) Expected scope difference: r4 FAF95 0.00829666 = 0.829666% is below generic app BA1 >5%; panel applies LDLR-specific BA1 using v2.1.1 FAF 0.8138%. Dataset differences do not explain the missing criterion; the generic cutoff does. |
| PM5 | not met | not applied | agree (neither) |  |

## GCK_R377H — panel: Pathogenic
App engine criteria: PP3, PM2

| Criterion | Panel | App | Result | Reason (lead) |
|---|---|---|---|---|
| PP3 | PP3 | PP3 | agree |  |
| PM2 | PM2_Supporting | PM2 | agree |  |
| PP2 | PP2 | not applied | app misses | (a) Different rule: panel defines GCK as a missense disease gene. App requires a calibrated qualifying regional observed/expected interval; displayed regional O/E 0.71 does not meet its Supporting <=0.59 or Moderate <=0.36 rule, so no PP2 is counted. |
| PM5 | PM5_Strong | not applied | app misses | (a) Out of scope: no PM5 evaluator exists. Panel assigns Strong from pathogenic Arg377Cys and Arg377Ser; app does not compute same-residue substitutions. |

## BRCA2_N277K — panel: Benign
App engine criteria: none

| Criterion | Panel | App | Result | Reason (lead) |
|---|---|---|---|---|
| BS1 | BS1_Supporting | not applied | app misses | (a), with (b): BS1 is not automatically applied app-wide without a condition-specific maximum credible allele frequency. Panel uses non-cancer/non-founder frequency and ENIGMA Supporting thresholds. Protein query also has T>G/T>A candidates that disagree (no criterion versus PM2), preventing an allele-specific frequency criterion. |
| BP1 | BP1_Strong | not applied | app misses | (a) Out of scope: BP1 is not applied automatically. Panel uses location outside a key functional domain plus SpliceAI 0; app does not implement ENIGMA BP1_Strong. Protein-only ambiguity additionally prevents allele-specific splicing. |
