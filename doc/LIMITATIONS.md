# Technical Limitations & Constraints — Missense Structural Explorer

This document details the boundaries, performance limitations, dependency constraints, and environmental requirements of the application.

---

## 1. Biophysical Mutant Modeling Constraints (`/api/generate-mutant`)

### 1.1. Single-Site Coordination Substitution
The biophysical mutant model builder is designed specifically for point mutations (single-site substitutions). It performs a focused side-chain modification on top of the native AlphaFold 3D template coordinates.
* **Online/production Mode**: Integrates FoldX calculations to perform localized side-chain energy minimization, but does not execute exhaustive full-protein backbone reconfiguration or heavy molecular dynamics (MD) solvent trajectories.
* **Removal of Offline Fallbacks**: The application no longer performs offline/fallback side-chain mutations or labels when FoldX is unavailable on the server. If biophysical tools fail or are unconfigured, a structured error (`503 MODELING_UNAVAILABLE`) is propagated to the client. The backend expects a local FoldX Windows executable `foldx_1_20270131.exe` (or path configured in `FOLDX_BINARY`) placed inside `tools/foldx/` and copies its `molecules` parameter folder to the job workspace before execution.

### 1.2. Hetero-assembly Constraints
Both AlphaFold reference structures and mutated models operate on single-chain, translated monomer structures.
* Critical bound co-factors (e.g. tetrahydrobiopterin (BH4) in PAH, heme groups in hemoglobin, ATP, or nucleotide sequences) are not dynamically re-docked. Researchers must refer to native experimental multi-subunit structures to confirm structural interactions with ligand molecules.

---

## 2. EMBL-EBI AlphaFold DB API Integrity

Our application relies on fetching 3D atomic structures dynamically from the AlphaFold Database. EBI prediction endpoints are subject to version deprecations and CDN updates:
* **The Version Slideway**: When querying direct PDB downloads, the version identifier can shift (e.g. from `v6` down to `v1`) and include various isoform suffixes (such as `-F1` to `-4-F1`).
* **Our Solution**: The backend queries the official EMBL-EBI Prediction API to get the mapped structure path first, failing fast on 404. If that lookup fails, it falls back to a cascade that iteratively checks combinations of common isoform suffixes and file versions (v6 down to v1).
* **Third-Party Rate Limits**: High-frequency bulk queries directly to upstream APIs (EBI, ClinVar, Ensembl, MyVariant, STRING) may trigger occasional HTTP 429 rate-limiting blockades. The application implements automatic fetch retries with exponential backoff and caches resolved UniProt mapped records inside the active memory session to prevent duplicate backend requests.

---

## 3. Gemini API Credentials Dependency
For live, real-time clinical analyses, the application relies on the `GEMINI_API_KEY` being configured inside the environment secrets:

* **Graceful Degradation**: If the API key is not configured, the backend catches the null-client initialization error and returns a structured configuration state (`isConfigError: true`).
* **Visual Fallback**: Instead of crashing or showing a blank page, the frontend shows an educational header instructing the user on how to add their `GEMINI_API_KEY` to settings, while seamlessly falling back to high-fidelity, pre-analyzed datasets for pre-established clinical variants (such as `PAH p.Arg408Trp` and `FGFR3 p.Gly380Arg`).

---

## 4. GPU & WebGL Iframe Constraints
Because the application runs in a sandboxed iframe environment, several client-side parameters apply:

* **WebGL Isolation**: Low-tier hardware or strict GPU sandboxing in certain enterprise networks may prevent the WebGL context from initializing. To mitigate this, Molstar's configurations are set to prefer hardware acceleration but support software rendering fallbacks if needed.
* **Memory Management**: Loading multiple heavy macromolecular targets can trigger WebGL memory leaks if contexts are not freed. The `MolstarViewer` component actively listens for component unmount events, running a cleanup function (`plugin.dispose()`) to release GPU buffers.
* **Iframe Sandbox Exemptions**: Interactive triggers like opening external tabs are constrained. To prevent browser blocks, the app does not call restricted APIs like `window.open` or `window.alert` inside the Molstar canvas.

---

## 5. Stateless Session Tokens

To ensure multi-replica security and horizontal scaling across server clusters, the application uses stateless AES-256-GCM encrypted tokens for session key exchange.
* **Statelessness**: No session data is persisted in the server memory or databases. Any server replica can decrypt and validate the session token using the shared `APP_SESSION_SECRET`.
* **Token Rotation**: Rotating or changing the `APP_SESSION_SECRET` will immediately invalidate all active sessions, requiring clients to re-authenticate (which happens transparently on the client if credentials are in active state).

---

## 6. PII Filtering best-effort mitigation

The server implements a regular-expression-based PII (Personally Identifiable Information) filtering helper (`filterPII`) to screen user-supplied directions for sensitive information like emails, phone numbers, SSNs, dates of birth, and patient/medical record IDs.
* **Best-effort Constraint**: This is a regex-based helper and acts as a secondary mitigation control. It cannot guarantee the detection of arbitrary patient names or unique custom identifiers.
* **Primary Control**: The primary clinical safety control is the user policy: researchers must **never** input real Patient Health Information (PHI) or identifiable clinical notes into the custom narrative directions field.
