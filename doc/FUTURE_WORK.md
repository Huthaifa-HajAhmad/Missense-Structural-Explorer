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

### 1.4. Quaternary Whole-Complex Modeling (Boltz-1 / Chai-1)
* **Quaternary-Assembly Predictions**: Extend the pipeline from single-chain monomer structural analyses to whole-complex/quaternary-assembly predictions (homotetramers, heterodimers, etc.) to capture interface-disrupting mutations (e.g., PAH p.Arg408Trp).
* **Deep Learning Structural Diffusion**: Use open-source, commercially viable multimeric models like **Boltz-1** or **Chai-1** to predict the multimer structures asynchronously as advanced background queue tasks.
* **Complex Binding Energetics**: Implement FoldX `AnalyseComplex` on the wildtype vs mutant complex to calculate interaction binding energy changes ($\Delta\Delta G_{\text{bind}}$) directly via physical forcefield thermodynamics (strictly avoiding hand-crafted heuristics).
* **Intelligent UI Prompts**: Parse curated UniProt `SUBUNIT` comments at query time to flag if a gene is involved in quaternary assemblies, prompting the user if expensive multimer modeling is recommended.
* **Detailed Proposal**: See the full architectural specification in [Quaternary Whole-Complex Modeling Proposal](./multimer_modeling_proposal.md).

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

---

## 5. Storage-Optimized Precomputation-First Architecture

To guarantee that the primary variant analysis endpoints (`/analyze-variant`) are highly resilient and independent of external API outages (NCBI/EBI/Ensembl), we will implement a precomputation-first strategy with local seekable indices. By optimizing datasets (using target clinical panel subsets and bin-sorted index maps), we can stay well within the strict **20 GB storage limit**.

### 5.1. Target Datasets & Footprints (~1.87 GB Total Extra Footprint)
* **popEVE**: ~280 MB target (compressed VCF + tabix index).
* **RaSP**: ~414 MB target (compressed, byte-offset indexed CSV).
* **AlphaMissense (Coding Variant Subset)**: ~1.5 GB target (precomputed human coding variants).
* **REVEL (Clinical Panel Exons)**: ~180 MB target (compressed clinical panel subset).
* **SpliceAI (Exonic Junctions)**: ~120 MB target (filtered for delta score $\ge 0.10$ in clinical genes).
* **Conservation (GERP++/phyloP)**: ~60 MB target (exon positions for clinical genes).
* **ClinVar (Weekly Dump)**: ~800 MB (compressed JSON dump).
* **gnomAD Gene Constraints**: ~20 MB (stable target transcript map).

### 5.2. Atomic Update & Verification Cron
* **Weekly ClinVar Dump Cron**: Runs weekly to download the latest ClinVar monthly JSON dump, verifies its integrity via SHA-256 checksums, and performs an atomic swap (`fs.renameSync`) to update the active local SQLite database.
* **Monthly gnomAD Refresh Cron**: Runs monthly to fetch the gnomAD gene constraint tables and update constraints.
* **Per-Release popEVE & AlphaMissense Refreshes**: Triggered only upon new official model weight/prediction release.

### 5.3. Generalized Offset Database Seeker
* **Generalized Seeker**: Develop a DRY `PrecomputedOffsetDatabase` helper that uses a binary-sorted offset map for $O(1)$ memory seeking on concatenated CSV/VCF files.
* **Graceful Remote Fallback**: Route all other "weaker" or rarely-used genome-wide predictors (CADD, DANN, Eigen) through remote Ensembl VEP/MyVariant APIs. They will act purely as secondary verification layers, keeping local storage minimal.

