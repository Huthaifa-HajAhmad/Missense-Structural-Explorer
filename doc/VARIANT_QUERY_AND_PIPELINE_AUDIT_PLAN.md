# Variant Query Page & Pipeline Architecture — Complete Independent Execution Blueprint

> [!IMPORTANT]
> **Purpose**: This document is a 100% self-contained, zero-rediscovery engineering blueprint for executing all **22 findings** across the Variant Query Page UI/UX, Variant Input Grammar & Clinical Resolver, Option C Local `dbNSFP v5` SQLite Streaming Pipeline, EBI ProtVar FoldX v5.0 Integration, and OCI VM Disk/Data Operations.
> Another agent can pick up this file and execute every workstream directly without re-scanning the codebase.
> Also mirrored in the repository at [`doc/VARIANT_QUERY_AND_PIPELINE_AUDIT_PLAN.md`](file:///c:/Users/HSA19/antigravity/Missense-Structural-Explorer/doc/VARIANT_QUERY_AND_PIPELINE_AUDIT_PLAN.md).

---

## 0. Current Workspace & OCI VM State (Verified)

### Concurrent Uncommitted Work to Preserve
Another session has uncommitted work in the working tree on `Expression` / `Energetics` files (`src/components/evidence/*`, `src/components/energetics/*`, `src/components/inspector/*`, `src/styles/energetics.css`, `src/styles/expression.css`). **Do NOT revert or touch those files.** All files in this blueprint are strictly disjoint from that work.

### Local & OCI VM Data State (Already Investigated)
- **Local `data/dbnsfp_v5.sqlite`**: `0 bytes` (empty placeholder).
- **OCI VM (`ubuntu@92.5.173.166`, SSH key `$env:USERPROFILE\.ssh\id_oci_ed25519`, repo `~/Missense-Structural-Explorer`)**:
  - Root volume `/dev/sda1`: `193 GiB` total, `147 GiB` used, **`46 GiB` free** (`77%`).
  - **CRITICAL DISK finding**: `docker system df` on the VM shows **`94.82 GB` in Docker Build Cache (`71.04 GB` reclaimable)** and **`11.24 GB` in reclaimable Docker images**! Running `docker builder prune -af` on the VM will instantly free **~71 GB** of disk space while keeping `deploy/rollout.py`'s mandatory `20 GiB` free-space guard (`MSE_MIN_FREE_DISK_MB = 20480` in `deploy/ROLLOUT.md`) completely safe.
  - `~/Missense-Structural-Explorer/data/dbnsfp_v5.sqlite` on the VM is currently **`0 bytes`**.
  - `~/Missense-Structural-Explorer/data/df_rasp_gnomad_clinvar.sqlite` (`18 GB`) is populated and live, alongside a leftover raw `df_rasp_gnomad_clinvar.csv` (`395 MB`) that can be removed if desired.

---

## 1. Parallel Subagent Workstream Partitioning (Strict Disjoint File Ownership)

If delegating to subagents, **use `Model: "flash"`** (not `"inherit"`) when you want subagents to draw from the separate Flash quota pool rather than the primary Pro quota pool, and enforce these **strictly non-overlapping file boundaries**:

| Workstream | Owned Files (Exclusive) | Findings Covered |
| :--- | :--- | :--- |
| **Workstream 1: UI/UX & Telemetry** | `src/components/telemetry/LiveTelemetryPanel.tsx`<br>`src/components/VariantSearchPanel.tsx`<br>`src/styles/query.css`<br>`src/shared/workflowStatus.ts`<br>`src/tests/VariantSearchPanel*.test.tsx` | `UI-1`, `UI-2`, `UI-3`, `UI-4`, `UI-5`, `UI-6`, `UI-7`, `UI-8`, `PIPE-1`, `PIPE-2`, `PIPE-4` |
| **Workstream 2: Grammar, Resolver & Dedup** | `src/shared/variantNotation.ts`<br>`src/shared/variantCoordinate.ts`<br>`src/services/pipeline/notationService.ts`<br>`src/services/pipeline/workflowOrchestrator.ts`<br>`server/services/translation/coordinate-resolver.ts`<br>`server/services/translation/protein-numbering.ts`<br>`server/routes/variant/variant-parser.ts`<br>`src/tests/variantNotation.test.ts` | `GRAM-1`, `GRAM-2`, `GRAM-3`, `GRAM-4`, `GRAM-5`, `GRAM-6`, `GRAM-7`, `ARCH-1`, `ARCH-2` |
| **Workstream 3: Local `dbNSFP`, ProtVar & Diagnostics** | `tools/ingest_dbnsfp.ts`<br>`server/services/prediction/dbnsfp_local.ts`<br>`server/services/prediction/predictors/vep-orchestrator.ts`<br>`server/services/prediction/predictors/conservation-orchestrator.ts`<br>`server/services/external-api/protvar.ts` (new)<br>`server/services/stability/energy-models.ts`<br>`server/services/orchestration/analysis-orchestrator.ts`<br>`server/routes/health.ts`<br>`server/tests/*.test.ts` | `ARCH-3`, `PIPE-3`, Option C Local `dbNSFP` + ProtVar FoldX v5.0 |

---

## 2. Workstream 1 — Variant Query Page UI/UX & Telemetry (Exact File & Line Specs)

### 2.1 `src/components/telemetry/LiveTelemetryPanel.tsx` (`UI-1`, `UI-2`, `PIPE-2`, `PIPE-4`)
- **[ ] `UI-1` & `UI-2`: Fix Double Arrow + Chevron (`→  >`) Collision and Row-Click Hijacking (`lines 629–735` & `lines 905–1016`)**:
  - **Root cause**: Four items in `modelItems` (`alphagenome` at line 638, `gemini` at line 656, `foldx` at line 676, `p2rank` at line 700) define BOTH `onAction: () => handleConfigure("connections")` AND `explain` (`isExpandable = true`). Inside `renderServiceRow` (`lines 905–1016`):
    1. When `rowAction` is truthy (`const rowAction = svc.onAction`), line 940 renders an invisible `<button onClick={rowAction} className="absolute inset-0 rounded-none ... z-0" />` over the entire row, hijacking clicks to open the Settings modal instead of expanding the inline explanation drawer!
    2. Line 981 renders `<ArrowRight className="w-3.5 h-3.5 ..." />` (`→`) when `rowAction` is set, AND line 993 renders `<button onClick={() => toggleExpanded(svc.id)}><ChevronDown className="-rotate-90" /></button>` (`>`) when `isExpandable` is true—producing the `→  >` double icon defect in the right gutter.
  - **Exact fix**:
    1. Remove `onAction: () => handleConfigure("connections")` from `foldx` (line 676) and `p2rank` (line 700). They are server-side binaries (`tools/foldx`, `Java 17+`), not configurable in client `Settings -> Connections`.
    2. In `renderServiceRow` (`lines 905–1016`):
       - When `isExpandable` is `true`, clicking the primary row MUST toggle the inline explanation (`onClick={() => toggleExpanded(svc.id)}`), and the right gutter MUST render **only** the single disclosure chevron (`<ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-150", isExpanded ? "rotate-0" : "-rotate-90")} />`). Never render `<ArrowRight />` alongside `<ChevronDown />`.
       - When `svc.onAction` is defined (`alphagenome`, `gemini`), render an explicit, focusable action button inside the expanded explanation drawer (`isExpanded && svc.onAction`)—e.g., `"Configure connection →"`—and optionally a small `relative z-10` pill button when unconfigured (`svc.status === "standby"`), without covering the row with an `absolute inset-0` overlay or rendering a second arrow icon.
- **[ ] `PIPE-4`: AlphaGenome Client Key Readiness (`lines 629–641`)**:
  - **Root cause**: `const agReady = ag?.healthy || (hasAlphaGenomeKey && ag?.status !== "offline")` evaluates to `false` when the user configures an AlphaGenome key in the browser (`hasAlphaGenomeKey === true`), because the server's `/api/v1/diagnostics` sets `alphagenome.status = "offline"` when the server env var `ALPHAGENOME_API_KEY` is unset (`server/routes/health.ts#L194`: `status: process.env.ALPHAGENOME_API_KEY ? 'online' : 'offline'`, `message: 'Standby (API Key Required)'`).
  - **Exact fix**: Treat `agServerOffline` as `ag?.status === "offline" && !ag?.message?.includes("API Key Required")`. When `hasAlphaGenomeKey` is `true` and the server is only reporting `"Standby (API Key Required)"`, set `agReady = true`, `status: "ready"`, and `detail: "API key configured"` (`badge: "Active"`).
- **[ ] `PIPE-2`: Surface Backend Data & Variant Resolution Coverage Clearly (`lines 566–626`)**:
  - Update the `serviceItems` descriptions/details in `LiveTelemetryPanel.tsx` so `ensembl` (`"VEP, coordinate & cDNA translation"`), `gnomad` (`"Allele frequencies & constraint"`), and `uniprot` (`"Canonical sequences, AFDB & PDB structures"`) accurately reflect the probed backend services without lengthening the right-hand panel.

### 2.2 `src/components/VariantSearchPanel.tsx` & `src/styles/query.css` (`UI-3`–`UI-8`, `PIPE-1`)
- **[ ] `UI-3`, `UI-4`, `UI-5`: Preserve & Perfect Eye-Rest Horizontal Alignment Across the Two `<fieldset>` Columns (`lines 1236–1441`)**:
  - Keep the 2-column grid (`grid-cols-1 lg:grid-cols-2`, equal card height, matched horizontal row baselines) while fixing the semantic inversion:
    - **Left `<fieldset>` (`Gene & protein change`)**:
      - **Row 1**: `Gene symbol *` (`#query-gene`, `h-10` input).
      - **Row 2**: `Protein or cDNA notation *` (`#query-variant`, `h-10` input) + `<ExampleRow group={NOTATION_EXAMPLE_GROUPS[0]} />` (`Try 1-letter R116G · More formats`).
      - **Row 3**: Move the **UniProt accession** disclosure/input (`#query-reference`, currently at lines `1397–1436` in the right fieldset) here into Row 3 of the left fieldset, separated by `pt-3 border-t border-[var(--border-subtle)]`.
      - **Fix `UI-5` (`FieldLabel` badge + action collision)**: When `referenceOpen` is `true` and `action={<button>Hide</button>}` is passed to `FieldLabel`, do NOT pass `badge={uniprotBadgeNode}` into the same `FieldLabel` header slot; instead render `uniprotBadgeNode` inside the input's right adornment or below the input so `Format OK` and `Hide` never collide.
    - **Right `<fieldset>` (`Or use coordinates`)**:
      - **Row 1**: `Reference build` (`GRCh38 / hg38` | `GRCh37 / hg19` segmented toggle, explicitly `h-10` so its horizontal baseline matches `Gene symbol *` `h-10` on the left).
      - **Row 2**: `Genomic coordinates` (`#query-genomic`, `h-10` input, matching `Protein or cDNA notation *` on the left) + `<ExampleRow group={NOTATION_EXAMPLE_GROUPS[1]} />` (`Try coordinates 20-23365054-G-A · More coordinate formats`) placed **directly beneath `#query-genomic`**!
      - **Row 3 (`UI-4` Mutual-Exclusion / Route Status Strip)**: Separated by `pt-3 border-t border-[var(--border-subtle)]` to match Row 3 (`UniProt accession`) on the left for eye-rest symmetry:
        - When **both** `customVariant.trim()` and `customGenomic.trim()` are non-empty, display an amber warning banner: `"Coordinate route active — left-hand protein/cDNA input will be ignored"` with a 1-click `"Clear coordinate"` button (`onClick={() => setCustomGenomic("")}`).
        - When only `customGenomic.trim()` is populated, display `"Coordinate route active — gene & canonical protein will be derived automatically"`.
        - When `customGenomic.trim()` is empty, display a quiet helper matching the single-line height of the collapsed `+ Specify UniProt accession (optional)` trigger on the left: `"Maps chr-pos-ref-alt, VCF rows, or rsIDs to canonical protein."`
- **[ ] `UI-6`: Fix `cdna` History Routing & Bare `c.` Gene Requirement (`lines 785–805` & `lines 945–955`)**:
  - In `runFromHistory` (`lines 785–805`): only route `entry.kind === "genomic"` to `setCustomGenomic(entry.query)`. When `entry.kind === "cdna"`, route it to `setCustomVariant(entry.query)` (the left field, which is explicitly labeled `"Protein or cDNA notation *"`).
  - In `isGeneRequired` (`lines 945–955`):
    ```ts
    const isBareCdna =
      variantClassification.kind === "cdna" &&
      variantClassification.cdnaReferenceProblem === "missing-transcript";
    const isGeneRequired =
      !genomicProvided &&
      (!variantProvided || variantClassification.kind === "protein" || isBareCdna);
    ```
    And update the bare-`c.` validation message in `VariantSearchPanel.tsx` (`lines 998–1007`) so when `isBareCdna` is true and `customGene.trim()` is empty, it prompts `"Enter a gene symbol above (e.g. NAE1) or prefix with a transcript accession (e.g. NM_003905.4:c.347A>G)."`, and when `customGene.trim()` IS provided, it shows a valid/resolvable state!
- **[ ] `UI-7`: Benchmark Cards Direct Run Affordance (`lines 1538–1647`)**:
  - On the 4 Benchmark cards shown when `history.length === 0`, add a clear `"Run benchmark →"` action or run the preset directly (`onSelectPreset(preset, { autoRun: true })`) with a secondary `"Fill only"` or make the card click execute consistently with `Recent analyses`.
- **[ ] `UI-8`: Keyboard Shortcut Hint Always Visible in Footer (`lines 1496–1521`)**:
  - Render `<span className="query-ShortcutHint"><kbd>Enter</kbd> runs from a query field</span>` unconditionally in the footer status strip (even when `!hasConfiguredGeminiKey`, alongside the `"AI summary on demand"` note).
- **[ ] `PIPE-1`: Pipeline Stage Count & `multimer`/`ppi` Completion Tracking (`src/shared/workflowStatus.ts#L48-L95` & `VariantSearchPanel.tsx#L1741`)**:
  - In `src/shared/workflowStatus.ts` (`getWorkflowStageStatus`, lines 77–81): Stage 5 (`id === 5`) currently only returns `pipelineStages.structural`. Update it to aggregate `structural`, `multimer`, and `ppi`:
    - If any of `structural`, `multimer`, or `ppi` is `"running"`, return `"running"`.
    - Otherwise return `pipelineStages.structural` (so Stage 5 stays `"running"` while `multimer` or `ppi` is still in flight, matching `isPipelineActive` in `VariantSearchPanel.tsx#L683`).
  - In `VariantSearchPanel.tsx` (`line 1741`): change the idle Pipeline tab badge from `{WORKFLOW_STAGES.length} stages` (`7 stages`) to `6 core · 1 on-demand` so the denominator never jumps from `7` to `6 of 6 settled`.

---

## 3. Workstream 2 — Extended Variant Input Grammar, Clinical Resolver & Request Deduplication

### 3.1 `src/shared/variantNotation.ts` & `src/shared/variantCoordinate.ts`
- **[ ] `GRAM-2`: Parenthesized HGVS Protein Predictions (`p.(Asp116Gly)`, `p.(D116G)`)**:
  - In `src/shared/variantNotation.ts` (`HGVS_PATTERN`, line 52) and `src/shared/variantCoordinate.ts` (`parseVariantCoordinate`, line 84), allow optional matching parentheses around the substitution body after `p.`:
    - Strip balanced outer parentheses in `p.(...)` before matching, while rejecting unbalanced parentheses (`p.(Asp116Gly` or `p.Asp116Gly)`).
    - Normalize `p.(Asp116Gly)` and `p.(D116G)` to `p.Asp116Gly`.
- **[ ] `GRAM-3`: Ensembl Protein Accessions (`ENSP00000369497.3:p.Val600Glu`)**:
  - In `src/shared/variantNotation.ts` (`PROTEIN_ACCESSION_GROUP`, line 181), add `|ENSP\\d+(?:\\.\\d+)?` so `ENSP` accessions are recognized as `accessioned-protein` with `requiresTranslation: true`.
  - In `server/services/translation/protein-numbering.ts` (`resolveAccessionedProteinNotation`, line 640), add an `ENSP` branch (`/^(?:ENSP\d+)/i.test(accession)`) that resolves the Ensembl protein via Ensembl VEP (`https://rest.ensembl.org/vep/human/hgvs/${encodeURIComponent(`${accession}:${proteinNotation}`)}?content-type=application/json&mane=1&uniprot=1`) or UniProt (`xref:ensembl-${accession.split('.')[0]}`) to canonical UniProt ID, gene symbol, and canonical protein coordinate.
- **[ ] `GRAM-4`: Colon-Separated & VCF-Style Genomic Coordinates**:
  - In `src/shared/variantNotation.ts` (`parseGenomicNotation`, lines 318–390):
    - Support colon-separated genomic coordinates: `chr20:23365054:G:A`, `20:23365054:G:A`, `chr20:23365054:G>A`, `20:23365054:G/A`.
    - Support whitespace/tab-separated 4-column (`CHROM POS REF ALT`) and 5-column VCF rows (`CHROM POS ID REF ALT`, e.g., `20 23365054 . G A` or `chr20 23365054 rs121913529 G A`).
    - Normalize all of them to `chrom-pos-ref-alt` (`20-23365054-G-A`).
- **[ ] `GRAM-5`: dbSNP `rsID` (`rs121913529`) & ClinVar `VCV` (`VCV000013961`)**:
  - In `src/shared/variantNotation.ts` (`classifyNotation`):
    - Recognize `/^rs\d+$/i` (normalize to lowercase `rs\d+`, `kind: "genomic"`, `isValid: true`, `requiresTranslation: true`).
    - Recognize `/^VCV\d+(?:\.\d+)?$/i` (normalize to uppercase `VCV\d+`, `kind: "genomic"`, `isValid: true`, `requiresTranslation: true`).
  - In `server/services/translation/coordinate-resolver.ts` (`resolveCoordinateNotation`, line 684):
    - Add a branch for `/^rs\d+$/i`: call Ensembl VEP `GET https://rest.ensembl.org/vep/human/id/${encodeURIComponent(rsId)}?content-type=application/json&mane=1&uniprot=1&hgvs=1`, select the canonical/MANE `missense_variant` transcript consequence, and pass it through the existing `resolveFromVepConsequences` pipeline!
    - Add a branch for `/^VCV\d+/i`: query NCBI ClinVar `esummary` (`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id=${vcvNumericId}&retmode=json`) to extract the canonical GRCh38 `chr-pos-ref-alt` or HGVS string, and pass it into `resolveCoordinateNotation`.
- **[ ] `GRAM-6`: In-Frame 2–3 bp `delins` Single-AA Missense (`NM_004333.6:c.1799_1800delinsAA`)**:
  - In `src/shared/variantNotation.ts` (`GENOMIC_OR_CDNA_NON_SUBSTITUTION_PATTERN`, line 226): before rejecting `delins`, check if it is an in-frame 1–3 bp `delins` (`/(?:c\.|g\.)(\d+)(?:_(\d+))?delins([ACGT]{1,3})$/i` where span `end - start + 1 === inserted.length`). Allow such in-frame `delins` notations through `classifyNotation` as valid `cdna`/`genomic` (`requiresTranslation: true`), letting Ensembl VEP in `coordinate-resolver.ts` verify whether the consequence is a single amino-acid `missense_variant`.
- **[ ] `GRAM-1` & `GRAM-7`: Bare `c.` + Gene Symbol (`NAE1` + `c.347A>G`) and Version-Tolerant Transcript Fallback (`NM_004333.4:c.1799T>A`)**:
  - In `src/services/pipeline/notationService.ts` (`translateVariantNotation`) and `src/services/pipeline/workflowOrchestrator.ts` (line 245): pass `gene: targetGene` in the JSON body of `POST /api/v1/translate-variant`.
  - In `server/routes/variant/variant-parser.ts` (or `/api/v1/translate-variant` route handler) and `server/services/translation/coordinate-resolver.ts`:
    - When `notation` is bare `c.<pos><ref>><alt>` and `gene` is provided, rewrite the VEP query input to `${gene.trim()}:${notation.trim()}` (or accept `GENE:c.347A>G` directly in `classifyNotation` and `coordinate-resolver.ts`). Ensembl VEP `/vep/human/hgvs/NAE1:c.347A>G` natively resolves across the gene's transcripts and selects MANE Select!
    - In `coordinate-resolver.ts` (`queryEnsemblVepHgvs`): if a versioned RefSeq/Ensembl transcript (`NM_004333.4:c.1799T>A` or `ENST00000288602.6:c.1799T>A`) returns HTTP 400 from Ensembl VEP, automatically strip the `.version` (`NM_004333:c.1799T>A`) and retry VEP once before failing.
- **[ ] `ARCH-1`: Deduplicate `validateAndParseVariantRequest` Across `/stream`, `/landscape`, `/structural`**:
  - In `server/routes/variant/variant-parser.ts`, wrap the expensive resolution step inside `validateAndParseVariantRequest` in a 60-second TTL in-memory cache (`Map<string, Promise<ValidatedVariantRequest>>` keyed by `${gene}|${variant}|${structureData ? 'custom' : ''}|${uniprotId ?? ''}|${genomicCoordinates ? JSON.stringify(genomicCoordinates) : ''}`) so the 3 parallel requests fired by the frontend share a single in-flight UniProt + numbering resolution promise.
- **[ ] `ARCH-2`: Forward `X-Structure-Ref` from `fetchPdbCoordinates`**:
  - In `src/services/pipeline/workflowOrchestrator.ts` (`fetchPdbCoordinates`, line 48), read `res.headers.get("X-Structure-Ref")` and return `{ pdbText, structureRef }`, passing `structureRef` into downstream calls.

---

## 4. Workstream 3 — Option C: Space-Efficient Local `dbNSFP v5` SQLite + EBI ProtVar FoldX v5.0 + Diagnostics

### 4.1 Upgrade `tools/ingest_dbnsfp.ts` & `server/services/prediction/dbnsfp_local.ts` (`ARCH-3`)
- **[ ] Native `.gz` / `.bgz` Streaming & `--delete-after-ingest` in `tools/ingest_dbnsfp.ts`**:
  - Detect `.gz` / `.bgz` inputs and pipe `fs.createReadStream(filePath).pipe(zlib.createGunzip())` into `readline.createInterface` so raw 130 GB unzipped files never touch disk.
  - Accept multiple file arguments (or a directory/glob of `dbNSFP5*_variant.chr*.gz`) plus `--delete-after-ingest`: after each chromosome file's transaction commits, run `db.pragma('wal_checkpoint(TRUNCATE)')` and `fs.unlinkSync(filePath)` if `--delete-after-ingest` is set.
  - Defer index creation until **after** all chromosome files are ingested, and include all 4 indexes:
    ```sql
    CREATE INDEX IF NOT EXISTS idx_gene_pos ON variant_scores (gene, pos);
    CREATE INDEX IF NOT EXISTS idx_pos_ref_alt ON variant_scores (pos, aaref, aaalt);
    CREATE INDEX IF NOT EXISTS idx_variant_scores_gene_pos_ref_alt ON variant_scores (gene, pos, aaref, aaalt);
    CREATE INDEX IF NOT EXISTS idx_dbnsfp_genomic ON variant_scores (chr, pos_genomic, ref, alt);
    ```
  - Only store the exact columns used by the workspace (`gene`, `chr`, `pos_genomic`, `transcript`, `aaref`, `aaalt`, `pos`, `ref`, `alt`, `aa_change`, `revel`, `alphamissense`, `gerp`, `phylop`, `bayesdel`, `metarnn`, `clinpred`, `dann`, `eigen`, `esm1b`, `popeve`, `cadd`, `gnomad_ac`, `gnomad_an`, `gnomad_hom`, `aou_ac`, `aou_an`, `aou_het`, `aou_hom`), rounding floats to 4 decimal places.
- **[ ] Auto-Detect Populated `data/dbnsfp_v5.sqlite` in `server/services/prediction/dbnsfp_local.ts`**:
  - In `isLocalDbnsfpAvailable()` (`line 62`): only return `false` immediately if `process.env.ENABLE_LOCAL_DBNSFP === 'false'`. When `ENABLE_LOCAL_DBNSFP` is unset or `'true'`, check `fs.existsSync(dbPath)` and `stat.size > 4096` (or `> 1024` when `ENABLE_LOCAL_DBNSFP === 'true'` for test fixtures), and verify `SELECT 1 FROM variant_scores LIMIT 1` succeeds.
  - Export `inspectLocalDbnsfpFile()` for `/api/v1/capabilities` and `/api/v1/diagnostics`.

### 4.2 Wire Local `dbNSFP` into `vep-orchestrator.ts` & `conservation-orchestrator.ts`
- **[ ] `server/services/prediction/predictors/vep-orchestrator.ts`**:
  - In `fetchPredictorsViaCoordinate` (`line 351`): check `queryLocalDbnsfpByGenomic(lifted.chrom, lifted.pos, lifted.ref, lifted.alt)` first when `isLocalDbnsfpAvailable()` is true.
  - In `fetchPredictorsFallback` (`lines 461–490`): when `queryLocalDbnsfpVariant` returns `localData` with `chr`, `pos_genomic`, `ref`, and `alt`, populate `gnomadVariantId = "${localData.chr}-${localData.pos_genomic}-${localData.ref}-${localData.alt}"`, `gnomadVariantAssembly = "GRCh38"`, and `caddPhred = safeParseFloat(localData.cadd)`, and **skip calling `myvariant.info`** if `localData` already resolved the scores and coordinate!
- **[ ] `server/services/prediction/predictors/conservation-orchestrator.ts`**:
  - In `fetchConservationDataProgressive` (`lines 955–971`): extract `const gnomadVariantId = predMeta?.gnomadVariantId ?? null;` from `predictorPromise` alongside `coordinateAssembly`, and pass `gnomadVariantId` as the 6th argument to `fetchConservationData(...)` instead of hardcoded `null`!

### 4.3 EBI ProtVar Precomputed FoldX v5.0 Integration (`server/services/external-api/protvar.ts`)
- **[ ] Create `server/services/external-api/protvar.ts`**:
  - Verified live endpoint: `GET https://www.ebi.ac.uk/ProtVar/api/prediction/foldx/${encodeURIComponent(uniprotId)}/${pos}`
  - Verified live response schema:
    ```ts
    export interface ProtVarFoldxEntry {
      proteinAcc: string;
      position: number;
      afId: string;
      afPos: number;
      wildType: string;
      mutatedType: string;
      foldxDdg: number;
      plddt: number;
      numFragments: number;
      variantKey: string;
    }
    ```
  - Implement `fetchProtVarFoldx(uniprotId: string, pos: number, wt1: string, mut1: string, signal?: AbortSignal)` with a 30-day LRU cache (`protvarFoldxCache` registered in `defaultCacheRegistry`). Match `entry.position === pos && entry.wildType.toUpperCase() === wt1.toUpperCase() && entry.mutatedType.toUpperCase() === mut1.toUpperCase()`.
  - Wire into `server/services/stability/energy-models.ts` / `server/services/orchestration/analysis-orchestrator.ts` so when the structure is an AlphaFold monomer and local FoldX is skipped (e.g. large protein `> FOLDX_REPAIR_MAX_RESIDUES`), unavailable, or times out—or as an instant precomputed reference—ProtVar FoldX v5.0 $\Delta\Delta G$ is returned with clear provenance (`"ProtVar FoldX v5.0 (AFDB monomer)"`), adhering strictly to `.agents/rules/biophysical-engines.md`.

### 4.4 Harden `/api/v1/diagnostics` (`server/routes/health.ts`, `PIPE-3`)
- **[ ] Align `/api/v1/diagnostics` (`lines 175–217`) with `/api/v1/capabilities`**:
  - Ensure `foldxReady` in `/api/v1/diagnostics` checks `hasRotabase` (`rotabase.txt` present or linkable) and, if running the Linux x86_64 ELF on `arm64`, verifies `box64` availability (`checkBox64()`), matching `/api/v1/capabilities`.
  - Include `dbnsfp` status in `/api/v1/capabilities` / `/api/v1/diagnostics` using `inspectLocalDbnsfpFile()`.

---

## 5. OCI VM Disk Cleanup & `dbNSFP` Ingestion Steps (`ubuntu@92.5.173.166`)

1. **Reclaim ~71 GiB of Stale Docker Build Cache on the VM**:
   ```powershell
   ssh -i "$env:USERPROFILE\.ssh\id_oci_ed25519" ubuntu@92.5.173.166 "docker builder prune -af && df -h /"
   ```
   - This raises free space on `/dev/sda1` from `46 GiB` to **~`117 GiB`** (well above `deploy/rollout.py`'s `20 GiB` minimum free disk threshold).
2. **Remove Stale 0-byte `dbnsfp_v5.sqlite` Placeholder & Optional Leftover CSV**:
   - Remove the 0-byte `~/Missense-Structural-Explorer/data/dbnsfp_v5.sqlite` before running `tools/ingest_dbnsfp.ts` (or let `ingest_dbnsfp.ts` initialize the schema in place).
3. **Stream-Ingest `dbNSFP v5` Chromosome Archives with `--delete-after-ingest`**:
   - Download/stream each `dbNSFP5.3a_variant.chr*.gz` (or run `npx tsx tools/ingest_dbnsfp.ts <chr.gz> data/dbnsfp_v5.sqlite --delete-after-ingest`) one chromosome at a time on the VM so peak temporary disk usage never exceeds ~1.5 GB and the final indexed `data/dbnsfp_v5.sqlite` (~8–12 GB for the 29 workspace columns) leaves ~100+ GiB free on `/`.

---

## 6. Verification Checklist

- [ ] `npm run lint` (`check-boundaries`, `check-focus-indicators`, `check-verify-parity`, `tsc --noEmit`)
- [ ] `npx vitest run` (all unit & integration tests green)
- [ ] `npm run verify:geometry` (layout & geometry invariants preserved)
- [ ] `python -m uv tool run --from graphifyy graphify extract . --code-only` (refresh `graphify-out/graph.json`)

---

## 7. Execution Status (2026-10-16)

Implemented and tested (uncommitted). Deviations from the blueprint above are deliberate; reasons inline.

| Finding | Status | Notes |
|:---|:---|:---|
| UI-1, UI-2 | Done | Expandable rows toggle from the header; one chevron; actions live in the drawer. FoldX/P2Rank have no Settings action. |
| UI-3–UI-8 | Done | Two-column baselines kept; UniProt in left row 3; route-status strip (4 states); bare `c.` needs a gene; benchmark cards run (with "Fill form only"); Enter hint always shown. |
| PIPE-1 | Done | Re-grounded: `getWorkflowStageStatus` is view-based (no `id === 5`). Literature is on-demand (`ON_DEMAND_VIEWS`); structure stays in progress while `multimer`/`ppi` run. |
| PIPE-2 | Done | Descriptions verified against code (no gnomAD probe exists; AFDB/PDB are not UniProt). |
| PIPE-3 | Done | `server/services/stability/foldx/readiness.ts` is the one FoldX readiness rule for `/diagnostics` and `/capabilities`. |
| PIPE-4 | Done | Structured `keySource: "server" \| "none"` on the AlphaGenome health entry (no message string-matching). |
| GRAM-1 | Done, changed | `GENE:c.…` is pinned to the gene's Ensembl canonical (= MANE Select) transcript **before** VEP (`identifier-intake.ts`). Handing VEP `NAE1:c.347A>G` projects the `c.` onto ~50 transcripts at different loci (top consequence `stop_lost`). |
| GRAM-2, GRAM-4 | Done | Balanced `p.(…)`; colon/VCF/whitespace coordinates via `DASHED_GENOMIC_PATTERN`. |
| GRAM-3 | Done, changed | ENSP numbering comes from the Ensembl protein's own sequence (identity → UniProt isoform, else alignment); a UniProt xref alone is not evidence of canonical numbering. |
| GRAM-5 | Done, changed | rsID/VCV resolve to a GRCh38 coordinate at intake. Multi-allelic rsIDs (e.g. rs113488022, rs121913529) are **refused with the alleles listed**, never picked. Indel IDs → `NON_MISSENSE_VARIANT`. Response carries `inputResolution`. |
| GRAM-6 | Done | In-frame 2–3 bp `delins` admitted via `isInFrameSingleAaDelins`; VEP decides missense. |
| GRAM-7 | Done (re-evaluated) | **RefSeq:** VariantValidator resolves the *stated* version (it holds every version's sequence); its `TranscriptVersionWarning` was being dropped and is now carried as `transcriptVersionNote` and leads `transcriptWarning`. **Ensembl:** retired versions' sequences are not served anywhere (`/sequence/id/ENST….1` → not found), so no silent retry; a failure on a retired version answers `422 TRANSCRIPT_VERSION_RETIRED` with the current-version notation as a ready-to-run candidate (no `Retry-After`). |
| ARCH-1 | Done, changed | In-flight-only dedupe (`getVerifiedSequenceAndNumbering`): never touches `res`, no TTL (providers cache), failures not kept. |
| ARCH-2 | Already implemented | `structureApi.ts` parses `X-Structure-Ref` on both PDB fetches, `structureService.fetchPdbCoordinates` registers it (`structureRefRegistry`), and pocket/nearest calls send the ref instead of the text. Covered by `structureRefTransport.test.ts` and `structureService.test.ts`. The blueprint's finding was stale. |
| ARCH-3 / dbNSFP | Done | Ingest reads stdin (`unzip -p … \| ingest -`), multi-member gzip, `--skip-indexes`/`--indexes-only`, provenance in `build_meta`. Auto-detect when populated (`ENABLE_LOCAL_DBNSFP=false` still disables). `dbnsfp` in `/diagnostics`, `dbnsfp_local` in `/capabilities`. |
| Local dbNSFP in predictors | Done, changed | Exact-allele local lookup added ahead of MyVariant on the **coordinate** path (gene + substitution bound). The protein-row path still never supplies a locus/CADD (allele-ambiguity guard). |
| Conservation `gnomadVariantId` | Done (re-evaluated) | Genos and query.dbnsfp.org answer `GENE:p.…` with their FIRST row, so REVEL/BayesDel/MetaRNN/… could belong to a different allele encoding the same protein change. The GRCh38 predictor coordinate is now passed (other builds keep the protein query — both services index GRCh38 only), the protein-keyed early Genos record is not reused when the allele is known, and `coordinateEnrichmentByCaller` stops the base fetch repeating PopEVE/GPN-Star/AlphaGenome. MyVariant's tier remains protein-matched. |
| ProtVar FoldX | Done | `server/services/external-api/protvar.ts` (30-day cache). Shown as a **reference-only** energetics row (`referenceOnly` engine `protvar`): never counted, not in coverage ("N of 6"), not in the run's running/missing lists, never the rail's ΔΔG. Low-pLDDT caveat from ProtVar's own model; disagreeing AlphaFold fragment models (e.g. TTN) give no value with the reason; a different wild type gives no value. Threaded like RaSP: queue companion, cache-hit path, poll merge, `enrichBiophysicalResult` whitelist (not in consensus, not in `pendingTools`). |
| OCI VM ops | Not run | Destructive/production steps need explicit go-ahead. VM `doc/DEPLOY.md` sets `ENABLE_LOCAL_DBNSFP="false"`. |

Recommended VM ingest (after the operator's go-ahead):
```
unzip -p dbNSFP5.3a.zip dbNSFP5.3a_variant.chr1.gz | npx tsx tools/ingest_dbnsfp.ts - data/dbnsfp_v5.sqlite --version 5.3a --skip-indexes
# repeat per chromosome (names from `unzip -l`), then:
npx tsx tools/ingest_dbnsfp.ts --indexes-only data/dbnsfp_v5.sqlite
```
Licensing: `5.3a` is the academic edition; some bundled scores (e.g. CADD) are non-commercial.

### Review round 1 (2026-10-16, three Gemini 3.8 Flash reviewers; every finding re-verified before acting)

Fixed: zero gnomAD/AoU counts stored as null (pre-existing); local conservation lookup ignored the GRCh38 allele; `aaref/aaalt` read at the chosen transcript; dbNSFP path no longer published by public endpoints (file name only — RaSP's `sqlitePath` still exposes its path, pre-existing); duplicated provenance label; UniProt RefSeq/ENSP `found` mappings were never cached (pre-existing); hyphenated gene symbols (`HLA-A:c.…`) skipped the gene intake; retired-version refusal now also reads build-annotated notations; Ensembl protein sequences cached; `transcriptVersionNote` carried to the client; multi-base dashed/VCF alleles written as `delins` (indels → 422 non-missense, 2–3 bp equal-length → VEP); ProtVar cache-hit path persists answers, reports outages, passes its fields explicitly; route strip no longer claims a coordinate route for unrecognised text but still warns it overrides the protein field; form row heights reserved only while the columns are side by side (container query).

Declined, with reasons: per-query `statSync` (one syscall; a TTL would delay flag flips the tests require to be immediate); dedupe key normalisation (parallel requests share one client string); "unbounded Map caches" (already bounded LRUs); ProtVar queue position (built from the request's canonical `posNum`, and ProtVar's wild-type check guards it).

### dbNSFP 5.4a local store on the VM (2026-10-16/17)

- **First load was wrong and was discarded.** The loader did not recognise 5.4a's formats: MANE is written `Select` (not `MANE_Select`), the canonical column is `Ensembl_canonical` (not `VEP_canonical`), gnomAD is `gnomAD4.1_joint_*`, All of Us is `AllofUs_ALL_*`. Every multi-transcript row fell back to the first-listed transcript (a different residue number than MANE's in ~21% of them, e.g. IL17RA 198 vs 311) and no population counts were stored.
- **Loader fixes** (`tools/ingest_dbnsfp.ts`, tests in `tools/ingest_dbnsfp.format54a.test.ts`): reads the 5.4a columns; MANE Plus Clinical is not MANE Select; stops at the first unreadable MANE value (before any batch commits); a lone transcript is `single` before its canonical flag is read (chrM had turned the store policy `mixed`); zero counts stay 0; logs which population source it found.
- **Per-row `transcript_basis`** (mane / ensembl-canonical / single / first-listed) and exact `transcript_pick_counts` (stored rows only). Archive-wide, 4.6% of multi-transcript rows (3.8% of all) are `first-listed` because their gene lists no MANE Select or canonical transcript. **Readers never serve those rows** (`isUsableRow` in `server/services/prediction/dbnsfp_local.ts`: residue lookup, coordinate lookup and landscape), and the landscape basis is derived from the rows returned.
- **Operations:** `tools/rebuild_dbnsfp.sh` (streams `unzip -p` per chromosome, refuses to overwrite a store, never deletes the archive) and `tools/verify_dbnsfp.sh` (gates deleting the archive). Pipeline on the VM: rebuild → `PRAGMA integrity_check` (low I/O priority) → verify.
- **Production:** keep `ENABLE_LOCAL_DBNSFP=false` until the build carrying the per-row filter is deployed; with it unset, a populated store is used automatically.
