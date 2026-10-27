# Evidence tabs — full audit and resolution (2026-10-27)

Reference variant: **UROD p.Gly318Arg** (NM_000374.5, GRCh38 1-45015346-G-A, P06132).

Round 1 audited the Population data tab end to end (tab → shared model → server → engine → rail) and
swept the other ten tabs for cross-cutting defects. Round 2 resolved every open item and owner decision,
as asked ("make the best decision … without breaking anything").

## The headline finding

The app said UROD p.Gly318Arg was **between the cut-points (0.104%, no criterion)**. gnomAD v4 says:

| Statistic (gnomAD r4, joint) | Value |
|---|---|
| Combined AC / AN | 1,674 / 1,613,998 = 0.104% |
| African-ancestry (afr) AC / AN | 1,272 / 75,018 = **1.70%** |
| FAF95 (grpmax, afr) | **1.62%** |
| Homozygotes | 15 |

The local dbNSFP ingest answered first. It has no ancestry groups, so its combined AF was read as if it
were a grouped maximum. The engine now records **BS1** on FAF95 1.62% (afr). This was checked live: an
e2e proof against the real APIs is in `tests/proof/urod-population.e2e.ts`, with screenshots in
`.e2e/proof/urod/`.

## Engine decisions taken (round 2)

| # | Decision | Why | Where |
|---|---|---|---|
| D1 | **Remote gnomAD is queried beside the local store, and its record wins.** The local row stands in only when gnomAD does not answer within an 8 s grace period. | The local ingest has no ancestry groups and no FAF95. | `core-data-fetcher.ts` |
| D2 | **Grouped maximum over gnomAD v4.1's grpmax groups only** (afr, amr, eas, mid, nfe, sas), from **joint** exome+genome counts. | The old maximum ran over every population row, including `XX`/`XY`, `afr_XY`, `fin`, `asj`, `ami` and `remaining`. | `shared/gnomadGroups.ts`, `gnomad.ts` |
| D3 | **BA1/BS1 read FAF95; PM2 reads the raw grouped maximum.** | ClinGen SVI BA1 guidance (Ghosh 2018) uses the filtering AF, which is the conservative direction for benign evidence. The raw AF is never below FAF95, so it is the conservative direction for pathogenic evidence. One shared rule now serves both engine and tab. | `shared/frequencyRule.ts` |
| D4 | **A gnomAD outage throws.** Only gnomAD's own "Variant not found" is an absence. | `fetchGnomadVariantFrequency` returned `null` for HTTP errors and network failures, the pipeline read `null` as `not_found`, and **`not_found` awards PM2**. | `gnomad.ts` |
| D5 | **PM2's ceiling comes from curated GenCC inheritance before pLI.** Only Definitive, Strong or Moderate records count. Autosomal recessive only gives the higher ceiling (0.1%); any other qualifying mode gives the lower one (0.01%). pLI decides only when no record qualifies. | The Gene–disease tab already held curated MOI. The rule used pLI, which is not inheritance. | `shared/inheritanceBasis.ts`, `evidence-context/curatedInheritance.ts` (snapshot-only read, never triggers an install) |
| D6 | **BS2 is not read from homozygotes on X, Y or the mitochondrion**, or for genes curated only as X-linked, Y-linked or mitochondrial. The engine records why in `unavailable`. | On those chromosomes homozygote counts are not the genotype BS2 needs. | `criteria.ts` |
| D7 | **The hero headline is the frequency the rule read.** The busiest cohort's counts move to a labelled second line. | The screenshot's headline was All of Us counts above a verdict computed from gnomAD. | `ClinicalTab.tsx` |
| D8 | **Regional O/E tone is graded by depth.** The significant-RMC call stays a call. O/E ≥ 0.6 is shown in the warning tone, with the 0.6 mark stated as an app-defined display band. | 0.81 used to be shown in the same pathogenic red as 0.3. | `constraintMetrics.ts` |

**Correction to round 1.** Round 1 suggested BS2 was invalid for UROD. With the curated records in hand,
that is wrong. Homozygous UROD loss causes HEP, under both the AR and the semidominant frames, so 15
healthy gnomAD homozygotes is legitimate BS2 evidence here. Gating BS2 on MOI matters only for
X/Y/mitochondrial genes (D6). BS2's real weak point is penetrance, which no source curates. The rail
now says so.

**Not changed:** BA1/BS1 are still not gated by the `strict-structural`/`conservative` weightings,
while PM2 and BS2 are. This is long-standing engine policy, left as is.

## Open items resolved (round 2)

| Item | Resolution |
|---|---|
| Tab list in five hand-kept copies | One registry, `shared/evidenceTabs.ts`. The sidebar, workspace tab bar, detail-view labels, inspector subtitles (Expression and Species now have one), empty-state titles, research guides, the `AppViews` layout check, screen titles and the live e2e all read it. |
| Inspector routing split across two files; dead `structure` branch; unreachable placeholder | `EvidenceInspector` holds one `Record<EvidenceTabId, rail>` map. A new tab does not compile without a rail. An unknown id falls back to Population, as the tab body does. |
| Title drift ("Predictors", "Residue shifts and pockets", "Population Data") | Titles render `evidenceTab(id).label`. |
| Loading | **Everything loads up front, as requested.** All 11 tabs were already eager. `EvidenceComparison` was the last lazy piece and is now eager in all five tabs, with their dead Suspense fallbacks removed. |
| Species & models slow (spinner in the screenshot) | Its data was already prefetched; the delay was server-side. Phenotypes waited for the full ortholog read, **including the IMPC screen**, then downloaded uPheno, then read species in serial batches of four. Now: one shared ortholog read that phenotypes and organisms share in flight, with uPheno, the Alliance release and every species read concurrent. A test proves phenotypes no longer wait for IMPC. |
| Duplicate help line (chart vs rail) | The chart's readout now says what the readout does. The rail keeps "select a record". |
| Rail PM2 cut-points ("≤ 0.01%" vs "≤ 0.100%") | Two PM2 rows, one per ceiling, with the applied one marked. One cut-point formatter (`formatCutPoint`) everywhere. |
| Hero chip vs BS2 | The BS2 chip states applicability ("BS2 not applicable", with the reason in the title). The rail lists a recorded BS2 under the engine step. |
| No DOI links | Rail Sources link Richards 2015, Ghosh 2018 and Whiffin 2017 by DOI. |
| Rebuilding `buildFrequencyEvidence` per surface | `frequencyEvidenceForResult`, cached per result object (WeakMap); used by the tab and rail. |
| `AppViews` Suspense fallback in slate/teal with a spinner | Tokens, `role="status"`. |
| Cross-cohort upgrade | `cohortDisagreement`: a neutral, non-scoring callout when a cohort is ≥ 3× the rule's input (fires for UROD on the local fallback: All of Us 0.425% = 4.1×). |
| FAF95 upgrade | Done (D3). A FAF95 row in the readings carries the rule dot when it decided. |
| Contract strips unknown keys | `groupMaxAFIsFallback` was never declared in the zod response schema, so the client never saw it. It is declared now, alongside `groupMaxPopulation`, `faf95`, `faf95Population` and `curatedInheritance`. |

## Round 1 fixes (kept)

These were all fixed in round 1: the combined AF named honestly; another cohort's counts no longer
credited to the rule's source; BS2 shown in the rail; hook-order crashes in Population and Predictors;
fake loading chips and the "Ready" message shown on error; sentence-case titles; dead imports.

## Still open

- **Species & models: 0 Ensembl alignments for UROD** in the live run (8 Alliance orthologs were
  returned). Either Compara answered nothing for these taxa or the read lost a race. Not investigated.
- **Query form (outside Evidence): changing the gene symbol keeps the previous gene's UniProt
  accession.** In the proof run, typing UROD over the PAH preset analysed P00439 and failed with a
  wild-type mismatch.
- BS1 still uses a fixed 1% cut-point rather than a disease-specific maximum credible AF (Whiffin 2017).
  The selected disease frame could supply prevalence and penetrance; that needs data the snapshot lacks.
- Three timing-sensitive tests (`admission`, `runner-background-repair`, `ContextualCoverage`) fail
  only under full-suite load and pass in isolation. They predate this work and touch none of it.

## Verification

- `npx tsc --noEmit` clean. `npm run lint` passes: boundaries, focus indicators, verify parity, tsc.
- Full vitest: 5,628 tests, 5,620 passed, 5 skipped. The 3 failures are the timing-sensitive tests
  above; all three pass when run alone (36/36).
- New tests: `frequencyRule.test.ts`, `acmg.frequency.test.ts`, `gnomadFrequency.test.ts`,
  `EvidenceRailRouting.test.tsx`, plus UROD cases in `ClinicalTab.test.tsx`,
  `EvidenceInspector.populationFrequency.test.tsx`, `constraintIntegrity.test.ts`,
  `phenotypesHpa.test.ts` and `core-data-fetcher.test.ts`. Tests that encoded old behaviour were
  restated to the corrected rule: local wins → remote wins; counts headline → rule-input headline;
  "1.0%" → "1%".
- Live e2e proof: `tests/proof/urod-population.e2e.ts`. It shows BS1, FAF95 1.62% (afr), the PM2 input
  1.70%, Regional O/E in the warning tone, and Species & models loaded. It passed on retry; the first
  attempt could not find the sidebar's Species button in time.

## Senior review round (2026-10-27)

Four parallel senior reviewers audited the diffs (shared rule engine, server gnomAD + ACMG wiring,
Evidence tabs + inspector, cross-cutting seams). Two verified the gnomAD v4 mapping against the live
API (UROD 1-45015346-G-A: `joint.faf95.popmax = 0.01618107`, popmax `afr`, joint homozygotes 15 = 7
exome + 8 genome) — the fixtures are the real numbers. No blockers; the findings below were applied:

- **Confirmed absence outranks the local ingest** (`core-data-fetcher.ts`): gnomAD's own
  "Variant not found" is returned as an absence even when a local dbNSFP row exists — the local
  row could otherwise overturn a defensible PM2. A build refusal keeps the stand-in order.
- **The local stand-in is named and caused** (`contracts.ts`, `ServiceFetchStatus`): a new
  `stand-in` status (the classifier still reads its data, as disclosed combined ingest) plus
  `GnomadFrequencyData.standIn: "grace" | "fault"`. The "grace elapsed" and "query failed" shapes
  are no longer one unwitnessed `ok`, and the rail words the cause it actually has instead of
  always claiming "did not answer in time". The swallowed remote error is now logged. The grace
  timer is cleared when the remote wins.
- **"· ceiling applied" only where PM2 was reachable** (`PopulationRail.tsx`): the marker no
  longer renders on BA1/BS1 verdicts, where the engine decided on FAF95 before any ceiling; the
  trace step reads "PM2 ceiling (not reached)" there. Pinned by test.
- **The proof e2e asserts its headline** (`tests/proof/urod-population.e2e.ts`): verdict chip must
  read `BS1` and the hero figure `1.62%` — a regression to "between the cut-points" now fails the
  test instead of only changing a screenshot. The proof suites are excluded from the default
  `e2e run` glob (live network) and run explicitly.
- `withheldByWeighting` mirrors the engine's gate (`conservative` suppresses a supported PM2 only
  when ClinVar is not pathogenic) instead of naming the weighting under a pathogenic ClinVar record.
- `frequencySourceLabel` names the fallback's cause ("no ancestry group reached the allele-number
  floor") instead of the tautological "(fell back to the global maximum)"; the FAF95 subplot row has
  its own `gnomad-faf95` id rather than borrowing the exomes id; the FrequencyScale states ceilings
  in the single cut-point format; the AoU reason chain no longer carries a sentence its branch
  could never render; `loadOrthologCore` re-reports the cached provenance hash instead of hashing
  empty strings; `humaniseAnyRefusal` and `EVIDENCE_TAB_IDS` removed; the rail's group list prints
  from `GRPMAX_GROUPS`; the narrative route reads curated inheritance after variant validation;
  `self-healer.ts` reads `curatedInheritance` from the typed payload. `.clavix/` is ignored.
- New round-trip test: the four gnomAD provenance keys (the set that used to be silently stripped)
  plus `standIn` survive `analyzeVariantResponseSchema`. Rule-level test: FAF95 under both benign
  cut-points with the grouped maximum under the ceiling awards PM2 (the everyday rare case). Engine
  test: BS2 withheld on Y and MT at engine level.
- `scripts/tolerance_benchmark/` kept (reproducibility artifact for the documented negative
  decision) and now carries a README pointing to `doc/RESIDUE_TOLERANCE_DECISION.md`.

## Sources

- Richards S, et al. Genet Med 2015;17:405–424. doi:10.1038/gim.2015.30
- Ghosh R, et al. Updated recommendation for the benign stand-alone ACMG/AMP criterion. Hum Mutat
  2018;39:1525–1530. doi:10.1002/humu.23642
- Whiffin N, et al. Using high-resolution variant frequencies to empower clinical genome
  interpretation. Genet Med 2017;19:1151–1158. doi:10.1038/gim.2017.26
- Pejaver V, et al. Am J Hum Genet 2022;109:2163–2177. doi:10.1016/j.ajhg.2022.10.013 (PP3/BP4 bands,
  confirmed unchanged)
- gnomAD v4.1 grpmax/FAF groups: gnomAD staff, discuss.gnomad.broadinstitute.org/t/gnomad-v4-bottleneck-populations/102
- gnomAD GraphQL API, variant 1-45015346-G-A, dataset gnomad_r4, queried 2026-10-27.
