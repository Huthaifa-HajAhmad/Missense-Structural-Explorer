# Future Work & Enhancements Roadmap — MissenseResolve®

This document outlines planned future work, alternative model integrations, and technical enhancements to expand the biophysical modeling capabilities and user experience of the Missense Structural Explorer.

---

## 1. Advanced Biophysical Modeling Engines

### 1.1. FoldX5 PositionScan & AlaScan
* **Surfacing Neighbor Energies**: Surface neighbor residue ΔΔG contribution values calculated via FoldX `PositionScan` on the mutation site. This will allow researchers to identify precisely which neighboring residues are most impacted or contribute most to localized destabilization.
* **Implementation Plan**: Since FoldX is already integrated on the server, we can extend the biophysical calculation pipeline to trigger a `PositionScan` as an optional secondary query, displaying the result as a detailed table in the physical geometry tab.

### 1.2. Rosetta Cartesian & Flex DDG Integration
* **Helical and Backbone Movement Handling**: Integrate Rosetta `cartesian_ddg` or `flex_ddg` to compute localized backbone adjustments. Rosetta provides significantly higher physical accuracy for mutations that induce helix-breaking or backbone structural shifts (e.g. Proline or Glycine substitutions).
* **Implementation Plan**: Package Rosetta execution in a dockerized python sidecar service, enabled behind a server feature flag to maintain licensing independence.

### 1.3. Boltz-2 / Chai-1 Diffusion Local Refinement
* **Confidence-Aware Local Folding**: Replace the independent ESMFold refolding pipeline with Boltz-2 or Chai-1 joint local folding. Joint folding models utilize confidence-aware diffusion to resolve structures, yielding highly accurate localized coordinate changes without loops drifting due to independent sequence model variance.

---

## 2. Evidence Dashboard Tab Upgrades

To maintain consistency with our [UX Upgrade Translation Philosophy](../.gemini/antigravity/brain/0dd1b596-5bc1-4b98-a506-95113575d63a/design_philosophy.md), future tab refactorings will translate raw numeric data to qualitative structural insights:

* **Clinical Tab**: Translate raw ClinVar submissions and ACMG rules into clear verdict categories with descriptive confidence labels.
* **Predictors Tab**: Group computational pathogenicity predictors (REVEL, CADD, AlphaMissense, popEVE) into a unified predictive consensus index.
* **Interactions Tab**: Map protein-protein and protein-ligand structural contact changes into binding affinity shift interpretations.

---

## 3. Visualization Enhancements

### 3.1. 2D Δ-Distance Heatmap Matrix
* **Visualizing Packing Deformation**: Implement a compact 2D pairwise distance change heatmap inside the Perturbation Tab showing coordinate displacements around the mutation site (e.g., pos ± 5 residues window). This will visually highlight overall compression or expansion in local structural packaging.

### 3.2. Repacked Sidechains sticks in 3D Viewer
* **Steric Clash Inspection**: Highlight repacked sidechains (FoldX repaired/modeled local neighborhood residues) as distinct stick representations in the 3D Molstar viewer to let researchers inspect sidechain alignment and steric hindrance adjustments directly.

---

## 4. Technical Refactoring

* **Transcript Isoform Prewarming Isolation**: Update the FoldX prewarming script (`inFlightPrewarms`) to use `uniprotId_variant` keys rather than `gene_variant` to prevent prewarming cache collisions on multi-isoform variants of the same gene.
* **Persistent Client-Side Folding Cache**: Extend the in-memory ESMFold cache (`esmFoldGlobalCache`) to persist folded PDB files across browser reloads using client-side storage (e.g. IndexedDB or LocalStorage). This is highly beneficial due to the high computational overhead of sequence folding calls.
* **ESM Atlas Token Validation Check**: Upgrade the remote ESM Atlas fallback token configuration validator. Currently, a `HEAD 403` status is treated as "token configured" without verifying if the token is valid; this path should query a lightweight validation endpoint.
* **Unified Fallback Sentinels on Sidecar Model Failures**: Standardize the python model-sidecar's remote failed paths. Any downstream connection timeouts or failures in the remote ESM3/ESMC APIs should propagate the `-1.0` uncomputed sentinel scores to the client, preventing missing scores from rendering as zero-disruption values.
