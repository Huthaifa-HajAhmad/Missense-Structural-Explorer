# Comprehensive READ-ONLY Audit Report: Evidence Context Architecture & Implementation

**Target Codebase:** `C:/Users/HSA19/antigravity/Missense-Structural-Explorer`

**Audit Scope:** Evidence context implementation across shared contracts, client stores, hooks, UI tabs, server services, import scripts, and scientific boundaries.
**Mode:** **READ-ONLY** (No files modified; development server was **not** started).

---

## 1. Executive Summary & Verification Matrix

The evidence context system introduces clinical disease frame validity (GenCC), molecular mechanism scoping (Gene2Phenotype), adult tissue expression (GTEx v10), and human pediatric developmental expression (dGTEx V1) into Missense & Fold.

| Evaluation Axis | Requirement / Specification | Implementation Status | Scientific & Technical Integrity |
| :--- | :--- | :--- | :--- |
| **ACMG Insulation** | All context only; **NO** ACMG criteria additions, score voting, or classification changes | **Verified Complete** | [`criteria.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/prediction/acmg/criteria.ts) and [`acmgClassifier.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/shared/acmgClassifier.ts) have zero imports or coupling with evidence context. |
| **Tab Parity** | Both context tabs co-equal companion surfaces | **Defect Identified** | `ExpressionModelsTab` has full export capability; `GeneDiseaseTab` lacks the export button and does not preload expression. |
| **Selection Identity** | Per-variant browser-session persistence | **Defect Identified** | Stored in `sessionStorage` per composite key, but progressive metadata hydration causes key divergence and temporary selection desynchronization. |
| **dGTEx V1 Data** | 332 eligible RNA columns / 34 donors vs 379 announced samples; donor medians; cohort bins != onset | **Verified Complete** | [`scripts/evidence_context/dgtex.py`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/scripts/evidence_context/dgtex.py) perfectly reconciles 332 RNASeq samples (omitting 10 EXCLUDE, 37 WGS), computes within-donor median first, and protects public age bins. |
| **G2P Scoping** | Support != experimental validation; no fuzzy disease joins | **Verified Complete** | Strict exact HGNC + MONDO IDs only. Display mapping strictly separates `monoallelic_autosomal` and `biallelic_autosomal`. Modifiers are shown verbatim. |
| **Auth & Routing** | Main source routes authenticated | **Verified Complete** | `/api/v1/evidence-context` is protected by `authCheck` middleware (`Bearer` token or `x-gemini-session-id`). Client uses `fetchWithAuth`. |

---

## 2. Reproducible Defects & Unsafe Bugs (with File, Line & Precise Fix)

### Defect 1: Companion Tab Asymmetry & Missing Context Export on Gene–Disease Tab
* **File & Line:** [`src/components/evidence/GeneDiseaseTab.tsx:14-22`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/evidence/GeneDiseaseTab.tsx#L14-L22) vs [`src/components/evidence/ExpressionModelsTab.tsx:27-46`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/evidence/ExpressionModelsTab.tsx#L27-L46)
* **Root Cause:**
  [`ExpressionModelsTab.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/evidence/ExpressionModelsTab.tsx) implements an inline `exportContext` function and places an `<button className="ctx-button" onClick={exportContext}><Download />Export context</button>` in its header. In contrast, [`GeneDiseaseTab.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/evidence/GeneDiseaseTab.tsx) has no export button and wraps its header with standard `<header>` rather than `<header className="ctx-heading">`. Furthermore, `GeneDiseaseTab` calls `useEvidenceContext(result)` with default `expression = false`, so adult and pediatric expression contexts remain in `'not-requested'` state unless the user has already navigated to the Expression tab.
* **Impact:**
  Violates the specification requirement that "both tabs are equal companion surfaces". A researcher working on disease validity cannot export the context JSON without navigating to the other tab.
* **Precise Fix:**
  1. Extract the context JSON builder to a shared utility `src/shared/evidenceContextExport.ts` (or inside [`src/shared/diseaseFrame.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/shared/diseaseFrame.ts)):
     ```ts
     export function buildEvidenceContextExportPayload(context: EvidenceContextState, result: AnalysisResult) { ... }
     ```
  2. Update [`src/components/evidence/GeneDiseaseTab.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/evidence/GeneDiseaseTab.tsx#L17) header:
     ```tsx
     <header className="ctx-heading">
       <div>
         <h1 className="screen-title">Gene–disease</h1>
         <p className="screen-tab-description">Causal relationship, disease mechanism and variant context.</p>
       </div>
       <button type="button" className="ctx-button" onClick={exportContext}>
         <Download size={14} aria-hidden="true" />Export context
       </button>
     </header>
     ```

---

### Defect 2: Gene Symbol Case-Sensitivity Mismatch in Client Hook Assertion
* **File & Line:** [`src/hooks/useEvidenceContext.ts:25, 36, 46`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/hooks/useEvidenceContext.ts#L25)
* **Root Cause:**
  The hook performs strict case-sensitive identity checks:
  ```ts
  if (data.gene !== gene) throw new Error('Context identity mismatch');
  ```
  If a user enters a query with lowercase or mixed-case gene symbols (e.g., `fgfr3` or `Brca1`), `gene` holds the query literal, while backend databases (GenCC, HGNC, GTEx) resolve to uppercase canonical symbols (`FGFR3`, `BRCA1`). When the backend returns canonical `data.gene = 'FGFR3'`, `data.gene !== gene` triggers an unhandled rejection and transitions the context state to unrecoverable `error`.
* **Impact:**
  Silent crash of the evidence context tabs when queries use lowercase or unnormalized gene symbols.
* **Precise Fix:**
  Normalize case when asserting identity in [`src/hooks/useEvidenceContext.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/hooks/useEvidenceContext.ts):
  ```ts
  if (data.gene.toUpperCase() !== gene.toUpperCase()) throw new Error('Context identity mismatch');
  ```

---

### Defect 3: Missing In-Flight Deduplication (Race Condition) in Server G2P Loader
* **File & Line:** [`server/services/evidence-context/g2p.ts:13-25`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/evidence-context/g2p.ts#L13-L25)
* **Root Cause:**
  [`server/services/evidence-context/store.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/evidence-context/store.ts#L7-L23) (GenCC) uses a `flights = new Map<string, Promise<Snapshot | null>>()` to deduplicate concurrent file reads. In contrast, `g2p.ts` directly awaits `readFile(target, 'utf8')` without in-flight tracking whenever `cached` is null. When multiple concurrent requests hit `/api/v1/evidence-context/:gene` on server cold-start, multiple 2MB disk reads and JSON parsing passes run in parallel.
* **Impact:**
  Unnecessary disk I/O, event loop contention, and memory spikes under load.
* **Precise Fix:**
  Implement the flight-map pattern in [`server/services/evidence-context/g2p.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/evidence-context/g2p.ts):
  ```ts
  const flights = new Map<string, Promise<G2pSnapshot | null>>();
  // If flight exists, return flights.get(target)!; otherwise set and clean up in finally.
  ```

---

### Defect 4: Selection Identity Invalidation on Progressive Pipeline Hydration
* **File & Line:** [`src/shared/evidenceContextIdentity.ts:2-10`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/shared/evidenceContextIdentity.ts#L2-L10) and [`src/stores/slices/evidenceContextSlice.ts:22-31`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/stores/slices/evidenceContextSlice.ts#L22-L31)
* **Root Cause:**
  `evidenceContextIdentity` constructs a 7-tuple key: `[gene, uniprotId, variant, transcriptId, uniprotIsoform, resolvedAssembly, liftedGenomicCoordinates]`. In the frontend application lifecycle, initial rendering often occurs with `gene`, `uniprotId`, and `variant` before background genomic liftover and transcript selection resolve. When `transcriptId` or `liftedGenomicCoordinates` arrive, the generated `key` changes. Because `loadPhenotypeSelection(key)` looks up the exact string in `sessionStorage` and `store.phenotypeSelections`, any disease or review system selections made prior to coordinate resolution become orphaned under the initial partial key.
* **Impact:**
  User selections appear to spontaneously reset as the underlying variant pipeline finishes annotating coordinates.
* **Precise Fix:**
  In [`src/stores/slices/evidenceContextSlice.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/stores/slices/evidenceContextSlice.ts), support fallback resolution by core identity `[gene, uniprotId, variant]` if the exact 7-tuple key is empty, or migrate stored selections forward when the composite key is refined.

---

### Defect 5: Missing Request Cancellation / AbortController in Client Hook
* **File & Line:** [`src/hooks/useEvidenceContext.ts:19-55`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/hooks/useEvidenceContext.ts#L19-L55)
* **Root Cause:**
  `loadDisease`, `loadExpression`, and `loadDevelopment` do not pass `AbortSignal` to `fetchWithAuth`. When a user rapidly switches between variants or genes, previously dispatched HTTP requests cannot be canceled. When they settle late, they can cause stale state writes or throw errors against closed-over variables.
* **Impact:**
  Wasted bandwidth, network race conditions, and uncoordinated state transitions.
* **Precise Fix:**
  Attach an `AbortController` in `useEffect` and supply `options.signal` to `fetchWithAuth`:
  ```ts
  useEffect(() => {
    const controller = new AbortController();
    // pass { signal: controller.signal } into fetch calls
    return () => controller.abort();
  }, [gene, expression]);
  ```

---

### Defect 6: Accessibility (a11y) & Semantic Labeling Deficiencies
* **File & Line:**
  1. [`src/components/evidence/MechanismContextCard.tsx:23-28`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/evidence/MechanismContextCard.tsx#L23-L28)
  2. [`src/components/evidence/ExpressionModelsTab.tsx:47`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/evidence/ExpressionModelsTab.tsx#L47)
  3. [`src/components/inspector/EvidenceContextRail.tsx:34`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/inspector/EvidenceContextRail.tsx#L34)
* **Root Cause:**
  1. `MechanismContextCard`: The `<section className="ctx-card">` lacks an `aria-labelledby` attribute linked to its `<h2>Disease mechanism</h2>` heading. In addition, external links to Gene2Phenotype and PubMed lack screen-reader text indicating that they open in a new window (`(opens in new window)` or `aria-label`).
  2. `ExpressionModelsTab`: The `<label className="ctx-onset">Disease onset <select ...>` nests the `<select>` without an explicit `id` and `htmlFor`, degrading compatibility with certain screen readers.
  3. `EvidenceContextRail`: Line 34 renders `ENGINE_STATE_LABELS['not-installed']` when `state.diseaseContexts[gene]` is simply uninitialized/idle (`undefined`), falsely declaring the backend service "not installed" rather than "pending" or "idle".
* **Impact:**
  WCAG 2.1 AA screen-reader audit failures; false status messaging to researchers.
* **Precise Fix:**
  Add `useId()` and `aria-labelledby` to `MechanismContextCard.tsx`; add explicit `id`/`htmlFor` to the onset label in `ExpressionModelsTab.tsx`; distinguish `undefined` (idle/loading) from `not-installed` in `EvidenceContextRail.tsx`.

---

## 3. Planned Limitations vs Unsafe Bugs

The audit distinguishes between unfinished planned integrations (documented in proposals) and functional defects:

| Category | Item | Classification | Analysis & Documentation Evidence |
| :--- | :--- | :--- | :--- |
| **Ontology** | HPO Term Suggestions & Auto-acceptance | **Planned Limit** | Documented in [`doc/GENE_DISEASE_PROPOSAL.md`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/doc/GENE_DISEASE_PROPOSAL.md). UI displays placeholder: *"HPO disease suggestions are not installed yet. They will appear separately and require your acceptance."* |
| **Model Organisms** | Mouse (MGI) & Zebrafish (ZFIN) | **Planned Limit** | Documented in [`doc/EXPRESSION_AND_MODELS_PROPOSAL.md`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/doc/EXPRESSION_AND_MODELS_PROPOSAL.md). Explicitly staged behind gene-disease validity; UI denotes as *"Coverage still to add"*. |
| **Transcript Resolution**| Transcript-level `pext` (proportion expressed) | **Planned Limit** | Documented in [`doc/EXPRESSION_AND_MODELS_PROPOSAL.md`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/doc/EXPRESSION_AND_MODELS_PROPOSAL.md). Awaits canonical MANE / Ensembl transcript-level exon mapping pipeline integration. |
| **Dosage Sensitivity** | ClinGen Dosage Sensitivity Curation | **Planned Limit** | Staged for future sprint; UI card explicitly indicates that dosage sensitivity is not integrated and cannot substitute for missense mechanisms. |
| **Reporting** | Main PDF / Session Report Exporter Integration | **Planned Limit** | [`src/shared/reportDocument.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/shared/reportDocument.ts) currently serializes insights, biophysics, stability, and predictors. Context integration is planned for subsequent sprint (Phase 4 durable export). |

---

## 4. Scientific Integrity & Data Reconciliations

### 1. dGTEx V1 Public Artifacts & Sample Reconciliation
* **Public Matrix Verification:**
  - **332 Eligible RNA-Seq columns** exactly match public metadata samples where `SMAFRZE == 'RNASEQ'`.
  - **379 Announced Samples** in the release metadata are accounted for:
    $$\text{Eligible RNA-Seq (332)} + \text{Excluded Samples (10)} + \text{WGS Samples (37)} = 379 \text{ Metadata Samples}$$
  - **34 Donors** are represented across the 332 RNA-Seq samples, out of 40 total subjects in the release (6 subjects lacked eligible RNA-Seq libraries).
* **Two-Stage Donor-Weighted Medians:**
  In [`scripts/evidence_context/dgtex.py:75-81`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/scripts/evidence_context/dgtex.py#L75-L81):
  ```python
  def donor_medians(values, groups):
      result = []
      for members in groups:
          donors = defaultdict(list)
          for index, donor in members:
              donors[donor].append(values[index])
          result.append(statistics.median(statistics.median(v) for v in donors.values()))
      return result
  ```
  Within each tissue and public age cohort, multiple biopsies or technical repeats from a single donor are first collapsed into that donor's median. The cross-cohort metric is the median of those per-donor values. This prevents repeat samplings from a single infant donor from dominating the tissue estimate.
* **Cohort Bins vs Clinical Onset:**
  Public age cohort bins (1: Infant 0–2y, 2: Early Childhood 2–8y, 3: Pre-pubertal 8–13y, 4: Post-pubertal 13–18y) are descriptive source strata. They are never mapped or inferred as clinical disease onset. The UI explicitly separates the age cohort filter from clinical onset.

### 2. Gene2Phenotype (G2P) Mechanism Evidence vs Experimental Validation
* **Support Basis vs Assays:**
  G2P records carry molecular mechanism tags (e.g. `loss of function`, `gain of function`, `dominant negative`) with `support` levels (`inferred`, `curated`). The UI and contracts explicitly state that G2P mechanism support does **not** establish a validated experimental assay for the variant under review.
* **Strict Join Semantics (No Fuzzy Merges):**
  Joins between GenCC frames and G2P mechanism records strictly require identical HGNC IDs and MONDO IDs (`r.geneId === frame.geneId && r.diseaseId === frame.diseaseId`). No string-distance matching, fuzzy disease name merges, or synonym expansions are permitted.
* **Allelic Scoping:**
  Display mapping compares only `HP:0000006` (Autosomal dominant) $\leftrightarrow$ `monoallelic_autosomal` and `HP:0000007` (Autosomal recessive) $\leftrightarrow$ `biallelic_autosomal`. Records with unresolved allelic scope or custom modifiers (`restricted mutation set`) are presented in a separate collapsible disclosure with clear caveats.

### 3. Complete ACMG Engine Insulation
* Neither [`server/services/prediction/acmg/criteria.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/prediction/acmg/criteria.ts) nor [`src/shared/acmgClassifier.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/shared/acmgClassifier.ts) imports or references any evidence context modules.
* Evidence context is strictly marked **"Context only"** and provides zero votes to the ACMG criteria engine.

---

## 5. Verification & Test Suite Execution Status

The unit test suites across shared logic, React components, hooks, stores, and Python import scripts were executed in read-only mode:

1. **TypeScript / Vitest Unit Tests:**
   * Command: `npm test -- --run src/shared/__tests__/evidenceContext.test.ts src/components/__tests__/EvidenceContextTabs.test.tsx src/hooks/useEvidenceContext.test.ts src/stores/slices/evidenceContextSlice.test.ts`
   * **Result:** **18 passed (18 total)** across 4 test suites (duration: 2.08s).
2. **Python dGTEx Import Validation:**
   * Command: `python -m unittest discover -s scripts/evidence_context -p test_dgtex.py`
   * **Result:** **4 passed (4 total)** in 0.051s. Confirmed donor-median math, column reconciliation, and non-destructive atomic SQLite generation.
3. **Local Snapshots Verification:**
   * Verified presence and integrity of:
     - [`data/dgtex-context.sqlite`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/data/dgtex-context.sqlite) (74.8 MB)
     - [`data/gencc-context.json`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/data/gencc-context.json) (11.7 MB)
     - [`data/g2p-context.json`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/data/g2p-context.json) (1.98 MB)

All findings have been logged without modifying any repository files or launching the dev server.
