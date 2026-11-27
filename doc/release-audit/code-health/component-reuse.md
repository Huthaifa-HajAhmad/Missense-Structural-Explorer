# Component reuse across the 10 Evidence tabs

The tab list is `EVIDENCE_TABS` in `src/shared/evidenceTabs.ts`. Columns:

| Code | Tab file |
| --- | --- |
| Pop | `src/components/evidence/ClinicalTab.tsx` (Population data) |
| GD | `GeneDiseaseTab.tsx` (Gene-disease) |
| Exp | `ExpressionModelsTab.tsx` (Expression) |
| Spc | `SpeciesModelsTab.tsx` (Species & models) |
| Fn | `function/FunctionTab.tsx` (Functional domains) |
| Prd | `PredictorsTab.tsx` (In-silico predictors) |
| AG | `AlphaGenomeTab.tsx` (AlphaGenome) |
| Spl | `SplicingTab.tsx` (RNA splicing) |
| Str | `StructureTab.tsx` (Residue shifts & pockets) |
| Ifc | `InterfacesTab.tsx` (Interfaces & PPI) |

Legend:

- **S**: uses the shared part.
- **H**: uses its own version (a tab-specific class or component).
- **H\***: hand-rolled, and a shared version exists in the codebase (listed in the notes). This is the duplicate to fix.
- **-**: not present in this tab.

This is a text search of each tab file and its imports, not a render. Counts come from `rg`.

## Matrix

| Shared part | Pop | GD | Exp | Spc | Fn | Prd | AG | Spl | Str | Ifc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tab frame and tab bar (`EvidenceWorkspace`, `evw-navigation`) | S | S | S | S | S | S | S | S | S | S |
| Tab title and intro (`h1.screen-title`, `p.screen-tab-description`) | H* | H* | H* | H* | H* | H* | H* | H* | H* | H* |
| Card container (`cs-card`, `primitives.css:66`) | H* | H* | H* | H* | H* | H* | H* | H* | H* | H* |
| Card heading (`.eyebrow` class on h2 or h3) | S | H | H | ? | S | S | H | S | S | S |
| Chip and tier (`ev-tier`, `cs-badge-*`) | S | S | - | - | S | S | S | S | S | - |
| Data table (`ev-table`, `table-container-card`) | H* | H | S (grid) | S (grid) | H* | H* | H* | H* | H* | - |
| Empty state (`ev-empty`, `empty-state-box`) | - | H* | - | - | H* | - | - | - | - | - |
| Source or loading notice (`ContextSourceState`) | - | S | S | - | - | - | - | - | - | - |
| Source footer under a card or table | H* | H | - | H | H* | H* | H* | H* | H* | - |
| Prose paragraph (`ui/Prose`) | S | H | H | H | S | H | H | S | S | H |
| Comparison figure (`EvidenceComparison`) | S | S (grid) | S (grid) | S (figures) | H | S | S | H | H | H |
| Scale or ruler component | H (FrequencyScale) | - | - | - | H (architecture) | H (ScoreRuler) | - | H (SpliceRuler) | H (ValueTrack) | - |
| Disclosure (`<details>`) | H | - | - | H | H | H | - | - | H | H |
| Decimal score (`DecimalScore`) | - | - | - | - | - | S | - | - | - | - |
| Guide block (how to read) | - | S (cx-guide) | H (xp-guide) | S (cx-guide) | - | - | H (AlphaGenomeGuide) | - | - | - |

Notes on the cells:

- **Tab frame**: every tab mounts `EvidenceWorkspace`. This part is shared and works.
- **Tab title and intro**: each of the 10 tabs writes its own `<header><h1 className="screen-title">` with `evidenceTab(id).label`, then its own `<p className="screen-tab-description">`. The only shared piece is the label map in `evidenceTabs.ts`. There is no shared tab-header component.
- **Card container**: `cs-card` is defined in `src/styles/primitives.css:66` and used nowhere in `src/`. Each tab uses its own card classes instead: `pop-card`, `gd-…`, `ctx-card`, `fnd-…`, `prd-…`, `ag-card`, `spl-…`, `rsx-…`, `ifc-…`, `sm-…`, `xp-…`.
- **Card heading**: `.eyebrow` is a shared class, but the tabs that use it add their own icons and sub-classes. Gene-disease uses `gd-section-heading` (`GeneDiseaseTab.tsx:44`), Expression uses `ctx-card__head`, and AlphaGenome uses `ag-card__label`. Species was not checked; its h2 search found nothing.
- **Chip**: `ev-tier` is the shared chip, with the `chip-code` variant for ACMG codes. Expression, Species and Interfaces show no chips at all.
- **Data table**: six tabs write a raw `<table>` (Pop, Fn, Prd, AG, Spl, Str). `ev-table` (`evidence.css:202`) and `table-container-card` (`typography-tables.css:285`) exist but are used nowhere. Gene-disease has its own `gd-table`. Expression and Species use the `ContextExplorer` grid.
- **Empty state**: `ev-empty` and `empty-state-box` are defined but unused. Function writes `<p className="fnd-empty">` (`FunctionTab.tsx:630`). Gene-disease writes `<tr className="gd-empty">` (`GeneDiseaseReadings.tsx:24`). `ContextSourceState` covers loading and error notices, not empty states.
- **Source footer**: `ContextSourceState` is used by only two tabs. The other tabs use their own footer classes: `pop-card__foot`, `ag-card__foot`, `prd-table-foot`, `prd-scale__source`, `spl-table-foot`, `spl-scale__source`, `rsx-foot`, and a `foot` class in Function. `cs-source-chip` is defined and unused.
- **Prose**: `ui/Prose` is used by Pop, Fn, Spl and Str. The other six tabs use raw `<p>`.
- **Comparison figure**: `EvidenceComparison` is used by Pop, Prd and AG. Spl, Str, Ifc and Fn each have their own figure component (SpliceMap, ValueTrack, InterfaceMapSection, DomainArchitecture). That may be intended, since each figure is different.
- **Scale or ruler**: five components do related work: `FrequencyScale` (population), `ScoreRuler` (predictors), `SpliceRuler` (splicing), `ValueTrack` (residue), and `ReferenceScaleChart` in `src/components/inspector/` (used only by `GeneDiseaseRail`). `ScoreRuler` and `SpliceRuler` look like the same horizontal band with markers. Not compared line by line; check before merging.
- **Disclosure**: no shared disclosure component. Six tabs write their own `<details>`. This is low risk.

## Hand-rolled duplicates, most important first

| Rank | Shared part that exists | Tabs that copy it | Suggested action |
| --- | --- | --- | --- |
| 1 | Tab header: label from `evidenceTabs.ts` plus the h1 and intro markup | All 10 (`ClinicalTab.tsx:370`, `GeneDiseaseTab.tsx:61`, `ExpressionModelsTab.tsx:57`, `SpeciesModelsTab.tsx:43`, `function/FunctionTab.tsx:408`, `PredictorsTab.tsx:295`, `AlphaGenomeTab.tsx:397`, `SplicingTab.tsx:440`, `StructureTab.tsx:400`, `InterfacesTab.tsx:85`) | One `EvidenceTabHeader` component taking the tab id. Ten copies become one |
| 2 | Card shell `cs-card` (`primitives.css:66`) | All 10 use their own card classes | Either adopt `cs-card` or delete it. It is dead today |
| 3 | Table class `ev-table` and `table-container-card` | Pop, Fn, Prd, AG, Spl, Str (raw `<table>`), GD (`gd-table`) | Adopt the shared table class, or delete both |
| 4 | Empty state `ev-empty` / `empty-state-box` | Fn (`fnd-empty`), GD (`gd-empty`) | Adopt one empty-state part, or delete the two unused ones |
| 5 | Source footer (no shared component; `ContextSourceState` covers only notices) | Pop, AG, Prd, Spl, Str, Fn, Spc | Add a `SourceFooter` part. Seven footers today |
| 6 | `ui/Prose` | Gene-disease, Expression, Species, Predictors, AlphaGenome, Interfaces write raw `<p>` | Use `Prose` in the six remaining tabs (rule 2 of the design rubric also depends on it) |
| 7 | Scale or ruler | Pop, Prd, Spl, Str each have their own | Compare `ScoreRuler` and `SpliceRuler` first; they look like one component |

## Unused shared parts (candidates to delete or adopt)

From the CSS scan (`dead-code.csv`, kind `css-class`), these shared classes have no use in `src/`, `server/`, `tools/`, `e2e` or the root files:

- `cs-card`, `cs-card-header`, `cs-chip`, `cs-source-chip`, `cs-stat-pill` (`primitives.css`)
- `ev-table`, `ev-panel`, `ev-metric`, `ev-empty`, `ev-residue`, `ev-alert` and about 25 other `ev-*` classes (`evidence.css`: 33 of 53 selectors unused)
- `table-container-card`, `table-header-row`, `empty-state-box`, `table-numeric` (`typography-tables.css`)

`ev-tier` (`evidence.css`) is used, so the chip pattern is kept in one place. The rest of `evidence.css` is partly dead.
