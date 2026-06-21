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
* **Orchestration**: Executes two parallel/sequential queries to Gemini AI:
  1. **Narrative Generation**: Calls `gemini-3.5-flash` with a tailored biophysical prompt to obtain detailed, professional clinical markdown.
  2. **Structured JSON Validation**: Calls the model with a defined JSON schema request, extracting `biochemicalShift`, `structuralImpact`, and structural pathogenicity `acmgCriteria` arrays containing clinical codes and reasoning.
* **Error Resilience**: Intercepts absent Gemini keys and returns a structured configuration error to the front-end, gracefully falling back to preconfigured high-fidelity clinical records (defined in `src/data.ts`) to maintain a fully interactive prototype.

#### B. Biophysical Mutant Modeling Pipeline (`POST /api/generate-mutant`)
* **Inputs**: `{ wtPdb: string, mutation: string }` (e.g., `wtPdb` coordinate buffer and mutation instruction like `RC215W`)
* **Process**:
  1. Writes the heavy wild-type template coordinate data block to a temporary workspace file (`wt_temp_${timestamp}_${randomId}.pdb`) to allow native CLI processors to access the coordinate matrix.
  2. Formulates a localized command-line instruction file with standard biophysical mutation descriptions (e.g., `RA215W;` mapping the residue sequence).
  3. Prepares a child process execution context: `foldx --command=BuildModel --pdb=${wtFile} --mutant-file=${mutFile}`.
  4. In compute environments containing a pre-existing FoldX biophysical modeling binary, the system triggers real-time molecular mechanics modeling, side-chain repackaging, energy minimization, and returns the minimized 3D coordinate set.
  5. In sandbox/prototype environments lacking native binaries, the server falls back to an atomic AST parser: it processes the PDB sequence, intercepts `ATOM`/`HETATM` coordinates on residue index `215`, mutates the amino acid labels to the corresponding 3-letter IUPAC string (e.g., `ARG` -> `TRP`), and renders the mutant structure.
  6. **Safe Workspace Cleanup**: Explicitly runs synchronous file unlinking procedures on temporary inputs and outputs to prevent storage pollution in production containers.

#### C. Gene Accessory resolver (`POST /api/resolve-gene`)
* Maps inputted gene symbols (e.g., PAH, FGFR3, GBA1, NAE1) to their canonical accession codes.
* Interrogates EBI APIs to determine structure availability and coordinate schemas.

#### D. AlphaFold Structural Proxy (`GET /api/alphafold-pdb/:uniprotId`)
* Bypasses client-side issues with loading heavy bioinformatics files from varying host origins.
* Interrogates the AlphaFold DB with cascade recovery logic:
  * Attempts to fetch `https://alphafold.ebi.ac.uk/files/AF-${uniprotId}-F1-model_v4.pdb`.
  * If v4.pdb returns a 404, it iterates down through `v3.pdb`, `v2.pdb`, and `v1.pdb`.
  * If these direct CDNs fail, it queries the EMBL-EBI Prediction API to look up redirect links.
  * Bypasses CORS headers, pipes the raw PDB string securely back to Mol*, and validates that the payload contains proper `ATOM` structural coordinate segments to prevent corrupt renders.

---

## 4. Production Security & Deployment (SEC-5)
In production, the application is designed to be hosted in a containerized environment (e.g., Google Cloud Run) behind a secure load balancer or reverse proxy:
* **HTTPS Enforcement**: The Node.js Express server runs on plain HTTP (port 3000) inside its isolated container or sandbox environment. Secure HTTPS/TLS termination is decoupled from the application layer and must be handled at the ingress or load balancer layer (e.g., GCP HTTPS Load Balancer) to ensure all clinical variant data in transit is encrypted.
* **Access Controls**: Production access can be secured using GCP Identity-Aware Proxy (IAP) to authenticate users via corporate Single Sign-On (SSO) before they can connect to the application.
