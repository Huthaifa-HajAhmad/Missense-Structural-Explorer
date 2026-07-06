# Technical Architecture Design — Missense Structural Explorer

## 1. System Topology Overview
The **Missense Structural Explorer** is designed as a modular, full-stack React and Express application running on Node.js. It implements a **Server-Side API Proxy Architecture** to securely handle API keys, perform computation-heavy sequence mutations, and bypass sandbox/CORS constraints on external bioinformatics services.

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

### Rendering & Geometry Management
* **Dynamic Sizing**: Rather than listening to fixed window dimensions, the viewport utilizes a `ResizeObserver` tracking the absolute dimensions of the container element, triggering `plugin.layout.setSettings` updates to prevent layout deformation.
* **Selection Highlighting**: When a residue index is specified (e.g., residue `#273` in p53), Molstar builds structured representation queries. It renders the target residue in **Ball and Stick** or **Spacefill (VDW Spheres)** representations while coloring the remaining polymer backbone in transparent cartoon ribbons or custom thematic palettes (e.g. by Hydrophobicity or PLDDT score).

---

## 3. Back-End Server Design
To bypass cross-origin browser limitations (CORS) and securely invoke analytical AI models, all external communications are routed through `/server.ts` (running inside a Node.js process).

### API Route Registry

#### A. Variant Analysis Pipeline (`POST /api/analyze-variant`)
* **Inputs**: `{ gene: string, variant: string, uniprotId: string }`
* **Orchestration**: Executes parallel and cascade processing streams:
  1. **Structural Triage**: Runs a local, fast rule-based classifier (`predictStructuralDisruption`) in parallel to assess secondary structure patterns, volume changes in the hydrophobic core, and residue chemical indices.
  2. **Narrative Generation**: Calls `gemini-2.5-flash` (falling back to `gemini-2.0-flash`) with a tailored biophysical prompt to obtain detailed, professional clinical markdown.
  3. **Structured JSON Validation**: Calls the model with a defined JSON schema request, extracting `biochemicalShift`, `structuralImpact`, and structural pathogenicity `acmgCriteria` arrays containing clinical codes and reasoning.
* **Error Resilience**: Intercepts absent Gemini keys and returns a structured configuration error to the front-end, gracefully falling back to preconfigured high-fidelity clinical records (defined in `src/data.ts`) to maintain a fully interactive prototype.

#### B. Biophysical Mutant Modeling Pipeline (`POST /api/generate-mutant`)
* **Inputs**: `{ wtPdb: string, mutation: string, uniprotId?: string }`
* **Process**:
  1. Writes the heavy wild-type template coordinate data block to a temporary workspace file (`wt_temp_${timestamp}_${randomId}.pdb`) to allow native CLI processors to access the coordinate matrix.
  2. Formulates localized command-line instruction files with standard biophysical mutation descriptions (e.g., `RA408W;` mapping the residue sequence).
  3. Prepares a child process execution context to run FoldX `BuildModel` across **3 independent runs** for stochastic averaging (extracting mean $\Delta\Delta G$ and standard deviation).
  4. Runs a Python-based sequence predictor (`tools/ddgun/ddgun_seq.py`) to fetch sequence-based evolutionary $\Delta\Delta G$ scores.
  5. Computes a **2/3 majority consensus verdict** based on predefined destabilization thresholds for FoldX, DynaMut2, and DDGun-Seq.
  6. Calculates local sidechain packing RMSD using a physical alignment algorithm on wild-type and mutant rotamers.
  7. **Fails Loud**: In environments lacking FoldX binaries or where execution fails, the engine throws a hard `503` error instead of falling back to silent wild-type coordinate returns, ensuring data integrity.
  8. **Safe Workspace Cleanup**: Explicitly runs recursive file deletion on temporary job directories to prevent storage pollution in production containers.

#### C. Gene Accessory resolver (`POST /api/resolve-gene`)
* Maps inputted gene symbols (e.g., PAH, FGFR3, GBA1, NAE1) to their canonical accession codes.
* Interrogates EBI APIs to determine structure availability and coordinate schemas.

#### D. AlphaFold Structural Proxy (`GET /api/alphafold-pdb/:uniprotId`)
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
* **Rate Limiting & Security Headers**: Express middleware enforces standard Helmet security headers (HSTS, CSP, X-Frame-Options) and rate-limiting limits (30 requests/minute per IP) to prevent denial of service.
* **PII Redaction**: Free-text clinical narrative directions (`userDirections`) undergo regular-expression-based screening to redact phone numbers, emails, SSNs, dates of birth, and patient/medical record IDs before sending to third-party APIs.
* **HTTPS Enforcement**: The Node.js Express server runs on plain HTTP (port 3000) inside its isolated container or sandbox environment. Secure HTTPS/TLS termination is decoupled from the application layer and must be handled at the ingress or load balancer layer (e.g., GCP HTTPS Load Balancer) to ensure all clinical variant data in transit is encrypted.
* **Access Controls**: Production access can be secured using GCP Identity-Aware Proxy (IAP) to authenticate users via corporate Single Sign-On (SSO) before they can connect to the application.
