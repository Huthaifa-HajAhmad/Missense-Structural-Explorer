# Design rubric scan: Evidence, inspector, energetics, report

Scope: `src/components/evidence/**`, `src/components/inspector/**`, `src/components/energetics/**`, `src/components/report/**`, `src/index.css` and the style files it imports (`src/styles/*.css`). Test files are skipped. This is a static scan (text search and CSS rule parsing). Nothing was rendered.

## Token reference

Defined in `src/styles/variables.css` under `:root` (line 50 onward). Dark-mode values are at lines 272-284.

| Token | Value (light) | Line | Role in the house rules |
| --- | --- | --- | --- |
| `--cs-bg` | `#F9F8F6` | 74 | Page background |
| `--cs-surface` | `#FFFFFF` | 76 | Panel body (white) |
| `--cs-surface-2` | `#F5F2EA` | 77 | Sand tone. The file's own comment says it is a "nested panel" fill. Two-tone rule: not a panel body |
| `--cs-accent-wash` | `#F8EEF0` | 70 | The one wash, used only on header and footer strips |
| `--cs-workbench-header-surface` | `var(--cs-accent-wash)` | 62 | Header strip alias |
| `--cs-panel-body` | `var(--cs-surface)` | 71 | Panel body alias |
| `--cs-text-muted` | `#6E685E` | 98 | Dimmed label colour |

Two-tone rule as written in `variables.css` (lines 56-61): every panel body is `--cs-surface`, every head or foot strip uses the wash.

## Rule 1: two-tone surfaces, no sand bodies, no underline tabs, no bare header icons

### 1a. Sand or beige panel bodies

| # | File:line | Snippet | Status |
| --- | --- | --- | --- |
| 1 | `src/styles/landscape.css:229` | `.lsr-card { background: var(--cs-surface-2) ...` | **Violation.** Card body is sand. Used at `src/components/inspector/LandscapeInspector.tsx:176` and `:280` |
| 2 | `src/styles/alphagenome.css:401-406` | `.ag-rail__formula` with `background: var(--cs-surface-2)` | Borderline. A small formula box inside a rail card (`src/components/inspector/AlphaGenomeRail.tsx:95`). A tile, not a panel body |

Dead rules with sand bodies (not used anywhere, so no live violation; listed in `dead-code.csv`): `src/styles/primitives.css:95` `.cs-nested-panel`, `:118` `.cs-sub-card`, `:379` `.cs-surface-card-2`.

### 1b. Underline-style tabs

| # | File:line | Snippet | Status |
| --- | --- | --- | --- |
| 3 | `src/styles/workspace.css:49` | `.workspace-tabs button { ... border-block-end: 2px solid transparent; ... }` | **Violation.** Tab buttons get an underline rule |
| 4 | `src/styles/workspace.css:50` | `.workspace-tabs button[aria-selected="true"] { ... border-block-end-color: var(--cs-accent-clay); }` | **Violation.** The selected tab is marked with a clay underline |
| 5 | `src/styles/evidence-workspace.css:21-23` | `.evw-navigation { ... border-bottom: 1px solid ... }` and `.evw-navigation .workspace-tabs { border-bottom: 0 }` | **Violation** (same underline grammar, built on the tab hairline) |

Where it renders: `src/components/ui/WorkspaceTabs.tsx:17` (`role="tablist"`). Used by `src/components/evidence/EvidenceWorkspace.tsx:50` (all Evidence tabs), `src/components/evidence/GeneDiseaseTab.tsx:72`, `src/components/review/ReviewWorkspace.tsx:31`, `src/components/EnergeticsView.tsx:141`, `src/components/ClinicalReportBar.tsx:110`.

Conflict to decide: `src/styles/workspace.css:44-45` documents the underline as a deliberate design ("a ruled index, not buttons ... a 2px clay rule"). The house rule says no underline tabs. The house rule is the user's standing rule, so this scan follows it. The code comment should be changed or the rule should get an exception.

The secondary tab variant (`workspace.css:85`, used at `src/components/evidence/ContextExplorer.tsx:88`) uses a filled selected state, not an underline. It passes.

### 1c. Bare header icons (no container)

An icon placed directly in a heading or eyebrow label, with no wrapper or chip. Examples (the full set is about 69 headings across 28 files, found by a grep for `eyebrow` or `rpt-rail-title` followed by an icon on the same or the next line):

| File:line | Snippet | Status |
| --- | --- | --- |
| `src/components/inspector/PinHeader.tsx:12` | `<span className="eyebrow"><Pin size={13} .../>{eyebrow}</span>` | **Violation.** Shared by `EnergeticsMethodInspector.tsx:52` and `EvidenceReadingInspector.tsx:18` |
| `src/components/inspector/SplicingReadingInspector.tsx:24` | same pattern with `Pin` | **Violation** |
| `src/components/inspector/InsightsInspector.tsx:91` | span eyebrow with `<Pin>` | **Violation** |
| `src/components/inspector/InsightsInspector.tsx:101, 129, 135, 141` | `<h3 className="eyebrow"><GitBranch/Bot/Sparkles/BookOpen .../>` | **Violation** (4 headings) |
| `src/components/inspector/LiteratureInspector.tsx:106` | span eyebrow with `<FileText>` | **Violation** |
| `src/components/inspector/LiteratureInspector.tsx:204` | `<h3 className="eyebrow"><Sparkles/>Summary inputs` | **Violation** |
| `src/components/evidence/EvidenceComparison.tsx:137` | `<h3 className="eyebrow"><EyeOff .../>` | **Violation** |
| `src/components/evidence/function/HotspotsView.tsx:260` | `<h2 className="eyebrow" ...><Flame .../> Germline hot spots` | **Violation** |
| `src/components/evidence/PredictorsTab.tsx:213-214, 307-308, 352-353` | `<h2 className="eyebrow">` then `<Info/>`, `<Cpu/>`, `<ListChecks/>` on the next line | **Violation** (3 card headings) |
| `src/components/evidence/ClinicalTab.tsx:385-386, 548-549` | span and h2 eyebrows with `<Gauge/>` and `<Database/>` | **Violation** |
| `src/components/evidence/interfaces/InterfaceHero.tsx:35-36` | span eyebrow with `<Waypoints/>` | **Violation** |
| `src/components/inspector/AlphaGenomeRail.tsx:70, 111, 134, 170` | `<h3 className="eyebrow">` then a bare icon | **Violation** (rail pattern, 4) |
| `src/components/inspector/EnergeticsInspector.tsx:61, 103, 134, 170` | same rail pattern | **Violation** (4) |
| `src/components/inspector/InterfacesRail.tsx:102, 129, 172` | same rail pattern | **Violation** (rail pattern) |
| `src/components/inspector/StructureInspector.tsx:210` | `<summary><GitBranch .../>Coordinate lineage` | Borderline (a disclosure summary) |
| `src/components/report/rail/ReportSummaryStatus.tsx:41` | `<h3 className="rpt-rail-title"><Sparkles size={14}/>Written summary` | **Violation** |
| `src/components/report/rail/ReportReviewStatus.tsx:22` | `<h3 className="rpt-rail-title"><ClipboardCheck size={14}/>` | **Violation** |
| `src/components/report/rail/ReportDocumentFields.tsx:29` | `<h3 className="rpt-rail-title"><UserRound size={14}/>` | **Violation** |

Other rail files with the same pattern (one to six headings each): `FunctionRail.tsx`, `PopulationRail.tsx`, `PredictorsRail.tsx`, `ResidueShiftInspector.tsx`, `SplicingRail.tsx`, `EnergeticsRuleTrace.tsx:48`, `EnergeticsMethodInspector.tsx:79`, `ReportContents.tsx`, and `energetics/ReadingsTable.tsx` and `PackingTable.tsx`.

## Rule 2: paragraphs fill their card (no width caps on text)

Inside the scope, no component uses `max-w-*` or `max-w-[...ch]` (grep: 0 hits). The violations are in CSS.

| # | File:line | Selector and cap | Affects |
| --- | --- | --- | --- |
| 1 | `src/styles/layout.css:242-249` | `.screen-tab-description { max-inline-size: 75ch }` | **Every Evidence tab.** The intro paragraph under each tab title (the 9 Evidence tab files that use it) |
| 2 | `src/styles/context-workspace.css:35` | `.cx-guide > div { max-width: 78ch }` | Guide blocks in `src/components/evidence/ContextExplorer.tsx` (used by the Gene-disease, Expression and Species tabs) |
| 3 | `src/styles/context-workspace.css:77` | `.cx-source-state p { max-inline-size: 72ch }` | Source-state notices in `ContextSourceState.tsx` and the expression cards (`DevelopmentalExpressionCard.tsx`, `HpaCard.tsx`, `HpoAnnotationCard.tsx`, `PextCard.tsx`) |
| 4 | `src/styles/interfaces.css:252` | `.ifc-track__note > span { max-width: 62ch }` | Interfaces tab note |
| 5 | `src/styles/gene-disease.css:67` | `.gd-empty__reason { max-width: 60ch }` | Gene-disease empty reason (`GeneDiseaseReadings.tsx:24`) |
| 6 | `src/styles/structure3d.css:543` | `.s3d-overlay__body { max-width: 60ch }` | Viewer status overlay (`src/components/molstar/StructureStatusOverlay.tsx`, outside the scope folders) |
| 7 | `src/styles/structure3d.css:647` | `.s3d-section-intro { max-width: 62ch }` | Section intro in `src/components/inspector/StructureInspector.tsx` |
| 8 | `src/styles/energetics.css:128` | `.nrg-comparison-figure .viz-frame__head p { max-inline-size: 80ch }` | Energetics figure intro (`src/components/energetics/EnergeticsComparison.tsx`) |
| 9 | `src/styles/landscape.css:358` | `.landscape-canvas__heading p { max-width: 70ch }` | Landscape canvas heading (`src/components/SequenceVisualizer.tsx`, outside the scope folders) |
| 10 | `src/styles/landscape.css:531` | `.ls-mapping-limit p { max-inline-size: 70ch }` | Landscape mapping note (`src/components/sequence/LandscapeOverview.tsx`, outside the scope folders) |
| 11 | `src/styles/insights.css:17, 53, 60, 107, 111, 113, 117` | seven `ch` caps (`65ch` to `75ch`) on notices, hero finding, callouts, prose, rows and view headings | Insights screen (`src/components/insights/InsightsScreen.tsx`, outside the scope folders) and `ClinicalInsightsCard.tsx` |
| 12 | `src/styles/report.css:160` | `.rpt-table details { max-width: 52ch }` | Report table details |

Outside the scope but imported globally: `src/styles/analysis-empty-state.css:3, 8, 19` (`70ch`, `46ch`, `35ch` on empty-state paragraphs) and the About page caps in `layout.css` (lines 1136-1986). Not checked further.

## Rule 3: no kicker that repeats the card or tab name; each fact once per screen

| # | File:line | Repeated text | Where else it appears |
| --- | --- | --- | --- |
| 1 | `src/components/evidence/PredictorsTab.tsx:67` | `<h2 className="eyebrow">Local agreement / informational</h2>` | Same words as the heading in `src/components/inspector/PredictorsRail.tsx:241` (tab and rail show it at once) |
| 2 | `src/components/evidence/PredictorsTab.tsx:67-68` and `:213-215` | Tab header says "Context only / never sets PP3 / BP4"; card title says "Informational models · not counted" | The same "not counted / context only" point is made twice on one tab |
| 3 | `src/components/evidence/PredictorsTab.tsx:68`, `:309` | "Context only / never sets PP3 / BP4" and "ACMG computational evidence · PP3 / BP4" | Plus the tab subtitle "In-silico predictors & PP3/BP4 bands" (`src/shared/evidenceTabs.ts`, predictors row). PP3/BP4 is stated three times |
| 4 | `src/components/evidence/splicing/SplicingRecords.tsx:8` | `<h2 className="eyebrow">Channel details</h2> ` | Same words as the splicing tab's `detailView` label, "Channel details" (`src/shared/evidenceTabs.ts`) |
| 5 | `src/components/evidence/interfaces/InterfaceHero.tsx:35-37` and `src/components/evidence/StructureTab.tsx:37` | "Interface context · not an ACMG input" and "Structural context · not an ACMG input" | Same disclaimer on two tabs. Fine per tab; check that the rail does not repeat it again |

No eyebrow found that repeats the exact tab label as its own text.

## Rule 4: colours come from design tokens

| # | File:line | Snippet | Status |
| --- | --- | --- | --- |
| 1 | `src/components/**` (scope) | hex, `rgb(`, `hsl(`, `oklch(`, Tailwind palette classes (`text-rose-600`, `bg-amber-50`, etc.) | **Pass.** 0 hits in the four scoped folders |
| 2 | `src/styles/landscape.css:28`, `:34` | `color: #fff` on `.ls-band[data-band="pp3-strong"]` and `bp4-strong` | **Violation** (raw white, used by `LandscapeInspector`) |
| 3 | `src/styles/primitives.css:148`, `:162` | `color: #fff`; `.cs-btn-primary:hover { background: #b55a3e; }` | **Violation** (primitive button colour) |
| 4 | `src/styles/primitives.css:314-327` | `.cs-badge-*` with `#92400E`, `#166534`, `#FBBF24`, `#4ADE80`, `#9A3412`, `#FBF0EB`, `rgba(...)` | **Violation.** Badge palette is hard-coded (`.cs-badge-clay` is used by `ClinicalInsightsCard.tsx:216`, out of scope) |
| 5 | `src/styles/primitives.css:363` | `background: #22C55E` | **Violation** (one-off green) |
| 6 | `src/styles/structure3d.css:938, 946, 1065, 1070, 1161` | gradient swatches `#8a8275`, `#c46849`, `#8a8a8a`, `#c0392b` | Borderline. They are fixed legend colours for 3D display modes; acceptable if they must match the viewer |
| 7 | `src/styles/layout.css:276-287` | `--vh-good-fg: #166534`, `--vh-muted-fg: #6E685E`, `--vh-track: #E8E4DD`, and `rgba` variants | **Violation.** A second, local token set. `--vh-muted-fg` duplicates `--cs-text-muted`. Only used in CSS |

## Rule 5: heading levels per Evidence tab (rubric: h2 tab title, h3 cards)

Tab titles are `h1.screen-title` in all 10 tabs. The rubric says h2. Consistent across tabs, but it does not match the rubric. This is a conflict to decide, not a single violation.

| Tab file | Tab title (h1) line | Card headings at h2 (rubric: h3) |
| --- | --- | --- |
| `ClinicalTab.tsx` | 370 | 548, 624 |
| `GeneDiseaseTab.tsx` | 61 | 44, 77 |
| `ExpressionModelsTab.tsx` | 57 | 69, 78 |
| `SpeciesModelsTab.tsx` | 43 | none found by the h2 search |
| `function/FunctionTab.tsx` | 408 | 542 (and `function/HotspotsView.tsx:260`) |
| `PredictorsTab.tsx` | 295 | 67, 213, 352 |
| `AlphaGenomeTab.tsx` | 397 | 188, 412, 561 |
| `SplicingTab.tsx` | 440 | 530, 608 (and `splicing/SplicingRecords.tsx:8`) |
| `StructureTab.tsx` | 400 | 37 |
| `InterfacesTab.tsx` | 85 | `interfaces/AssemblyRecords.tsx:71`, `BindingCard.tsx:17`, `InterfaceMapSection.tsx:28`, `PartnersPanel.tsx:23`, `InterfaceOverview.tsx:11` |

Rails (`src/components/inspector/*Rail*.tsx`) use h3 for their sections, which matches the rubric. `EvidenceComparison.tsx:137` uses h3 for an unplotted-readings card and `:142` uses h4 for groups in the same component. That is a level skip inside one card.

## Summary

| Rule | Result |
| --- | --- |
| 1a Sand bodies | 1 live (`lsr-card`), 1 borderline (`ag-rail__formula`), 3 dead rules |
| 1b Underline tabs | Violation in shared `WorkspaceTabs` (used by the Evidence tab bar); documented as deliberate |
| 1c Bare header icons | About 69 headings in about 28 files; the inspector rails and report rail are the largest group |
| 2 Width caps on text | 12 rules in scope. `screen-tab-description` (75ch) hits all 10 tabs |
| 3 Repeated kickers | 5 repeats; the PP3/BP4 point is stated three times on one tab |
| 4 Hard-coded colours | Components clean. CSS has about 7 groups with raw hex, mostly `primitives.css` and `layout.css` |
| 5 Heading levels | Tab title h1 (rubric h2) in all 10 tabs; card h2 in 9 tabs (rubric h3) |
