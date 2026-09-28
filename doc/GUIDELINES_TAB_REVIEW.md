# Score Thresholds & Guidelines Tab — Scientific-Integrity and UI Review

Reviewed against reference implementation standards (`.agents/skills/evidence-tab-refactor/`) and MACO1 p.Glu433Lys, 28 September 2026.
Redesign branch `scores-threshold-redesign`.

---

## 1. Executive Summary & Design Decisions

The Threshold Guide provides an exhaustive cross-modal concordance overview comparing 20 distinct predictors, biophysical stability engines, and evolutionary constraint metrics against published ACMG/AMP evidence thresholds.

Prior to this refactor, the tab suffered from structural drift:
1. **Lacked the Three-Tier Architecture**: Unlike Population Data (`ClinicalTab`) and In-Silico Predictors (`PredictorsTab`), the Threshold Guide had no hero card, headline figure, or structured fact strip.
2. **Design System Violations**: Used hard-coded colors (`#EFF6FF`, `#1E40AF`), raw Tailwind palette utilities (`text-rose-500`, `bg-amber-500/10`), and extensive inline `style={{ ... }}` blocks.
3. **Monolithic Inspector Rail**: The threshold inspector pane was rendered as an untyped 180-line inline IIFE in `EvidenceInspector.tsx`, duplicating state derivations and leaking local variables into the parent component.

### Decisions Taken
- **Three-Tier Screen Shape**: Adopted the canonical layout (`pop-screen` > `pop-hero` finding > `pop-table-wrap` readings > `gt-legend` track legend & code key link).
- **Pure Finding Model**: Added `guidelinesFinding(summary)` in `src/shared/thresholds/guidelines.ts` to formulate deterministic headline and predicate prose without re-derivation in UI components.
- **Dedicated Modular Rail**: Extracted `src/components/inspector/GuidelinesRail.tsx` consuming the exact same `buildGuidelinesRows` model as the main tab.
- **Token-Safe Stylesheet**: Created `src/styles/guidelines.css` with a dedicated `gt-` prefix using CSS variables and `color-mix()` instead of arbitrary hexes.

---

## 2. Findings & Rectifications

| # | Severity | Finding | Fix |
|---|---|---|---|
| F1 | High | **No Three-Tier Structure**: The tab rendered summary chips and jumped straight into the table without an eyebrow, verdict chip, headline ratio, or contextual finding sentence. | Rebuilt `GuidelinesTab.tsx` with a `.pop-card.pop-hero` tier featuring an ACMG question eyebrow, a `ConcordanceVerdictChip`, a `${nPath}–${nBenign}` headline figure, and a 4-cell fact strip (`pop-facts`). |
| F2 | High | **Monolithic Inline Inspector IIFE**: `EvidenceInspector.tsx` contained an IIFE with local variables (`revel`, `ddG`, `statusBadgeStyle`) outside the component tree, drifting from the modular `PopulationRail` / `PredictorsRail` pattern. | Extracted into a dedicated, strongly-typed `src/components/inspector/GuidelinesRail.tsx`. |
| F3 | Medium | **Banned Hex & Palette Colors**: Hard-coded `#EFF6FF` / `#1E40AF` in `typography-tables.css` and `text-rose-500` / `bg-indigo-500` in the inspector broke dark mode and print styles. | Migrated to token-safe semantic variables (`--cs-text-danger-on-soft`, `--cs-text-good-on-soft`, `--cs-accent-clay`, `color-mix(in srgb, ...)`). |
| F4 | Medium | **Ad-hoc Finding Sentence Generation**: Main-column prose was missing a declarative synthesis of multi-modal concordance. | Added `guidelinesFinding(summary)` to `src/shared/thresholds/guidelines.ts`, returning a declarative headline and predicate covered by unit tests. |
| F5 | Low | **CSS Architecture Splintering**: Threshold styles were embedded in `typography-tables.css`. | Moved all `gt-*` rules into a dedicated module `src/styles/guidelines.css` and registered it in `components.css`. |
| F6 | High | **Absence Treated as Benign/Neutral in `matchLabel`**: Uncomputed metrics (FoldX, DynaMut2, DDMut, RaSP, ThermoMPNN, MetaRNN, ClinPred, misZ, loeuf) defaulted to "Tolerated", "Neutral", or "Stabilizing" on null values. | Explicitly guarded every row builder in `src/shared/thresholds/guidelines.ts` to return `"No data"` when `value === null`. Verified with regression tests. |
| F7 | High | **Inspector Concordance Contradiction**: `GuidelinesRail.tsx` executed an ad-hoc 2-metric legacy heuristic with unsourced cutoffs that contradicted the main tab's 20-metric finding. | Harmonized `GuidelinesRail.tsx` to derive status directly from `summary` and `guidelinesFinding(summary)`, while annotating REVEL and FoldX with truthful calibrated labels. |
| F8 | Medium | **Constraint Metric Omission**: `misZ` and `loeuf` were not reading canonical `result.gnomadConstraint`. | Added canonical `result.gnomadConstraint.missense_z` and `result.gnomadConstraint.loeuf` access. |
| F9 | Medium | **Broken CSS Syntax & Accessibility in Rail Button**: Invalid space-separated CSS functional expressions in button className. | Extracted clean token-styled `.gt-rail-btn` class with `:hover` and `:focus-visible` states. Converted table metric cell to semantic `<th scope="row">`. |

---

## 3. Effect on Reference Variant: MACO1 p.Glu433Lys

- **Concordance Ratio Headline**: **7–1** (7 pathogenic supporting, 1 benign/neutral stabilizing, 4 intermediate/VUS, 3 informational, 5 awaiting data).
- **Verdict Chip**: `Pathogenic Concordance` (`data-tone="danger"`).
- **Finding Prose**:
  > **Pathogenic concordance across computational and biophysical metrics** — 7 of 15 scored metrics reach pathogenic supporting or strong thresholds, while 1 is benign/neutral and 4 are intermediate.
- **4-Cell Fact Strip**:
  - *In-Silico & ML*: 8 / 11 scored (5 path · 0 benign · 3 info)
  - *Biophysical ΔΔG*: 1 / 5 scored (0 destab · 1 stabilizing)
  - *Conservation & Z*: 3 / 4 scored (2 constrained · 1 vus)
  - *Monitored Total*: 7 path / 1 benign / 4 intermediate
- **Readings Table**: Preserved all 20 rows, semantic `<th scope="row">`, sticky category rowgroups, and micro-tracks with calibrated cut-point ticks.

---

## 4. Verification & Quality Gates

- **Unit & Integration Tests**:
  - `src/components/evidence/__tests__/GuidelinesTab.test.tsx` (6 tests passing, including three-tier verification).
  - `src/components/inspector/__tests__/EvidenceInspector.test.tsx` (4 tests passing with harmonized `GuidelinesRail`).
  - `src/shared/thresholds/guidelines.test.ts` (13 tests passing, covering absence labels, canonical constraint, and findings).
  - `src/components/__tests__/energeticsLabels.guard.test.ts` (32 tests passing; no legacy labels).
- **TypeScript**: `npx tsc --noEmit` passed with 0 errors.
- **Lint & Parity**: `npm run lint` passed (architectural boundaries, focus indicators, verify parity).

---

## 5. Primary Citations & Calibrations

1. **ACMG/AMP Standards**: Richards S, et al. Standards and guidelines for the interpretation of sequence variants. *Genet Med* 2015;17:405–424. doi:10.1038/gim.2015.30
2. **ClinGen In-Silico Calibration (REVEL, CADD, BayesDel, GERP++, phyloP)**: Pejaver V, et al. Calibration of computational tools for ACMG/AMP variant classification. *Am J Hum Genet* 2022;109:2163–2177. doi:10.1016/j.ajhg.2022.10.013
3. **ClinGen Deep-Learning Calibration (AlphaMissense, ESM1b)**: Bergquist T, et al. Clinical evaluation of deep learning missense predictors. *Genet Med* 2025;27:101402. doi:10.1016/j.gim.2025.101402
4. **popEVE Disease Genetics**: Orenbuch R, et al. Proteome-wide model for human disease genetics. *Nat Genet* 2025;57:3165–3174. doi:10.1038/s41588-025-02400-1
5. **FoldX Stability Force Field**: Schymkowitz J, et al. The FoldX web server: an online force field. *Nucleic Acids Res* 2005;33:W382–W388. doi:10.1093/nar/gki387
