# Context and molecular figure presentation

14 October 2026. Continues the visualization system rollout across five Evidence tabs.
The existing context and molecular scientific audits remain authoritative. This pass changes
presentation and navigation; no source value, scientific threshold, vote or engine rule changes.

## Delivery and recovered state

The first checkpoint is `87d5ac3` (Energetics and the four-tab Population batch, including
`VISUALIZATION_SYSTEM.md`). The later shared commit `ed280ca` already contains the interrupted
Gene–disease assertion figure and Species coverage implementation. The resumed pass verified
that clean state rather than recreating or recommitting it, then completed their review and
the molecular presentation changes.

| Tab | Result | Contract preserved |
| --- | --- | --- |
| Gene–disease | Labelled source-by-category assertion matrix; compact finding and controls; submitter-specific search prompt. | Every submission retains its category, disease/inheritance scope, date, source key and inspector. No consensus score. |
| Species & models | Species-by-source coverage map; each count opens that taxon and source; partial phenotype coverage is disclosed before the figure. | One-to-many orthologs remain separate. Alliance and Ensembl identifiers are never joined. A dash is no displayed record, not biological absence. |
| Residue shifts & pockets | Compact substitution finding with the existing atom sketch, followed by directly labelled property comparisons; secondary structural facts are disclosed. | Each property retains its own scale and native units. Missing structural context does not remove intrinsic residue properties. |
| Structural perturbation | Compact model finding, directly labelled probabilities, bounded overview with full-distribution expansion. Secondary ranks and model details follow the figure. | The overview contains the six highest returned probabilities plus reference and variant. The 0–100% axis and original probabilities never change or renormalise. |
| Functional domains | Concise finding next to its residue identifier; explicit scientific question above the existing protein map. | Residue coordinates, overlap tracks, source identities, zoom, annotation pins and PM1 remain unchanged. |

RNA splicing and Interfaces & PPI already have the independent second presentation pass recorded
in `MECHANISM_WORKSPACES_REVIEW.md`; this batch does not claim to reimplement those maps.

## Interaction and integrity checks

- Species count drilldown uses taxon identity, including unknown taxa. It retains multiple
  orthologs and keeps a pin in the inspector when a different source hides it.
- The probability overview keeps a very low-probability variant visible. Expanding, collapsing
  and switching to Source records preserve its exact `0.0004` value in the NAE1 fixture.
- Important chart values are printed beside marks. Reference and variant have text labels;
  a tiny probability does not acquire a minimum quantitative bar length.
- Supporting metadata uses labelled disclosures. Model fallback and other interpretation
  caveats remain outside the collapsed model-coverage disclosure.
- The protein figure's question is above the controls and drawing. The existing regression
  against paragraphs below the map now checks this order instead of forbidding any figcaption.

## Verification

- `npm run lint`: passed, including boundaries, focus-indicator audit, verify parity and TypeScript.
- Full Vitest: **366 files passed, 2 skipped; 4,662 tests passed, 5 skipped** (four workers).
- `npm run build:client`: passed; existing large-chunk advisory remains.
- Production AppViews preview: light/dark, 1440, 800 and 390 px. All five tab panels fit at
  800 and 390 px with no document-level horizontal overflow. Wide assertion/coverage tables
  scroll inside labelled regions. Probability charts retain their minimum readable width.
- Inspected overlapping domains, dense SOD1, disputed assertions, partial phenotype coverage,
  missing animal/model/annotation sources and native residue properties with missing structure.
  The context Missing fixture deliberately retains disease assertions; it is not a disease-provider
  failure scenario. Existing tests cover a new allele reset, pin persistence and reference mismatch.
- Used the real probability chart's keyboard navigation to pin the variant, then verified the
  same pin through expansion and the source-record view. Species coverage count opens the
  expected aligned mouse record. Assertion selection opens Panel C's original classification.
- Function geometry harness in the integrated browser: **230 non-focus assertions passed**;
  **11 focus-visible assertions failed** with the document unfocused. This is the previously
  recorded embedded-browser limitation, not a fully passing accessibility gate. Geometry,
  collisions, contrast, hit targets, coordinates and interaction assertions passed. A focused
  browser run of those 11 assertions remains outstanding.

Screenshots from the integrated browser (local proof artifacts):

- Assertion matrix and selected source: `C:/Users/HSA19/.synara-beta/codex-home-overlay/generated_images/browser-proof/c758914d9c6237f5e854db00/39ffe347-35b2-4c9f-bb36-dd2e07953337.png`
- Dark probability overview and exact pin: `C:/Users/HSA19/.synara-beta/codex-home-overlay/generated_images/browser-proof/c758914d9c6237f5e854db00/18cf633c-5cbb-4b07-9cc0-371501135577.png`
- Light protein map with overlapping signatures: `C:/Users/HSA19/.synara-beta/codex-home-overlay/generated_images/browser-proof/c758914d9c6237f5e854db00/46a9afb2-60ec-40ce-ba15-2fe60b2fc7f7.png`

Repeatable fixture entry point: `tools/evidence-preview/`. API calls are disabled and examples
are explicitly labelled. These checks verify presentation and interaction, not current provider
uptime, new scientific evidence or human reader comprehension. The broader Landscape, Insights,
Literature, 3D and report rollout is outside this five-tab batch.
