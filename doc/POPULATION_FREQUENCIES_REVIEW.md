# Population Frequencies — multi-dimensional code review and remediation

Revision `1a61b2f`, working tree carrying the change under review plus other agents' concurrent edits.
Bound to that revision and dirty state; re-verify before quoting anything here.

## 1. What was reviewed

A redesign of the Population Frequencies evidence tab (sidebar id `clinical`), plus the shared module
it renders from. Four reviewers worked independently, one per dimension, each in its own sandbox with
its own probes.

| # | Dimension | Reviewer verdict | Findings |
| --- | --- | --- | --- |
| A | Scientific correctness & data semantics | **Block** | 4 HIGH, 2 MEDIUM, 1 LOW |
| B | UI, typography & design system (`better-ui`) | Approve | 0 HIGH, 12 MEDIUM, 4 LOW |
| C | Test quality & verification integrity (`verification-integrity`) | **Block** | 3 HIGH, 3 MEDIUM, 5 LOW |
| D | Integration, regression & concurrency hygiene | **Block** | 2 HIGH, 4 MEDIUM, 4 LOW |

26 distinct root causes; all are addressed below except the two listed in §6. Two reviewers
independently found the same two defects (the `groupMaxAF` divergence, and the asserted absence from a
missing status), which is the strongest signal in the set.

## 2. The defects that mattered

### 2.1 The classifier awarded PM2 for a variant no database had been asked about

`gnomAD r4` answers by numeric position and serves GRCh38 only. The gate in `core-data-fetcher.ts`
refuses any other coordinate **before querying**, and returned `null` without setting a flag — so
`serviceStatus.gnomadFrequency` became `not_found`, the value a genuine confirmed absence carries.

That is not only a display problem, which is how it was first reported. `criteria.ts` treats
`not_found` as "answered and holds no record", so **the engine itself** set a zero frequency and
emitted **PM2** — pathogenic-frequency support — into `acmgCriteria`, the verdict and the report. A
client-only fix would have left the screen showing the engine's PM2 chip beside a "withheld"
statement, i.e. would have created a new contradiction rather than removing one.

Fixed at the source: `ServiceFetchStatus` gains `unsupported-build`; the gate records it; the
classifier withholds on it and names the reason in `partialEvidence.unavailable`; the client
recognises both the status and the coordinate's build.

### 2.2 The screen showed a criterion the engine had withheld

PM2 is gated on the user-selectable ACMG weighting (`criteria.ts:77`, `:315`): `strict-structural`
suppresses it, and `conservative` suppresses it when ClinVar is not pathogenic. The module recomputed
the criterion from the frequency alone. Reviewer A proved it differentially — identical input, engine
`[NONE]`, module `PM2 af=1e-5`.

Now `criterion` is what the frequency supports and `applied` is what the engine recorded, read from
`ruleBasedInsights.acmgCriteria`. The chip shows the engine's verdict; a suppression is stated.

### 2.3 `groupMaxAF: undefined` silently dropped PM2 in the engine

`groupMaxAF` is `z.number().nullable().optional()`, and persisted payloads predate the key. The engine
tested `!== null`, which is **true** for `undefined`, so `maxFreq` became `undefined`, every
comparison evaluated false, and PM2 was dropped — while `hasFreq` stayed true, so nothing reported
that either. The new module tested both and therefore disagreed with the engine. Both sides now read
a non-finite or absent magnitude as "no reading".

### 2.4 A false guarantee written during this change

The module's header claimed both surfaces render from one object "so they cannot state different
frequencies". The rail never imported the module (grep over `src/`). Fixed by wiring the rail to the
same object — including the release name and this run's reading — not by deleting the sentence.

## 3. Remediation

- **One object, two surfaces.** The rail builds the same `FrequencyEvidence` the column does.
- **Absence is classified, and the order is the design:** build gate → outage → in flight → grouped
  max → global max → confirmed absence → ClinVar submissions → unknown. Every missing value routes
  through `resolveEvidenceAvailability`; a status the module cannot read claims neither presence nor
  absence.
- **Counts are never deleted because a frequency is missing.** All of Us reports AC/AN/Het/Hom
  independently and is kept unless all four are null; the first revision of this change printed none
  of them.
- **Non-finite and unparseable values are not magnitudes.** `finiteNumber` in the engine and `finite`
  in the module; an unparseable ClinVar value no longer manufactures PM2.
- **ClinVar carries its own status**, so an outage cannot render as "no submitter has classified it".
- **Colour and type.** One tone per state (amber means a run fault only); the governing frequency is
  the largest number on screen and tabular; the card-title rank is the project's own primitive; the
  rail's 37 off-scale sizes (9 / 9.5 / 10.5px) are snapped onto declared tiers and its criterion
  codes moved off the raw palette onto theme tokens.
- **Other surfaces aligned:** `narrative.ts` (report) now renders `buildFrequencyEvidence` instead of
  asserting absence whenever `exomeAF` was falsy — which it did on a **timeout**, and for
  genomes-only variants; `reportStatus.ts` derives `hasFrequency` from the module rather than
  `exomeAF`/`genomeAF`; `provenance.ts` "v4.1.0" → `"r4 (GraphQL API)"`; `ClinicalInsightsCard.tsx`
  stops labelling ClinVar submissions as gnomAD and uses the shared formatter; `LiveTelemetryPanel`
  "E-Fetch Live" → "E-utilities live"; `biophysicalService` "v4.0" → "r4"; `EvidenceSidebar`
  "Databases" → "Population Frequencies".

## 4. Verification

| Layer | Command | Result |
| --- | --- | --- |
| Types (whole repo) | `npx tsc --noEmit` | 0 errors |
| Boundaries | `node scripts/check-boundaries.ts` | 0 violations |
| Real suite | `npx vitest run`, 13 files | **135 passed / 135** |
| Unit harness | `node scratch/verify-frequency-evidence.mjs` | 31 assertions pass |
| Unit negative control | harness vs. 5-mutation module | fails exactly 7 load-bearing checks |
| Render harness | `build-render-tree.mjs && render-harness.mjs` | 21 assertions pass, 4 negative controls |
| Render negative control | harness vs. `git show HEAD:` surfaces | pre-fix tab *does* render "Absent from gnomAD population database" on a timeout; pre-fix rail *does* render "MANE Select (Gold)", "E-Fetch API", "MAF > 0.1%", "v4.0.0" |

Three defects were found by running things rather than by reading: the real suite caught
`getByText("5.50e-6")` matching twice; the render harness caught a second false-mechanism badge and a
ClinVar wording regression; and the negative-control script **refused to run** when its mutation anchor
went stale after the build-gate rewrite, instead of silently producing a vacuous control.

### An incident in this change's own tooling

Snapping the rail's type scale used a PowerShell `Get-Content -Raw | Set-Content` round trip, which
read the file's UTF-8 bytes as cp1252 and re-encoded them — double-encoding every non-ASCII character
(`≤` → `â‰¤`) and adding a BOM. It was caught by re-reading the file, not by typechecking (the text is
valid TypeScript). Repaired with `scratch/repair-mojibake.mjs`, which reverses the cp1252 mapping
(`latin1` does not work — it cannot represent U+2030), refuses to write unless the result is clean, and
verifies the non-ASCII inventory against `HEAD` (Δ ×4, ─ ×4, – ×2, · ×8, ⚠ ×1 all preserved). All 19
changed files were then audited for mojibake and BOM: clean.

Not verified: browser hover/focus/zoom, dark-mode appearance, computed contrast ratios, and upstream
All-of-Us column semantics (whether `aou_an` is a callable allele number).

## 5. What the four reviewers found that source reading had not

- the engine's PM2 award on a gate refusal, and on an absent `groupMaxAF`;
- an unparseable ClinVar value manufacturing PM2;
- a ClinVar outage rendering as a clinical negative;
- the report asserting absence on a timeout;
- the silent loss of All-of-Us counts;
- 1px-apart competing header ranks, and the headline number being the smallest on screen;
- `getAllByText` vs `assert.match` drift between the harness and the committed tests.

## 6. Open

| Severity | Location | Item |
| --- | --- | --- |
| LOW | `PredictorSpecialistPanels.tsx:379`, `AlphaGenomeTab.tsx` | Unrelated false-cause copy tracked by `ALPHAGENOME_STANDBY_RCA_AND_UI_AUDIT.md`; out of scope here. |
| LOW | `self-healer.ts:80` | Retries a gnomAD frequency fetch on `timeout`/`error` but not on `unsupported-build`. Correct as it stands — a build refusal is not transient — but worth a comment if the liftover ever makes it retryable. |

## 7. Follow-on reconciliation of PR #23 — exact allele before population evidence

Scope: branch `fix/locus-outcome-reconciliation`, based on `5520daf`; isolated worktree so concurrent deployment changes were not touched. [PR #23](https://github.com/Huthaifa-HajAhmad/Missense-Structural-Explorer/pull/23) repaired outage recovery but did not fully distinguish allele ambiguity from provider failure. Its [reported Actions run](https://github.com/Huthaifa-HajAhmad/Missense-Structural-Explorer/actions/runs/36902066865) passing did not cover these counterexamples.

### Findings and decisions

| Severity | Evidence / defect | Correction |
| --- | --- | --- |
| HIGH | `NM_005072.5:p.Gln867His` has both `c.2601G>T` and `c.2601G>C`; one observed database hit does not establish a unique nucleotide allele. | Explicit `ambiguous-allele` outcome; retain protein AlphaMissense, withhold arbitrary allele/CADD. Shared standard-code proof still applies during an outage; false never proves uniqueness. |
| HIGH | An unrelated MANE isoform error could veto a healthy canonical-numbering target, or its success could claim canonical numbering. | Canonical-aligned target authority; retain RefSeq authority when MANE Ensembl equals canonical. |
| HIGH | Truncated or contradictory MyVariant totals could make one returned hit appear unique. | Require a valid nonnegative integer total and complete retrieval before promotion. |
| HIGH | Retryable null-locus results bypassed the predictor cache's GRCh37-only guard and stayed cached for 14 days. | Symmetric cache read/write guards, contextual ambiguity checks, and one-time old fallback policy migration. |
| HIGH | Local gnomAD/AoU counts could bypass the predictor gate, select the first protein row/ALT, or manufacture zero from missing AC. | Exact verified GRCh38 chromosome/position/REF/ALT plus protein match; no first-row fallback; unknown AC stays null; empty/invalid local evidence does not suppress remote lookup. |
| HIGH | Malformed counts could manufacture rare AF; diploid correlation would reject legitimate hemizygous counts. | Finite nonnegative safe integers, AC≤AN, defensible carrier bounds; exact diploid genotype correlation only on autosomes. |
| HIGH | Conservation/Genos rows and self-healing could restore protein-selected AoU counts even when a different allele was verified. | Only exact-coordinate local AoU is retained; healing cannot import unbound Genos counts or unusable predictor caches. Legacy local population bundles migrate via additive metadata generation. |
| HIGH | The persisted outer key is gene/protein/weighting: a new explicit allele could reuse a cached ambiguity or another ALT. | Compare requested and cached verified allele identity; a prior coordinate choice cannot resolve a new intrinsically ambiguous protein-only request. |
| MEDIUM | Definitive ambiguity displayed provider error/retry; unknown AoU provenance implied a queried local table. | Shared typed cause/action across card, rail, header and workflow; original-allele entry preserves input and never auto-submits a candidate; unknown source is not reported as local or queried. |
| MEDIUM | The longer recovery button crowded constraint text and overflowed a narrow banner. | Prioritise actionable recovery, compact header copy, retain Details, and place the narrow card action on its own ≥44px-high row. |

**Clinical policy decision:** no threshold, criterion strength, or voting-membership change. Criteria based on unbound/invalid counts may disappear intentionally; withholding is not zero or benign evidence. Missing local tables/incomplete retrieval never establish population absence. Protein-only evidence remains independently available.

**Reference variant:** Q867H no longer selects forward GRCh38 `16:67946177 C>A` or `C>G` from a protein-only request. It asks for the source report's nucleotide allele. A verified explicitly supplied allele can query the correct population record and escapes a cached protein ambiguity. Nothing is auto-selected or auto-submitted.

### Verification and limits

- Full Vitest coverage run: **3,194 passed, 5 skipped, 248 files passed / 2 skipped**; configured coverage gates passed. Windows run used an isolated TEMP directory and one worker to avoid shared SQLite fixture locks; no production state was changed.
- Whole-repository lint, TypeScript, boundary, focus and verify-parity checks passed. Final integrated cache/healer/policy rerun: **54 tests passed**, including 8 additional sync/stream allele-context regressions after the full-suite run.
- Production frontend built successfully. Server and both worker bundles compiled successfully in memory. The all-artifact build hit a native Windows disk-write denial for server output: the permission diagnostic found the missing output path, changed no permissions, and made no rollback necessary. This is **not** a completed disk-artifact build or deployment.
- **116 browser geometry assertions passed**, covering recovery at 1440/1200/1000/820/375px and Population card/lineage in light/dark narrow fixtures, with production utility classes. Functional-domain geometry passed separately. Synthetic layout fixtures are not live clinical results.
- No Linux mirror, physical-device testing, production deployment, or global biological re-calibration was performed.
- Follow-up outside this population reconciliation: stored protein-selected local/Genos splice scores still need a separate nucleotide-provenance audit; population guards do not certify them. Also retain the earlier upstream AoU semantic/calibration caveats in §4.

Implementation entry points: [locus policy](../src/shared/locusResolution.ts), [genetic-code proof](../src/shared/proteinAlleleIdentity.ts), [verified identity](../server/services/prediction/predictors/allele-identity.ts), [population producer](../server/services/external-api/core-data-fetcher.ts), [cache healing](../server/services/orchestration/self-healer.ts), [API contract](API.md), [browser regression harness](../tools/header-geometry/main.tsx).

Primary sources: [Ensembl VEP HGVS endpoint](https://rest.ensembl.org/documentation/info/vep_hgvs_get), [MyVariant query contract](https://docs.myvariant.info/en/latest/doc/variant_query_service.html), and [NCBI genetic code Table 1](https://www.ncbi.nlm.nih.gov/Taxonomy/Utils/wprintgc.cgi#SG1) / [printable table v4.6](https://ftp.ncbi.nlm.nih.gov/entrez/misc/data/gc.prt). No new calibrated cut-point was introduced, so existing threshold paper/DOI references remain governing rather than being replaced by API documentation.


## 9 October 2026 ? visualization workspace

This tab now uses the shared comparison/source-record workspace and a pinned-reading
inspector. Scientific rules are unchanged. The implementation, presentation corrections,
reference contracts and validation are recorded in [Evidence workspace review](EVIDENCE_WORKSPACE_REVIEW.md).
