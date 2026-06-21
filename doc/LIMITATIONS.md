# Technical Limitations & Constraints — Missense Structural Explorer

This document details the boundaries, performance limitations, dependency constraints, and environmental requirements of the application.

---

## 1. Biophysical Mutant Modeling Constraints (`/api/generate-mutant`)

### 1.1. Single-Site Coordination Substitution
The biophysical mutant model builder is designed specifically for point mutations (single-site substitutions). It performs a focused side-chain modification on top of the native AlphaFold 3D template coordinates.
* **Online/production Mode**: Integrates FoldX calculations to perform localized side-chain energy minimization, but does not execute exhaustive full-protein backbone reconfiguration or heavy molecular dynamics (MD) solvent trajectories.
* **Offline/fallback Mode**: Mutates the specific amino acid metadata labels at the target sequence coordinates to correctly render the substituted residue side-chains within Mol*, but retains the wild-type backbone configuration. It is suited for analyzing steric clashes, localized electrostatics, and side-chain volume shifts, but won't capture total denaturing or dramatic global structural collapses.

### 1.2. Hetero-assembly Constraints
Both AlphaFold reference structures and mutated models operate on single-chain, translated monomer structures.
* Critical bound co-factors (e.g. tetrahydrobiopterin (BH4) in PAH, heme groups in hemoglobin, ATP, or nucleotide sequences) are not dynamically re-docked. Researchers must refer to native experimental multi-subunit structures to confirm structural interactions with ligand molecules.

---

## 2. EMBL-EBI AlphaFold DB API Integrity

Our application relies on fetching 3D atomic structures dynamically from the AlphaFold Database. EBI prediction endpoints are subject to version deprecations and CDN updates:
* **The Version Slideway**: When querying direct PDB downloads, the version identifier can shift from `model_v4.pdb` down to `model_v1.pdb`.
* **Our Solution**: The backend implements a cascading downloader that starts at `v4` and moves downward if 404s are encountered.
* **Third-Party Rate Limits**: High-frequency bulk queries directly to EBI may trigger occasional HTTP 429 rate-limiting blockades. The application is designed to cache resolved UniProt mapped records inside the active memory session to prevent duplicate backend requests.

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
