# Product Requirements Document (PRD) — Missense Structural Explorer

## 1. Executive Summary & Purpose
The **Missense Structural Explorer** is a clinical-grade, web-based platform tailored for clinical geneticists, molecular biophysicists, and precision medicine researchers. In the diagnostic pipeline, genetic sequencing frequently yields thousands of genomic variants, particularly highly ambiguous **Variants of Uncertain Significance (VUS)**. Determining whether a single amino acid swap (a missense variant) disrupts a protein's fold, pocket, or binding affinity is a bottlenecks in clinical pathogenicity classification.

This application resolves these bottlenecks by bridging the gap between flat text mutations (e.g., `p.Arg215Trp`) and 3D molecular reality. It unifies:
1. **Interactive 3D Visualizations** directly inside the browser using Mol* (Molstar).
2. **Generative Biophysical Analyses** utilizing structural models loaded dynamically from the AlphaFold DB.
3. **Biophysical Variant Modeling** for mutations to examine 3D side-chain shifts and steric clashes.
4. **Clinical Pathogenicity Assessments** using Gemini AI to automate parts of the ACMG/AMP clinical variant interpretation guidelines.

---

## 2. Target Audience & Personas

### Persona A: Dr. Sarah Lin (Clinical Geneticist)
* **Goal**: Wants to classify patient mutations rapidly to sign off on diagnostic reports.
* **Pain Point**: Reviewing coordinates manually in desktop software like PyMOL or ChimeraX is too slow, requires powerful workstations, and is isolated from biological literature.
* **Explorer Value**: Selects or enters a gene, sees the mutation highlighted immediately, and receives an instant AI-driven ACMG-aligned hypothesis with 3D landmark suggestions.

### Persona B: Prof. David Vance (Structural Geneticist / Rare Disease Researcher)
* **Goal**: Investigates how mutations in rare disease genes (e.g., *PAH* or *FGFR3*) lead to protein destabilization or constitutive receptor activation.
* **Pain Point**: Generating folded structural mutants historically required complex molecular dynamics (MD) or local Rosetta folding pipelines.
* **Explorer Value**: Uses the live biophysical mutant modeling engine to construct a mutant 3D coordinate model, then visually overlays them to analyze local changes.

---

## 3. Scope of Core Capabilities

### 3.1. Gene Representation & Resolution
* Target user enters or chooses a gene of interest (e.g., `PAH`, `FGFR3`, `GBA1`, `NAE1`).
* System maps the human gene symbol directly to its definitive **UniProt Accession ID** and queries prediction metadata via robust API gateways.

### 3.2. Automated Variant AI Analysis
* Parses clinical notation strings (e.g., `p.Arg408Trp` or `p.Gly380Arg`) into descriptive components (Wild-type residue, residue number, mutant residue).
* Uses Gemini AI to compile a detailed clinical and biophysical analysis covering molecular shifts, structural context, and pathogenicity risk.
* Synthesizes structured insights containing biochemical alteration summaries, primary structural impacts, and candidate ACMG pathogenicity criteria (e.g., `PM1`, `PP3`, `PM2`).

### 3.3. Dual Structure Exploration (Wild-Type vs. Live Mutant Folding)
* **Wild-Type**: Fetches 3D atomic structures dynamically from the **EMBL-EBI AlphaFold Database** to inspect native positions.
* **Biophysical Mutant Modeling**: Performs side-chain substitution on the wild-type 3D template coordinates. Returns a simulated mutant structural coordinate file, pinpointing spatial deviations.

### 3.4. Interactive 3D Molecular Canvas
* Implements a full-viewport, GPU-accelerated Mol* (Molstar) rendering context.
* Features advanced viewport lighting, ribbon models, hydrophobicity and polymer-type coloring, and dynamic viewport controls.
* Supports **automatic structural focus** — immediately centering, zooming, and rendering the exact carbon pocket surrounding the mutant residue to guide clinical evaluation.

---

## 4. Primary User Workflows

### Workflow 1: The Preset Diagnostic Walkthrough
1. **Selection**: User clicks on a predefined clinical variant preset (e.g., `PAH p.Arg408Trp` - Phenylketonuria risk).
2. **Auto-Display**: The 3D viewport instantly downloads the PAH structure, highlights residue 408, zooms into the tetramerization subunit interface, and renders nearby residues.
3. **Medical Insights**: The report panel opens, presenting pre-analyzed clinical data showing why disrupting these subunit hydrogen bonds causes tetramer destabilization.

### Workflow 2: The Custom Mutation Discovery Walkthrough
1. **Search & Resolve**: User types a novel gene (e.g., `LPCAT3`) and its clinical amino acid variant (e.g., `p.Lys115Met`).
2. **API Mapping**: The back-end maps the gene to its accession code (`Q6P1A2`), retrieves cellular genomic sequences, and mutates the required codon.
3. **Deep AI Assessment**: The system invokes Gemini AI, which produces a detailed biophysical profile of the Lysine-to-Methionine hydrophobic shift.
4. **Biophysical Mutant Modeling**: User requests mutated structural simulation. The server processes the target coordinate file and returns a custom mutant model.
5. **Comparison**: User toggles between the native AlphaFold wild-type structure and the live mutated structure, highlighting exactly how surrounding amino acid contacts deform.

---

## 5. Non-Functional & Visual Quality Goals
* **Pristine Typography & Spatial Layout**: Deep dark clinical/scientific theme (charcoal, slate, and clean borders) prioritizing data density without visual clutter or system telemetry spam.
* **No Telemetry or Margin Clutter**: Pure biological focus. Margin indicators, status badges, and details are kept elegant, functional, and minimal.
* **Fail-Safe Robustness**: Handles missing API keys or external server timeouts gracefully with pre-compiled biochemical fail-safes and user-friendly error banners.
