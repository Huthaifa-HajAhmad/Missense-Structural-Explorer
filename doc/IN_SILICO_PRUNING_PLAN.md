# In-silico tools: pruning and repair plan

Status: plan, 2026-11-23. Phases 0 to 4 are built (see each phase below); Phases 5 and 6 are not.

## Principle

A tool stays if it does at least one of these:

1. feeds a calibrated rule (ClinGen SVI or a published calibration);
2. adds a distinct method that held-out data shows is useful;
3. covers a blind spot of the main tools;
4. gives a curator useful direction as an **informational** reading — shown, labelled, and never counted.

Rule 4 is why "does not feed ACMG" is not on its own a reason to retire a tool. A tool fails rule 4 when
its reading is wrong, never arrives, or repeats a stronger reading already on the same tab.

## What the code shows today (checked 2026-11-23)

| Fact | Where |
| --- | --- |
| MetaRNN, ClinPred and popEVE vote in the PP3/BP4 count; MetaRNN and ClinPred on a bare 0.5 split | `src/shared/thresholds/concordance.ts:112-145`, `evaluators.ts:105-117` |
| popEVE has no benign cut-point, so it can only add pathogenic votes | `evaluators.ts` `evaluatePopEve` |
| The vote also waits for popEVE before it decides | `server/services/prediction/acmg/criteria.ts:256-275` |
| Eigen, DANN, AlphaGenome and ESM1b are already informational (shown, not counted; Eigen and DANN removed in Phase 2) | `concordance.ts:124-165` |
| ESM1b has ClinGen bands (Bergquist 2025) but does not vote | `calibration.ts:109`, `concordance.ts:160-165` |
| BayesDel is graded on noAF bands, but the parser falls back to `BayesDel_addAF_score` | `predictors/dbnsfp-query.ts:59` |
| On the MyVariant path, an EVE score (0 to 1, higher = harmful) is written into popEVE (negative scale) | `predictors/conservation-orchestrator.ts:610-616` |
| SpliceAI does not enter the ACMG engine at all | `criteria.ts` (no SpliceAI rule) |
| D2 was decided "keep bare Supporting PP3" | `INDEPENDENT_AUDIT_RESPONSE.md` |
| ConSurf scrapes an HTML page from `consurfdb.tau.ac.il`, only for PDB entries, matches residues by raw number, and has a 3 s timeout; from the dev machine the secure connection never completes | `predictors/consurf-resolver.ts` |
| `/biophysics/verify-stability` has no caller in `src/` (route removed in Phase 2) | `server/routes/biophysics/stability.ts` |
| Biohub / Forge tokens now serve only ESMFold (ESM3 and ESMC are retired; all three removed in Phase 3) | `structure/esmfold.ts`, `orchestration/core-identity.ts` |
| All of Us frequencies come from Genos or the VM's local dbNSFP store | `external-api/genos_web.ts:279`, `prediction/dbnsfp_local.ts:65` |

## Phases

Each phase is its own pull request. Tests come first (TDD). Phases that touch hosts, routes or settings
regenerate `doc/code-map/` with `npm run map`.

### Phase 0 — Data bugs (done on `fix/predictor-scale-bugs`; see `RELEASE_NOTE_PREDICTOR_SCALE_FIXES.md`)

1. Drop the `BayesDel_addAF_score` fallback. A missing noAF score stays missing.
2. Retire EVE: drop the EVE → popEVE fallback, `dbnsfp.eve` from the MyVariant field list, `THRESHOLDS.eve`,
   and any EVE label or attribution.
3. Make popEVE informational, used for what it was built for. It stops voting, and the vote no longer waits
   for it. It is shown with its two published cut-points (≤ −4.617 and ≤ −5.056, both on the harmful side)
   as a cross-gene severity reading, and never gives a benign reading. Remove its deprecated, unsourced
   threshold fields and correct the comment at `criteria.ts:260`.

Step 3 can change PP3/BP4 results (approved). Measure the change on the reference variants and write a
release note, as was done for D1.

### Phase 1 — ConSurf replaced by ProtVar residue conservation (done on `feat/protvar-conservation`)

ConSurf never showed a value. Checked from the production VM on 2026-11-23: the page the scraper read
(`consurfdb.tau.ac.il/scripts/chain_selection.php`) returns 404 since the site was rebuilt, and the
resolver turned every failure into a silent null. The rebuilt site's own lookups (`find_chains`,
`get_identical_chain`, `check_seq`) return no chain or HTTP 400 for every entry tried (4HHB, 1UBQ, 1TUP and
others), and the per-chain files on `consurf.tau.ac.il` return 404. No client can get data from it.

Replacement: ProtVar's per-residue conservation (`/ProtVar/api/score/{acc}/{pos}?type=CONSERV`). ProtVar
takes it from VarSite, which scores UniRef90 alignments with ScoreCons (Stephenson et al., NAR 2024;
Valdar 2002), 0 variable to 1 fully conserved. It works for AlphaFold-only proteins and proteins longer than
2,700 residues, needs no PDB chain or residue remapping, and uses a host the app already calls. It is
informational: no cut-points, never counted. An isoform accession is sent unchanged, so ProtVar answers
nothing rather than the canonical residue at the same number. Rejected: the PDBe-KB conservation endpoint
(HTTP 404 for AlphaFold-only proteins), and running Rate4Site locally (too heavy for the VM).

### Phase 2 — Retirements that change no verdict (done on `chore/retire-dbscsnv-dann-eigen`)

- dbscSNV: the parsers, `THRESHOLDS.dbscsnv`, the SpliceMap window, and the Splicing tab section.
- DANN and Eigen: they are already informational, and CADD and phyloP give a stronger reading of the same
  kind.
- The dead `/biophysics/verify-stability` route, `structure/folding-engines.ts` and
  `stability/biophysics-bridge.ts`, after checking there are no callers.

What was done:

- dbscSNV is no longer requested or parsed on any tier, and the Splicing tab, its rail, the splice map and
  the guides no longer show it. SpliceAI (Walker 2023) answers the same question with ClinGen bands.
- DANN and Eigen are no longer parsed on any tier and have no row, evaluator, threshold, guide or
  attribution. The local store and its ingest script keep their `dann` and `eigen` columns; the reader
  ignores them.
- The route is gone (it was public and had no caller), with its two modules, their facades and the
  768-residue stability ceiling in `foldingLimits.ts` that only that engine used.
- Analyses saved before this change still load: the conservation schema drops the unknown fields.
- No PP3/BP4 outcome changes. DANN and Eigen were informational (never counted), and dbscSNV never
  reached the vote or the splicing rule.

Kept, unlike the Gemini review's list: **GERP** (it has calibrated BP4 bands) and the **AlphaGenome AVI row**
(already informational; rule 4).

### Phase 3 — ESMFold and the Biohub credential system (done on `chore/retire-esmfold-biohub`)

Retire the comparison of wild-type and mutant ESMFold folds. Folding models give nearly the same structure
for a single missense change, and ESMFold's 1,024-residue limit does not cover the proteins AlphaFold DB is
missing. This removes `api.esmatlas.com`, `forge.evolutionaryscale.ai`, `biohub.ai`, the Biohub token
settings, token checks and lending, the sidecar `esmfold` router and the `esm` SDK, `foldingLimits.ts`, and
the `structure_esmfold` view. JapanFold stays for Boltz-2.

What was done:

- The ESMFold view, its store state, the folding hook and effects, the `/esmfold` and `/validate-biohub-token`
  routes, `structure/esmfold.ts`, JapanFold's ESMFold-2 call, the sidecar `esmfold` router, its remote-SDK
  helpers and the `esm` package (53 packages fewer in `tools/uv.lock`) are gone.
- The 3D model (`structure3dEvidence.ts`) now has one family: AlphaFold DB or a PDB entry, with the FoldX
  variant. The de novo inputs, engines, citations, Cα-displacement colouring and fit-scope toggle went with it.
- `foldingLimits.ts` is gone; `formatResidueCount` and `readProteinLength` moved to `alphafoldAvailability.ts`.
- The credential system keeps its lending rules with one kind, Tamarind. Saved `biohub` rows in
  `user_secrets` are deleted at startup (`purgeRetiredSecrets`). A browser's stored Biohub token and
  default-structure setting are scrubbed on load.
- The run identity no longer records a Biohub capability, so each saved analysis is recomputed once when
  next opened (owner decision).

### Phase 4 — Genos retired; one dbNSFP record (done on `chore/dbnsfp-source-chain`)

Four parsers for one table (local store → Genos → query.dbnsfp.org → MyVariant) are why the BayesDel and EVE
bugs drifted in. Measured on 2026-11-23:

1. **Genos never answered in production.** The production container has never had `GENOS_EMAIL` or
   `GENOS_ACCESS_KEY` (they are only in the host's `.env`, which the container does not read), so every login
   failed and the request returned nothing. The cache and logs hold no Genos answer. Only the dev machine used it.
   Genos also had no column the local store lacks that the analysis keeps: its SpliceAI is replaced by the live
   Broad lookup, and its All of Us counts were discarded (see step 2).
2. **query.dbnsfp.org returns All of Us** allele count, number and frequency, overall and by ancestry, but no
   heterozygote or homozygote counts. They are not parsed: the analysis drops All of Us counts from every
   conservation source (`withoutUnboundAou`) and keeps only the exact-coordinate local lookup.
3. Genos is retired: the client, its adapter and health check, the self-healer step that copied its cached
   scores over the payload, the parallel request at the start of every analysis, the settings and the credit.
4. Every source fills one record type (`predictors/dbnsfp-scores.ts`), with one parser per source
   (`dbnsfp-query.ts`, `myvariant-dbnsfp.ts`, and the local row), and one function builds the payload from it.
   The query.dbnsfp.org parser now reads every score from the transcript the service selected
   (`function_prediction`, MANE Select), not from the first row of `all_transcripts`, and never mixes rows.

5. Chain rule: query.dbnsfp.org ends the search only when it has REVEL, GERP++ or phyloP. A row with only a
   secondary score (say ESM1b) falls through to MyVariant, so a thin answer is not kept for 14 days.
6. Accepted: a variant that no source has is no longer remembered as "not found" for 5 minutes, so the
   three sources are asked again on the next request. AlphaGenome is asked on a direct call only when some
   source knows the variant. Saved analyses with SpliceAI source `"genos"` read as precomputed dbNSFP.

The dev checkout has no local store, on purpose. Tests use fixtures.

### Phase 5 — Clinical engine

- Retire MetaRNN and ClinPred. Both are trained on clinical labels and overlap the calibrated tools. MetaRNN
  comes back only if a use is found that no calibrated tool covers.
- SpliceAI ≥ 0.20 blocks BP4 for a missense variant (ClinGen splicing guidance, Walker 2023).
- D2 is reopened: one primary calibrated tool, chosen in advance, gives PP3/BP4 at its calibrated strength.
  There is a fixed fallback order when that tool has no score, and the `PP3 + PM1 ≤ Strong` cap becomes
  active. The plurality vote ends.

Every step here changes verdicts: measure on the reference variants and write a release note.

#### How the primary tool is chosen (5a, before any engine code)

Every candidate has known limits, and a vote does not remove them; it only hides them. ClinGen's answer is
to choose one tool in advance, follow a gene's ClinGen expert-panel (VCEP) rule where one exists, and show
the other calibrated tools without changing the strength.

Candidates: the calibrated tools in `calibration.ts` (REVEL, BayesDel noAF, AlphaMissense, ESM1b). Reach in
the published bands:

| Tool | PP3 reaches | BP4 reaches | Known limits to test |
| --- | --- | --- | --- |
| REVEL | Strong | Very Strong | some component tools trained on curated disease sets (circular on ClinVar); one score per transcript |
| BayesDel noAF | Strong | Moderate | ensemble of older scores |
| AlphaMissense | Strong | Moderate | canonical transcript only; reported weaker in disordered regions and for gain-of-function |
| ESM1b | Strong | Moderate | sequence only; long proteins need tiling |

The choice is made by a comparison, with its rules written down before any result is seen:

- Data: ClinVar missense variants with ≥ 2 review stars (NCBI's `variant_summary.txt`), joined by hg38
  chromosome, position and alleles to the scores in the VM's dbNSFP store. The store has no ClinVar
  columns itself. Repeat on variants first classified after each tool's training cut-off, to limit
  circularity.
- Measures: coverage; share of variants that reach each strength; share left without a call; wrong-direction
  calls. Split by ordered vs disordered residues (AlphaFold pLDDT < 50) and by gain-of-function genes.
- Rule: the primary tool is the one with the most correct Moderate-or-stronger calls in both directions and
  no subgroup where its wrong-direction rate exceeds that of the others. The fallback order is the rest,
  ranked the same way.
- Gene override: where a ClinGen VCEP specification names a tool or thresholds, use it (source to be
  checked: the ClinGen criteria-specification registry).
- When the other calibrated tools point the opposite way, show a disagreement note to the curator. The
  strength does not change.

The result is written up as a decision record, like `PROTEIN_LANGUAGE_MODELS_DECISION.md`.

### Phase 6 — Energetics remote engines (approved, after the VM checks)

DynaMut2 and DDMut: remote, never benchmarked here, and they hold results in "Provisional". Tamarind:
paid fallback for ThermoMPNN, which runs locally. Before retiring any of them, check on the VM the local
ThermoMPNN time and how often the remote engines answer at all. DDMut-PPI on Interfaces & PPI stays.

### Residue numbering (in progress)

Measured in the production audit log (`logs/audit.jsonl`, 2026-10-25 to 2026-11-20): 16 of 22 coordinate
translations ended with numbering "unverified", 15 of them because Ensembl VEP failed and VariantValidator
answered. VariantValidator names the RefSeq protein (`NP_…`) but no UniProt accession.

1. **Done (`feat/verified-residue`):** a fallback answer is verified through the RefSeq protein it names,
   with the same resolver typed `NP_…:p.…` input uses. It becomes canonical or renumbered, or stays
   unverified when the check cannot complete. The audit log records `numberingVerifiedBy`.
2. **Done (PR #285):** why VEP failed. The predictor's 8 s Ensembl VEP lookups opened the circuit breaker
   that all `rest.ensembl.org` callers share, so 11 translations on 2026-11-20 skipped VEP in about 1 ms.
   The audit entry now records `vepFailure`. Four earlier fallbacks were VEP using its whole 25 s window.
3. **Done (PR #286):** every analysis audit entry records `numberingBasis` and `numberingVerified`, so the
   unverified rate of protein-notation runs can be measured. Replay of the 14 production protein variants:
   0 unverified.
4. **Awaiting approval:** `VERIFIED_RESIDUE_DESIGN.md`. In order: A, a signed numbering proof from the translate
   route that the analysis routes check (4 days, no visible change); B1, refuse an unverified residue (1 day);
   B2, the full gate with a `withheld` state, only if the two weeks of #286 data show refusal is too blunt
   (about 11 days); C, candidate residues (about 5 weeks).

## Future work

- **StabilityOracle**: it has the weakest band match in the S669/Ssym benchmark
  (`FOLDX_LOCAL_SHELL_BENCH_2026-11-02.md` §9.6). Set up in advance a direct comparison of FoldX +
  ThermoMPNN + RaSP with and without it, before more maintenance goes into it.
