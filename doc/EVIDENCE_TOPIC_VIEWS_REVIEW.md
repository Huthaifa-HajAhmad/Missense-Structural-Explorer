# Evidence topic views

16 October 2026. Presentation pass across all eleven Evidence workspaces, using
Landscape's named views as the navigation reference. No thresholds, clinical criteria,
provider requests or evidence interpretations change.

## Content audit and disposition

| Workspace | Repeated content removed from the secondary view | Unique content retained and named |
| --- | --- | --- |
| Population | Frequency/AC/AN table repeats the chart and inspector; short ClinVar summary repeats the full assertion. | Clinical assertion: condition, review status, accession and evaluation date. Frequency policy ruler moves to Comparison; homozygote/BS2 reading stays there. Heterozygote counts remain in the selected-reading inspector. |
| Predictors | Engine vote and reference rows no longer repeat across views. | Native score scales retains each model's native axis, cut-point provenance and family explanations. Strength bands gets its own view. |
| AlphaGenome | The secondary signed-contribution bars and magnitudes duplicate Comparison. | Rank & composition retains the rank ruler, origin split and per-feature magnitude shares, direction, missingness and source-family notes. Exact signed magnitudes remain in Comparison and the inspector. |
| Gene–disease | Already organized by Validity, Dosage, Mechanism and Variant context. | Existing topic navigation and assertion-detail alternative preserved. |
| Expression | Repeated TPM column removed from the sampling table. | Sampling & coverage retains sample/donor counts, age cohorts, pediatric coverage and phenotype review context. Protein measurements and Expression at variant have separate views. |
| Species & models | Generic record table repeated the explorer. | Orthology & screens, Protein alignments and Phenotype annotations preserve provider identifiers, full alignments, mouse screen coverage, mappings and source links. |
| Residue shifts & pockets | Native property dumbbells and values repeated the comparison figure. | Environment & pockets preserves burial, pocket visuals, retry and 3D actions. Exact property values and citations stay in the inspector. |
| Structural perturbation | Language-model rows and amino-acid distribution repeated Comparison. | Packing & geometry preserves FoldX component readings; Sequence embeddings preserves exploratory embedding measurements. The comparison retains distribution, local shift trace and exact model context, with a residue picker for small probability marks. |
| Functional domains | Map and table serve distinct spatial and annotation tasks. | Annotation details retains original bounds, full annotation names, evidence and citations, including off-window records. |
| RNA splicing | Rule/context readings removed from the channel detail table. | Channel details retains exact offsets and unresolved/zero/missing states; Score scales retains rule and contextual prediction rulers. |
| Interfaces & PPI | Existing map, partner exploration and assembly detail serve distinct tasks. | Assemblies & models preserves curation statements, complete solved-structure records and complex-model evidence; Partners remains separate. |

## Interaction contracts

Topic ownership is explicit at each content call site through `EvidenceTopic(tab, view)`.
Do not infer a topic from a disclosure ID: the inspector reuses disclosures independently
of the selected view. Outside a workspace, topic content remains available for standalone
consumers. Expression sampling tables omit TPM already shown by the explorer and inspector.

Deduplication must preserve operational content as well as scientific records. Model
comparison retains per-model engine diagnostics, served-model provenance, research help,
retry, connection settings and the SaProt 35M recovery action in labeled disclosures.
Packing and embedding views only show legends applicable to their own readings.
Context integration tests cover topic isolation and selection persistence; perturbation
tests cover diagnostic retention and recovery callbacks without duplicate score rows.

Stable internal view and reading IDs preserve pins, filters and explicit reveal actions.
Navigation labels describe the subject rather than a generic source-record container.
Topic panels use the existing keyboard tablist and panel labeling. Switching a tab does
not implicitly move focus into its contents. The shared inspector's review disclosures
remain available independently of the selected topic.

## Verification

PR isolation and review resolution: changes were transferred onto `origin/main` in
`feat/evidence-topic-views`, excluding concurrent dosage recovery, query, energetics,
pipeline and server work. The isolated branch passes lint and all 5,164 tests (five
skipped), plus both Population and Expression end-to-end checks against its Vite
fixture preview. Report: `.e2e/proof/evidence-topics-pr/`.

The reviewer-reported unused `formatAttributionValue` import remains necessary for
the language-model attribution display. The perturbation recovery test now awaits
the asynchronous state update inside `act`; the channel detail table names only its
SpliceAI group. The mechanism preview check now selects Channel details for splicing.
It also targets the table's existing `data-row-key` attribute. The broader mechanism
preview has 19 passing checks and no page errors; two checks fail identically on the
PR and unchanged `origin/main` (`a21ae95`): the new-variant empty-state text assertion
and adjacent splice-label geometry. These are recorded follow-ups outside this pass.

Follow-up repair verification (2026-10-16): lint passed; 244 focused tests passed;
the full suite passed 5,319 tests with five skipped (419 passing files, two skipped).
Population and Expression end-to-end checks both passed; report:
`.e2e/proof/evidence-topics-repair/`. Native preview checks confirmed the separate
Expression and Species destinations and inspected model support in desktop light
and 800px dark layouts. These checks use fixtures, not live scientific providers.

Browser checks use the production components and current styles in
`tools/evidence-preview/` and `tools/mechanism-preview/`, with explicitly illustrative
fixtures. Desktop light and 800px dark checks cover all changed topic views; interface
map, partner and assembly views were checked separately. These checks do not establish
live provider availability. Existing unit/integration and end-to-end tests have been
updated to follow the named destinations while retaining scientific and pin assertions.

Final results: lint (including TypeScript, boundaries, focus and verification parity)
passed; 244 focused tests passed, and the subsequently added assay-separation regression
passed in the context-suite recheck. The full run passed 5,280 tests with five skipped;
one unrelated `biophysics.test.ts` structural-disruption test exceeded its 15-second
deadline and passed on isolated rerun. Smoke, Population and Expression end-to-end
checks passed. Responsive end-to-end checks include light/dark themes at 1440, 800
and 390 pixels. Reports are in `.e2e/proof/evidence-topics-smoke/` and
`.e2e/proof/evidence-topics-final/`.

Scientific provenance remains in the existing Evidence, Context, Molecular and Mechanism
workspace reviews and their linked source audits; this pass introduces no new scientific
method, numerical boundary or citation.
