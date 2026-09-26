# Technical Architecture Design — MissenseResolve®

## 1. System Topology Overview
The **MissenseResolve®** is designed as a modular, full-stack React and Express application running on Node.js. It implements a **Server-Side API Proxy Architecture** to securely handle API keys, perform computation-heavy sequence mutations, and bypass sandbox/CORS constraints on external bioinformatics services.

```
       +-------------------------------------------------------------+
       |                     Chromium Preview Frame                   |
       |  +-----------------------+       +------------------------+  |
       |  |   Molstar 3D Canvas   |       |   React UI Components  |  |
       |  +-----------+-----------+       +-----------+------------+  |
       +--------------|-------------------------------|--------------+
                      | WebGL Operations              | JSON & PDB Buffers
                      v                               v
       +-------------------------------------------------------------+
       |                      Express API Gateway                    |
       |                      [Port 3000 ingress]                    |
       +---|------------------------|---------------------|----------+
           v                        v                     v
+----------+----------+  +----------+----------+  +-------+----------+
|  Gemini AI Engine   |  |   AlphaFold Proxy   |  |  Mutant Modeling |
|  (SDK @google/genai)|  |  EBI CDN Gateway    |  |  Engine (FoldX)  |
+---------------------+  +---------------------+  +------------------+
```

---

## 2. Front-End Core Stack
The front-end is structured as a client-side Single Page Application (SPA) compiled through Vite.

### Key Components
1. **`App.tsx` (Core State Controller)**:
   * Coordinates clinical inputs, variant presets, and active analysis statuses (`isLoading`, `error`, `result`).
   * Manages UI panels with custom spacing and negative space designed for expert readability.
2. **`components/MolstarViewer.tsx` (WebGL Viewport)**:
   * Integrates the open-source **Mol* (Molstar)** macromolecular graphics system.
   * Leverages a GPU-accelerated WebGL context to render complex PDB spatial coordinates.
   * Automatically initializes viewport states (e.g., lighting, representation models) and exposes structural selection hooks for highlighting particular amino acid indexes.

### Evidence Surface Convention (main column vs. inspector)

Every evidence tab renders into **two** surfaces: the main column (the decisive
quantities) and the right-hand inspector (the interpretation and provenance).
Read this before adding or changing anything under `components/evidence/` or
`components/inspector/`.

**1. Split by function, not by duplicating content.**

| Surface | Carries | Does *not* carry |
| :--- | :--- | :--- |
| Main column | KPI values, scales, verdicts, interactive controls | Long-form prose, methodology, provenance |
| Inspector | Interpretation prose, band explanations, glossary, limitations, provenance, copy/export | A *second derivation* of any number the main column already computes |

**2. Anything the two surfaces must agree on lives in one pure module.**
Derivations belong in `src/shared/<topic>Evidence.ts` — no React, no fetching,
no client imports — and both panes call it. Precedent:

| Topic | Shared derivation | Inspector |
| :--- | :--- | :--- |
| RNA splicing | `src/shared/splicingEvidence.ts` | `components/inspector/SplicingInspector.tsx` |
| Residue shifts & Pockets | `src/shared/residueShiftEvidence.ts` | `components/inspector/ResidueShiftInspector.tsx` |

When the derivation needs client-side inputs (a variant string to parse, a
property table), put the resolver in `src/lib/` and have every surface call the
resolver rather than the raw derivation — see `src/lib/residueShiftModel.ts`.

This is not stylistic. These surfaces have already drifted: the Insights radar
labelled an axis "Molecular Size" while the scales called the same axis "Residue
Volume / Size", and it resolved its residue pair by re-parsing the variant string
instead of reading the metadata the other two surfaces use — so for genomic or
cDNA input it rendered nothing at all while the scales showed values. A
duplicated derivation is how a UI grows two contradictory answers to one
question.

These are defaults, not prohibitions. The inspector **may** restate a number when
that number is the subject of its sentence (the P2Rank pane quotes the distance
and the ranking index because its prose is *about* them), and the main column may
carry a one-line interpretation or a caveat when the alternative is an
unexplained figure. What must not happen is a second *derivation*.

This convention is about revealing an inspector **section**. Existing
cross-pane navigation through props — `onNavigateToView` and
`onSelectEvidenceTab` — is unchanged and should not be migrated.

**3. Never render a degraded state as content.** A pipeline fallback string
(`"⚠️ **Biochemical Shift Unavailable**"`) is a *state*, not prose. Classify it
with the shared derivation and render an explicit unavailable/loading state.

**4. Cross-pane navigation goes through `src/lib/inspectorFocus.ts`.** A
main-column control that reveals an inspector section calls
`requestInspectorFocus(INSPECTOR_SECTIONS.<id>)`; the inspector owns expanding,
scrolling and focus. Section ids are declared as data in that module so a typo
cannot fail silently.

### Rendering & Geometry Management
* **Dynamic Sizing**: Rather than listening to fixed window dimensions, the viewport utilizes a `ResizeObserver` tracking the absolute dimensions of the container element, triggering `plugin.layout.setSettings` updates to prevent layout deformation.
* **Selection Highlighting**: When a residue index is specified (e.g., residue `#273` in p53), Molstar builds structured representation queries. It renders the target residue in **Ball and Stick** or **Spacefill (VDW Spheres)** representations while coloring the remaining polymer backbone in transparent cartoon ribbons or custom thematic palettes (e.g. by Hydrophobicity or PLDDT score).

---

## 3. Back-End Server Design
To bypass cross-origin browser limitations (CORS) and securely invoke analytical AI models, all external communications are routed through `/server.ts` (running inside a Node.js process).

### API Route Registry

#### A. Variant Analysis Pipeline (`POST /api/v1/analyze-variant`)
* **Inputs**: `{ gene: string, variant: string, uniprotId: string }`
* **Orchestration**: Executes parallel and cascade processing streams:
  1. **Structural Triage**: Runs a local, fast rule-based classifier (`predictStructuralDisruption`) in parallel to assess secondary structure patterns, volume changes in the hydrophobic core, and residue chemical indices.
  2. **Narrative Generation**: Round-robins the configured Gemini ladder (see `DEFAULT_GEMINI_FALLBACK_MODELS`, ordered by measured reliability and latency) with a tailored biophysical prompt to obtain detailed, professional clinical markdown.
  3. **Structured JSON Validation**: Calls the model with a defined JSON schema request, extracting `biochemicalShift`, `structuralImpact`, and structural pathogenicity `acmgCriteria` arrays containing clinical codes and reasoning.
* **Error Resilience**: Intercepts absent Gemini keys and returns a structured configuration error to the front-end, gracefully falling back to preconfigured high-fidelity clinical records (defined in `src/data.ts`) to maintain a fully interactive prototype.

#### B. Biophysical Mutant Modeling Pipeline (`POST /api/v1/generate-mutant`)
* **Inputs**: `{ wtPdb: string, mutation: string, uniprotId?: string }`
* **Process**:
  1. Writes the heavy wild-type template coordinate data block to a temporary workspace file (`wt_temp_${timestamp}_${randomId}.pdb`) to allow native CLI processors to access the coordinate matrix.
  2. Formulates localized command-line instruction files with standard biophysical mutation descriptions (e.g., `RA408W;` mapping the residue sequence).
  3. Prepares a child process execution context to run FoldX `BuildModel` across **5 stochastic runs** (`--numberOfRuns=5`, see `server/services/stability/foldx/runner.ts`) for stochastic averaging (extracting mean $\Delta\Delta G$ and standard deviation). This line previously said 3, which the code contradicts.
  4. Computes a consensus stability verdict based on FoldX and DynaMut2 ( NMA ) predictions.
  5. Calculates local sidechain packing RMSD using a physical alignment algorithm on wild-type and mutant rotamers.
  7. **Fails Loud**: In environments lacking FoldX binaries or where execution fails, the engine throws a hard `503` error instead of falling back to silent wild-type coordinate returns, ensuring data integrity.
  8. **Safe Workspace Cleanup**: Explicitly runs recursive file deletion on temporary job directories to prevent storage pollution in production containers.

#### C. Gene Accessory resolver (`POST /api/v1/resolve-gene`)
* Maps inputted gene symbols (e.g., PAH, FGFR3, GBA1, NAE1) to their canonical accession codes.
* Interrogates EBI APIs to determine structure availability and coordinate schemas.

#### D. AlphaFold Structural Proxy (`GET /api/v1/alphafold-pdb/:uniprotId`)
* Bypasses client-side issues with loading heavy bioinformatics files from varying host origins.
* Interrogates the AlphaFold DB with cascade recovery logic:
  * First queries the official EMBL-EBI Prediction API (`https://alphafold.ebi.ac.uk/api/prediction/${uniprotId}`) to fetch the official PDB structure URL.
  * If the API returns a 404, it immediately skips the search to fail fast.
  * If the API check fails to resolve but does not return a 404, or as a recovery cascade, the server tries sequential candidate URLs generated from common isoform suffixes (`-F1` down to `-1-F1`) and file versions (`v6` down to `v1`).
  * Bypasses CORS headers, pipes the raw PDB string securely back to Mol*, and validates that the payload contains proper `ATOM` structural coordinate segments to prevent corrupt renders.

---

## 4. Production Security & Deployment (SEC-5)
In production, the application is designed to be hosted in a containerized environment (e.g., Google Cloud Run) behind a secure load balancer or reverse proxy:
* **Token Authentication & Session Keys**: Access to clinical endpoints requires bearer authentication. The `/session/keys` endpoint validates API credentials and creates stateless session tokens encrypted using AES-256-GCM. These tokens contain the API credentials and an expiration time, allowing any server replica to decrypt and validate sessions using a shared `APP_SESSION_SECRET` key, avoiding in-memory session synchronization.
* **Rate Limiting & Security Headers**: Express middleware enforces standard Helmet security headers (HSTS, CSP, X-Frame-Options) and rate-limiting limits (120 requests/minute for general API and 10 requests/minute for Gemini API per IP) to prevent denial of service.
* **PII Redaction**: Free-text clinical narrative directions (`userDirections`) undergo regular-expression-based screening to redact phone numbers, emails, SSNs, dates of birth, and patient/medical record IDs before sending to third-party APIs.
* **HTTPS Enforcement**: The Node.js Express server runs on plain HTTP (port 3000) inside its isolated container or sandbox environment. Secure HTTPS/TLS termination is decoupled from the application layer and must be handled at the ingress or load balancer layer (e.g., GCP HTTPS Load Balancer) to ensure all clinical variant data in transit is encrypted.
* **Access Controls**: Production access can be secured using GCP Identity-Aware Proxy (IAP) to authenticate users via corporate Single Sign-On (SSO) before they can connect to the application.
* **Horizontal Scaling State Coordination**: All process-level transient locks (such as in-flight FoldX prewarms) are persisted in a shared SQLite database (`data/shared_state.sqlite`) using Node 22's built-in `node:sqlite` database, allowing multiple server replicas to coordinate tasks and prevent duplicate background runs without in-memory synchronization.

---

## 5. Architectural Principles: Non-Blocking Fast-Degradation Design

To ensure MissenseResolve® provides instant UI responsiveness (<1.5s initial load) even when invoking multiple third-party academic servers, external APIs, or local deep learning models, all agents and developers modifying this codebase MUST strictly follow the **Non-Blocking Fast-Degradation Principle**:

### A. Strict Timeout & Fast-Race Deadlines
- **Deep Learning Model Sidecars** (`ESM-3`, `ESM-C`, `ESM-2 3B`, `SaProt`):
  Inside `POST /api/v1/analyze-variant`, deep learning sidecar promises MUST be raced against a **2.5-second fast deadline** (`Promise.race([sidecarPromise, timeoutPromise])`). Slow ML sidecars must NEVER delay the primary Clinical, ClinVar, ACMG, and Predictor evidence rendering.
- **External Web Service Submissions** (`DynaMut2`, `DDMut`, `ThermoMPNN`):
  Inside `POST /api/v1/biophysics/verify-stability`, remote job submission calls MUST be raced against a **300ms deadline**. Local FoldX predictions (~2ms cached) and mutant PDB coordinate buffers MUST return immediately to the frontend, allowing remote job submissions to continue asynchronously in the background.
- **Online Conservation & API Queries** (`popEVE`, `NCBI E-utilities`):
  Online HTTP lookups to external academic databases (e.g., `data.evemodel.org`) MUST be raced with a **2.0-second deadline** so external network latency does not freeze the Evidence tab.

### B. Mandatory LRU Caching Layer for All External Data
- All external data fetching functions MUST implement a dedicated in-memory `LRUCache` instance (or check persistent disk caches).
- Every newly created data stream (e.g. UniProt FASTA sequences via `uniprotSeqCache`, ClinVar queries, STRING-db interactions, popEVE scores, PDB coordinate files) MUST check its cache key at `t=0` before making an HTTP network call.

### C. Asynchronous Progressive Enhancement (UI/UX)
- Heavy LLM narrative text generations (e.g., `POST /api/v1/analyze-variant-narrative`) MUST be invoked asynchronously by the client AFTER the initial JSON evidence payload is set, allowing UI components to render structured evidence metrics instantly while narratives stream in the background.
- The UI MUST gracefully handle `null` or `unavailable` states from slow or timed-out sub-modules without crashing or blocking other evidence cards.

## 6. Unresolved: which dbNSFP release the local ingest holds

`PROVENANCE_DATA_SOURCES.dbnsfp` and `DATA_SOURCES_VERSION.dbnsfp` both declare **"4.4a"**,
but `tools/ingest_dbnsfp.ts` writes its artefact to `data/dbnsfp_v5.sqlite`. Nothing in the
code resolves the conflict: the declared string is hand-maintained (it versions a cache key,
and no code reads a version back from the dbNSFP distribution), while the file name is the
only other signal and may reflect the ingest's own schema rather than the upstream release.

**This is unresolved, not documented as settled.** Until someone confirms which release the
ingested SQLite actually contains, no surface — including the exported provenance manifest and
the About page's credit roll — should state a dbNSFP release as fact. Both currently decline
to (`src/shared/attributions.ts` renders it as "Not established by this code").

Resolving it means: re-run the ingest, record the upstream release string the source archive
declares, and update both registries from that.

**Status: deferred.** The local ingest path is opt-in (`ENABLE_LOCAL_DBNSFP="false"` is the
documented default — `doc/DEPLOY.md:49`, `doc/LIMITATIONS.md:98`) and this conflict only
describes a deployment that has actually run it, so it is recorded here rather than fixed now.
It is a *deferral*, not a resolution: nothing in the codebase agrees, and the two registries
still carry an unsupported "4.4a" until someone re-runs the ingest. Any future change to the
local dbNSFP path must re-open this.

**The prohibition stands meanwhile:** no surface may state a dbNSFP release as fact, and the
exported provenance manifest is the one place that still does — `PROVENANCE_DATA_SOURCES` is
read straight into the manifest that ships with a report. Treat that as a known, dated gap in
exported provenance rather than a settled value.
