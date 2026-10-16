# Senior Principal Code Review: Gene–Disease Workspace & Inspector Refactoring

**Date:** 16 October 2026  
**Reviewer:** Senior Principal Code Reviewer Subagent (`gemini-3.8-flash-high`)  
**Verdict:** **APPROVE WITH SUGGESTIONS (96 / 100)**  
**Target Repository:** [`Missense-Structural-Explorer`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer)

---

## 1. Executive Summary

The refactoring of the Gene–Disease workspace and its accompanying inspector delivers significant architectural, ergonomic, and scientific improvements to Missense & Fold. The confusing dual-row pill tab arrangement has been successfully replaced with a clean, single-row evidence-category tablist ([`WorkspaceTabs`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/ui/WorkspaceTabs.tsx)), and presentation controls (`Comparison` vs. `Records`) are now properly scoped strictly within the `Validity` category.

Crucially, the refactored code maintains uncompromised clinical genomic rigor:
- **Dosage Evidence Decoupling:** Whole-gene copy-number sensitivity (ClinGen) is strictly partitioned from variant-level missense pathogenicity.
- **ClinGen Score 0 Protection:** Score `0` ("No evidence available") is accurately rendered as quiet/uncurated, preventing improper interpretation as a benign/tolerant finding.
- **Adverse Assertion Prioritization:** Refuted, disputed, or conflicting assertions immediately command the headline finding.
- **Pure Derived Inspector State:** [`GeneDiseaseRail`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/inspector/GeneDiseaseRail.tsx) acts as a read-only projection of the domain model via [`useContextWorkspaceRead`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/hooks/useContextWorkspace.ts) with zero redundant network queries.

---

## 2. Multi-Dimensional Scorecard

| Dimension | Rating | Primary Status |
| :--- | :---: | :--- |
| **1. User Experience (UX) & Ergonomics** | **9.6 / 10** | Clear category navigation; explicit single-disease carding; persistent pin indicators. |
| **2. Accessibility (A11y) & Interaction** | **9.4 / 10** | WAI-ARIA tablist pattern; roving tabindex; live status regions; visible focus rings. |
| **3. Developer Experience (DX) & Architecture** | **9.7 / 10** | Clean unidirectional state; zero side-effect inspector; defensive static fallback. |
| **4. Agent Experience (AX) & Inspectability** | **9.8 / 10** | Deterministic `data-testid`, `data-verdict`, and `data-selected` testability surfaces. |
| **5. Clinical & Scientific Integrity** | **9.8 / 10** | ACMG boundaries respected; GenCC assertions retained without artificial averaging. |
| **6. Test Coverage & Edge Cases** | **9.5 / 10** | 86 unit/integration tests passing; multi-viewport & dark/light theme E2E coverage. |

---

## 3. Dimension-by-Dimension Deep Dive

### Dimension 1: User Experience (UX) & Visual Ergonomics (9.6/10)
- **Decoupling Category Navigation from Representation:**  
  [`GeneDiseaseTab.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/evidence/GeneDiseaseTab.tsx#L13-L95) cleanly unifies the four evidence categories:
  ```tsx
  const SECTIONS = [
    { id: 'validity', label: 'Validity' },
    { id: 'dosage', label: 'Dosage' },
    { id: 'mechanism', label: 'Mechanism' },
    { id: 'variant', label: 'Variant context' },
  ] as const;
  ```
  The presentation buttons (`Comparison` and `Records`) now live exclusively inside the Validity category panel via `.gd-view-control`. Switching across categories no longer displays redundant or invalid view switches.
- **Explicit Single-Disease Choice:**  
  [`DiseaseContextPicker.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/evidence/DiseaseContextPicker.tsx#L39-L49) eliminates automatic pre-selection or hidden dropdown defaults. When a single curated disease exists, an informative panel renders inheritance, identifier, and an explicit action button:
  ```tsx
  if (compact && frames.length === 1 && (stale || !selection.diseaseKey)) {
    const frame = frames[0];
    return <section className="gd-disease-choice" aria-label="Disease context">
      <div><span className="eyebrow">Available disease for {gene}</span><h2>{frame.label}</h2>
        <p>{frame.inheritance.label} · {frame.diseaseId}{frame.selectionSource === 'Gene2Phenotype' && ' · G2P choice; no GenCC assertion'}</p></div>
      <button type="button" className="ctx-button" onClick={() => onChange(selectDisease(selection, frame.key))}>Review this disease</button>
      {selectionNote}
      {stale && <p role="status">The previous choice is absent from this snapshot. Confirm the available disease to continue.</p>}
    </section>;
  }
  ```
- **Cross-Category Pin Persistence:**  
  When an assertion is pinned in `Validity` and the user explores `Dosage` or `Mechanism`, a recovery banner (`.gd-pin-notice`) displays the pinned item and provides a 1-click jump back to the origin category with focus recovery.

---

### Dimension 2: Accessibility (A11y) & Interaction (9.4/10)
- **WAI-ARIA Tabs Compliance:** [`WorkspaceTabs`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/ui/WorkspaceTabs.tsx) implements roving `tabindex` (`0` for selected, `-1` for unselected), `role="tablist"`, `role="tab"`, `aria-selected`, and directional keyboard navigation (`ArrowLeft`, `ArrowRight`, `Home`, `End`).
- **Scroll Region Landmarks:** Horizontally scrollable tables in [`GeneDiseaseReadings.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/evidence/GeneDiseaseReadings.tsx#L40-L45) provide focus stops (`tabIndex={0}`) with accessible landmark roles:
  ```tsx
  <div className="gd-table-wrap" tabIndex={0} role="region" aria-label="Gene–disease evidence readings">
  ```
- **Live Status Regions:** Pinning and unpinning readings announce updates to assistive technologies via `<span className="sr-only" role="status">` in [`EvidenceReadingInspector.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/inspector/EvidenceReadingInspector.tsx#L18).
- **Assertion Matrix Semantics:** Non-empty matrix points declare explicit labels (`${r.name}: ${level}`), while empty points expose `<span className="sr-only">No assertion in this category</span>` in [`ContextFigures.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/evidence/ContextFigures.tsx#L34).

---

### Dimension 3: Developer Experience (DX) & Architecture (9.7/10)
- **Zero-Fetch Inspector Projection:**  
  [`GeneDiseaseRail.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/inspector/GeneDiseaseRail.tsx#L12-L60) takes `analysisResult` and executes `useContextWorkspaceRead(analysisResult, 'gene-disease')`. It performs zero side-effects and instantiates zero API clients, ensuring total synchronization with the main workspace.
- **Graceful Unbound Fallback:**  
  In [`GeneDiseaseTab.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/evidence/GeneDiseaseTab.tsx#L70-L90), when `workspace.enabled` is false (e.g. standalone rendering or isolated component test suites), the component cleanly falls back to rendering all sections sequentially as a document without throwing context provider errors.
- **Safe URI Boundaries:**  
  All external URLs (GenCC, ClinGen, Gene2Phenotype) pass through [`safeExternalHref`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/shared/externalLink.ts) to prevent script injection.

---

### Dimension 4: Agent Experience (AX) & Inspectability (9.8/10)
- **High-Fidelity DOM Markers:** Programmatic agents and E2E test runners have access to unambiguous selectors:
  - `data-testid="gene-disease-screen"`
  - `data-testid="gene-disease-finding"`
  - `data-verdict="adverse" | "differ" | "agree" | "unselected"`
  - `data-selected="true"` on rows and matrix intersections
  - `aria-pressed="true"` on inspection toggles
- **Predictable Structural Contracts:** Documented in [`doc/GENE_DISEASE_UX_POLISH_REVIEW.md`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/doc/GENE_DISEASE_UX_POLISH_REVIEW.md), enabling both developer agents and human contributors to maintain the interface contracts.

---

### Dimension 5: Clinical Genomic Integrity (9.8/10)
- **Decoupled Whole-Gene Dosage vs. Missense Pathogenicity:**  
  Explicitly communicates that ClinGen haploinsufficiency / triplosensitivity applies to copy-number variations (CNVs) and whole-gene deletions, not variant-level missense consequences. No ACMG/AMP criteria (e.g. PVS1, PM1) are erroneously applied.
- **Preservation of Raw Submitter Classifications:**  
  GenCC validity assertions are kept as discrete submitter rows on their original scale. No artificial numerical averaging or arbitrary consensus algorithm is applied.
- **Strict Guarding of ClinGen Score 0:**  
  ClinGen score `0` (*"No evidence available"*) is prevented from being treated as benign or tolerant.

---

### Dimension 6: Test Coverage & Regression Safety (9.5/10)
- **Unit & Integration Suite:** 7 test files, 86 focused tests all passing:
  - [`ContextWorkspace.integration.test.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/evidence/__tests__/ContextWorkspace.integration.test.tsx)
  - [`EvidenceContextTabs.test.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/__tests__/EvidenceContextTabs.test.tsx)
- **E2E Visual & Flow Proof:** [`tests/gene-disease-workspace.e2e.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/tests/gene-disease-workspace.e2e.ts) runs Playwright E2E across 1440px, 800px, and 390px in dark and light modes, verifying zero horizontal overflow.

---

## 4. Specific Opportunities for Enhancement

### Opportunity 1: Remove Stray Backslash in [`ContextExplorer.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/evidence/ContextExplorer.tsx#L113)
```diff
--- a/src/components/evidence/ContextExplorer.tsx
+++ b/src/components/evidence/ContextExplorer.tsx
@@ -113,3 +113,3 @@
- : <div className="cx-table-scroll" role="region" aria-label="Exact source readings" tabIndex={0}><table className="cx-table"><thead><tr><th>Record</th><th>Reading</th><th>Source / context</th></tr></thead><tbody>{page.rows.map(r => <tr key={r.key} data-selected={w.selected === r.key || undefined}>\
+ : <div className="cx-table-scroll" role="region" aria-label="Exact source readings" tabIndex={0}><table className="cx-table"><thead><tr><th>Record</th><th>Reading</th><th>Source / context</th></tr></thead><tbody>{page.rows.map(r => <tr key={r.key} data-selected={w.selected === r.key || undefined}>
             <th scope="row"><InspectReadingButton tab={tab} readingKey={r.key}>{r.name}</InspectReadingButton></th><td>{tab === 'expression-models' && r.value !== null ? `${r.value} TPM` : r.valueText}</td><td>{r.source}<small>{r.description}</small></td>
```

### Opportunity 2: Add `aria-controls` to Validity View Buttons in [`GeneDiseaseTab.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/evidence/GeneDiseaseTab.tsx#L76-L81)
```diff
--- a/src/components/evidence/GeneDiseaseTab.tsx
+++ b/src/components/evidence/GeneDiseaseTab.tsx
@@ -75,6 +75,6 @@
           {workspace.enabled && model.assertions.length > 0 && <div className="gd-view-control" role="group" aria-label="Validity presentation"><span>View</span>
-            <button type="button" aria-pressed={workspace.comparison} onClick={() => workspace.setView('comparison')}>Comparison</button>
-            <button type="button" aria-pressed={!workspace.comparison} onClick={() => workspace.setView('records')}>Records</button>
+            <button type="button" aria-pressed={workspace.comparison} aria-controls="gd-validity-representation" onClick={() => workspace.setView('comparison')}>Comparison</button>
+            <button type="button" aria-pressed={!workspace.comparison} aria-controls="gd-validity-representation" onClick={() => workspace.setView('records')}>Records</button>
           </div>}
+          <div id="gd-validity-representation">
           {workspace.comparison ? <ContextExplorer tab="gene-disease" rows={rows.filter(r => r.group === 'validity')} groups={[{ id: 'validity', label: 'Validity' }]} empty={model.sentence} />
             : <GeneDiseaseReadings model={model} section="validity" />}
+          </div>
```
