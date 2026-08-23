# Interactive Feature Catalog — MissenseResolve®

The **MissenseResolve®** offers a suite of interactive, clinical-grade tools designed to aid molecular diagnostic pipelines. This document details each user-facing feature and utility.

---

## 1. Dynamic Clinical Variant Querying
Instead of relying on static pre-calculated variants, the dashboard dynamically processes, aligns, and models user-submitted missense mutations on-the-fly. Key clinical variants often used for testing include:

* **PAH (p.Arg408Trp)**: Phenylalanine-4-hydroxylase catalytic domain mutation. Disrupts crucial inter-subunit salt bridges (with Asp315 and Asp320), destabilizing the tetrameric oligomerization interface and causing severe classical Phenylketonuria.
* **FGFR3 (p.Gly380Arg)**: Fibroblast growth factor receptor 3 transmembrane mutation. Stabilizes ligand-independent receptor dimerization in the lipid bilayer, leading to constitutive activation and Achondroplasia dwarfism.
* **GBA1 (p.Leu483Pro)**: Acid beta-glucosidase Ig-like domain mutation. Acts as a beta-sheet breaker, triggering folding collapse and ER-associated degradation, leading to Gaucher Disease.

---

## 2. Interactive 3D Viewer Capabilities (Molstar Engine)
The molecular canvas (WebGL) allows users to manipulate structures with high precision:

### 2.1. Structural Preset Color Themes
* **PLDDT Confidence**: Colors the peptide chain by AlphaFold's *predicted local distance difference test* score (Very High [Dark Blue] -> confident backbone; Medium [Yellow] -> flexible loop; Very Low [Orange] -> intrinsically disordered regions).
* **Element / CPK**: Standard chemical modeling colors (Carbon: Grey, Oxygen: Red, Nitrogen: Blue, Sulfur: Yellow, Zinc: Grey/Plum).
* **Hydrophobicity**: Colors the interior residue cores differently from the hydrophilic outward-facing residues.
* **Secondary Structure**: Distinct coloring for alpha-helices, beta-sheets, and coils.

### 2.2. Representation Controls
* **Cartoon/Ribbon**: Essential secondary structure scaffolding overview.
* **Ball & Stick**: Full-atom modeling tracing individual sidechain configurations.
* **Spacefill (Van der Waals Spheres)**: Renders physical atomic volumes, highlighting steric clashes.
* **Gaussian Surface**: Shows full solvent-accessible molecular envelopes to check if a residue is buried or surface-exposed.

### 2.3. Pocket Focusing & Center Actions
* Hovering over residues tells the researcher their exact position, chain label, and name.
* Clicking **Center Mutation** instantly re-aligns the camera, zooms in, establishes a 3D focus sphere around the target residue, and displays the surrounding atoms with full resolution.
* **Hydrogen Bonds & Polar Contacts Calculation**: A dedicated interactive toggle dynamically measures and traces spatial inter-atomic distances to render polar hydrogen-bonding contacts (represented as dashed 3D vectors) between the mutation site side-chain and surrounding structural pockets.

---

## 3. Interactive Sequence & Alignment Browser
The sequence panel contains a fully synchronized biophysical-to-sequence map:
* **Interactive Alignment**: Displays the full translated peptide sequence surrounding the mutation site, aligning the Wild-Type sequence with the predicted Mutant sequence.
* **Mutation Highlighting**: Spotlights the exact mutation position with high-contrast indicator tracks and coordinate indices (top horizontal axis).
* **3D Locus Binding**: Clicking any residue index or flank sequence letter in the alignment browser automatically focuses, realigns, and isolates the 3D camera view inside Mol* onto that specific spatial residue.

---

## 4. Generative AI Diagnostic Suite
The analysis container processes inputs in real time:

### 4.1. Markdown Narrative Output
* Combines structured chemical analysis with clinical predictions.
* **Section 1: Molecular & Chemical Shift**: Compares charges, polarities, volumes, and side-chain lengths.
* **Section 2: Biophysical Disruption**: Outlines steric strain, salt-bridge collapses, loop bending, or pocket destabilization.
* **Section 3: Clinical Pathogenicity**: Reviews disease associations (e.g., Phenylketonuria, Achondroplasia, Gaucher Disease), inheritance modes, and biochemical outcomes.
* **Section 4: Visualization Landmarks**: Recommends coordinate regions to trace inside the 3D Molstar canvas.

### 4.2. Structured ACMG Criteria Grid
Provides automated screening for several variant rules based on the ACMG guideline schemas:
* **PM1 (Hotspot Domain)**: Flags if the residue sits in critical binding domains or mutational hotspots.
* **PP3 (In Silico Validation)**: Automatically aggregates multi-tool scoring.
* **PM2 (Population Rarity)**: Assesses frequency thresholds.
* Every code is accompanied by a concise, biophysically sound clinical justification.

---

## 5. Biophysical Mutant Modeling Engine & Consensus Stability Verdicts
This advanced research feature models mutated coordinate structures on the fly:

* **Stochastic Multi-Run Folding**: Runs FoldX `BuildModel` 5 times to calculate average stability ($\Delta\Delta G$ Mean $\pm$ SD) to ensure rotamer sampling reproducibility and clamp severe outliers.
* **Smart Triage Classification**: Evaluates secondary structure patterns (e.g. Proline/Glycine substitutions in helices/sheets), volume expansion in hydrophobic cores, and pLDDT structure confidence to classify variants before executing heavy simulations.
- **Triage Override**: Allows researchers to force-enable mutant structure modeling even for low-disruption variants where WT and Mutant rigid backbones are identical, preventing misleading structural comparisons.
- **Multi-Method Consensus Verdict**: Aggregates FoldX, DynaMut2, DDMut, RaSP, and ThermoMPNN (via Tamarind Bio remote REST API) predictions to determine a consolidated stability verdict (High Misfolding Risk, Moderate Misfolding Risk, or Low Misfolding Risk).
* **ThermoMPNN Deep Learning Integration**: Integrates ThermoMPNN predictions trained on >770,000 experimental measurements to evaluate thermodynamic stability changes ($\Delta\Delta G^\circ$) with ProteinMPNN structural embeddings.
* The 3D viewer displays the mutated structure overlay, enabling direct visual comparison of how a sequence change affects the local spatial pocket architecture.

---

## 6. Unified Dark & Light Visual Theme System
The interface features a cohesive theme alignment across all scientific canvases and details panels:
* **Dark Mode (Default)**: Deep Slate/Space tones (`#0f172a`), perfect for medical workstations, high-contrast WebGL molecular viewing, and overnight research analysis.
* **Light Mode**: Ultra-clean, eye-safe clinical paper-white and Slate-100/50 backgrounds, offering optimal readability under typical office lighting.
* **Component-Safe Binding**: The **Local Sequence Alignment Visualizer** and **3D Molecular Workspace** dynamically adapt in real-time. This synchronizes critical interfaces, buttons, coordinate grids, text elements, customized scrollbars, and range input sliders to blend beautifully without jarring high-contrast mismatches.

---

## 7. Settings Drawer (Slide-over Console)
Accessible from the sidebar **Settings** action (and deep-linked from every "Configure API key" prompt), a right-side slide-over drawer (`motion` spring choreography, portal-mounted, focus-trapped with scroll lock) organizes seven sections with instant-apply controls:

* **🎨 Appearance**: Light / Dark / **System** color scheme (system follows the OS preference live), workspace accent color, **Reduce motion** (first-run default honors the OS accessibility setting and gates both CSS and spring animations), and **High-contrast viewport** (enlarges the mutated-residue highlight and adds a translucent halo in the 3D viewer).
* **🔬 Viewport**: Target residue highlight swatches (vibrant + muted families), camera transition speed, auto-zoom on selection, 3D residue labels, and polar-contact rendering (synced with the structure legend modal).
* **🧬 Sequence**: Residue color scheme and ribbon slice size — the slice size now genuinely seeds the landscape/ribbon window on startup.
* **⚗️ Analysis**: ACMG weighting model, ΔΔG energy unit, **default structure source (AlphaFold2 / ESMFold)** and **default perturbation model (SaProt / ESM-2 / ESMc)** for new sessions, plus **simulation conditions (pH, temperature, ionic strength)** forwarded to biophysical stability requests.
* **🖥️ Workspace**: Automatic alert banners toggle (suppresses warn/error toasts while still logging to the console) and opt-in search history with its retention limit.
* **🔑 Connections**: All five credentials (App/Lab token, Biohub/Forge, Tamarind Bio, Hugging Face, Gemini) with per-credential connection tests, a live Gemini session pill with expiry countdown, and a server service-readiness strip (FoldX engine, model server, Gemini).
* **ℹ️ About & data**: Live server version, pinned foundation-model revisions and data-source releases, settings export/import (JSON, credentials never included), search-history and client variant-cache purge, and the server cache purge control.

Security model: credentials live only in `sessionStorage` for the tab lifetime; nothing secret is ever written to `localStorage` (including in exported settings files), and resets wipe transient credentials.

---

## 8. Residue Property Comparison Radar Chart (Biochemical Profile)
For researchers evaluating spatial substitution severity, the **Insights Card** embeds a real-time chemical profile radar chart leveraging a specialized representation:

* **Dimensional Profiles**: Evaluates four cardinal biophysical traits: **Hydrophobicity**, **Electrochemical Charge Index**, **Molecular Volume (Side-Chain Size)**, and **Polarity Index**.
* **Dual Multi-Polygon Mapping**: Overlays the native Wild-Type residue (rendered as an **Emerald Green** polygon) side-by-side with the mutated residue (rendered as a **Rose Red** polygon) to instantly demonstrate the biophysical footprint change.
* **Dynamically Calculated Values**: Renders exact normalized coordinates (0% to 100%) and displays comparative breakdown tables with clear descriptions for any evaluated variant sequence, including full descriptive text (e.g., `Arginine [Arg]` vs `Tryptophan [Trp]`).
* **Interactive Web Elements**: Features custom WebGL hover state highlights, precise touch-safe point-by-point canvas cursor tooltips, and responsive layout adjustments matching active browser window dimensions.

### 8.1. Sourcing & Normalization Scales (S-4)
The biophysical properties are derived and normalized (0–100 scale) from established biochemical scales:
*   **Hydrophobicity Scale**: Adapted from the **Kyte-Doolittle hydropathy scale**. 
    *   *Citation*: Kyte J, Doolittle RF. "A simple method for displaying the hydropathic character of a protein." *J Mol Biol.* 1982 May 5;157(1):105-32. PMID: 7108955.
*   **Molecular Volume (Size) Scale**: Normalized from physical amino acid **van der Waals volume measurements**.
    *   *Citation*: Zamyatnin AA. "Protein volume in solution." *Prog Biophys Mol Biol.* 1972;24:107-23. PMID: 4566650.
*   **Polarity & Charge**: Classified according to standard amino acid properties at physiological pH (pH 7.4). Comparisons align with the **Grantham scale** difference calculations.
    *   *Citation*: Grantham R. "Amino acid difference formula to help explain protein evolution." *Science.* 1974 Sep 6;185(4154):862-4. PMID: 4843792.

---

## 9. ESM Representation Models & ESM3 Allosteric Perturbations
To capture sequence-context constraints and allosteric disruptions, the diagnostic pipeline integrates deep transformer-based protein representations:

* **ESMC-6B & VESM-150M zero-shot sequence constraints**: Renders actual, non-fabricated likelihoods ($P_{wt}$, $P_{mut}$), log-likelihood ratios ($\Delta$ LLR), zero-shot mutant percentile rank, and positional Shannon entropy in bits, computed from the model logits.
* **ESM3 3D Allosteric Disruption**: Computes L2-norm distance metrics of the hidden state embeddings between WT and Mutant sequences across the structure, plotting localized perturbation profiles and mapping allosteric structural drift.
* **Generative Local Coordinate Refinement**: Leverages ESM3's structural track and coordinate masking to perform localized mutant sidechain conformation refinement, aligning with standard biophysical simulations.

