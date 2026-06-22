<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# 🔬 Missense Structural Explorer (Rare Disease Genomics)

> A clinical-grade 3D macromolecular visualizer, biophysical mutant modeling gateway, and AI-driven variant pathfinder tailored for rare disease diagnostics.

---

## 🧬 Overview

**Missense Structural Explorer** is a full-stack bioinformatics application designed to assist clinical geneticists and rare disease researchers in evaluating the biophysical impact of single-amino acid substitutions. 

By unifying GPU-accelerated **3D structural visualization (Molstar)**, **deterministic database grounding (ClinVar & gnomAD)**, **Ensembl VEP notation translation**, and **generative AI reasoning (Gemini 3.5 Flash)**, the platform streamlines the evaluation of genetic variants from VCF genomic coordinates down to molecular atomic contacts.

### 🌟 Key Capabilities
*   **WebGL 3D Viewer (Molstar Engine)**: Rotate, zoom, and analyze 3D structures fetched directly from the EBI AlphaFold Database. Toggle polar contacts and hydrogen bonding networks on the fly.
*   **Biophysical Mutant Modeling**: Query real-time molecular modeling (integrated with FoldX mechanics) to generate minimized mutant coordinate structures and compute stability changes ($\Delta\Delta G$).
*   **Clinical Database Grounding**: Automatically search the NCBI ClinVar API to fetch curated significance classifications, review statuses, traits, and population allele frequencies (sourced from gnomAD).
*   **VEP Translation Gateway**: Translate genomic VCF or transcript cDNA notations to HGVSp and UniProt accessions via the Ensembl VEP REST API.
*   **Generative AI Diagnostic Narrative**: Produce structured clinical narratives and candidate ACMG pathogenicity criteria using structured, type-safe schema outputs.

---

## ⚠️ HIPAA & Data Privacy Disclaimer

> [!IMPORTANT]
> **RESEARCH USE ONLY — NOT HIPAA COMPLIANT**
> This application is built for research and educational purposes. It is **not** certified for clinical diagnostic use, nor is it HIPAA-compliant.
> 
> * **No Protected Health Information (PHI)**: You must not enter, upload, or process any patient-identifiable data (e.g., patient names, MRNs, patient-linked DNA profiles).
> * **Third-Party API Disclosures**: Genomic variants, protein designations, and transcript parameters are transmitted to third-party endpoints to perform lookup operations, including **Google Gemini AI**, **NCBI ClinVar**, **EBI AlphaFold**, and **Ensembl VEP** APIs.
> * **Audit Trails**: Backend security audit logs only record public genomic notations (such as HGVS or UniProt accession IDs) and never ingest patient-identifying data.

---

## 🗂️ Rare Disease Presets & Fallback Dataset

The application pre-loads three canonical rare disease presets, complete with high-fidelity pre-analyzed fallback profiles for offline/sandbox environments:

1.  **PAH (p.Arg408Trp)** — *Phenylketonuria (PKU)*: Catalytic domain substitution that abolishes crucial inter-subunit salt bridges with Asp315 and Asp320, disrupting quaternary tetramerization and causing enzyme aggregation.
2.  **FGFR3 (p.Gly380Arg)** — *Achondroplasia*: Transmembrane domain mutation that stabilizes ligand-independent helix dimerization, leading to constitutive activation and severe growth plate inhibition (dwarfism).
3.  **GBA1 (p.Leu483Pro)** — *Gaucher Disease*: Ig-like domain mutation where Proline acts as a beta-sheet breaker, triggering structural folding collapse and ER-associated degradation.

---

## 🚀 Local Quickstart

### Prerequisites
*   **Node.js** (v20+ recommended)
*   **Google Gemini API Key**: Anyone with a Google account can obtain a free API key from [Google AI Studio](https://aistudio.google.com/).

### Installation & Execution
1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/Huthaifa-HajAhmad/Missense-Structural-Explorer.git
    cd Missense-Structural-Explorer
    ```
2.  **Install Dependencies**:
    ```bash
    npm install
    ```
3.  **Configure Environment**:
    Create a `.env` file in the root directory:
    ```env
    GEMINI_API_KEY=your_free_gemini_api_key_here
    APP_API_TOKEN=optional_secret_api_token
    ```
4.  **Run Development Server**:
    ```bash
    npm run dev
    ```
    Open `http://localhost:3000` to view the explorer.

---

## 🧪 Verification & Testing
The repository contains a robust Vitest test suite checking server-side input validation and regular expression safety:
*   **Run Unit Tests**:
    ```bash
    npm test
    ```
*   **Run TypeScript Linter**:
    ```bash
    npm run lint
    ```

---

## 🏗️ Production Deployment Architecture
For production environments, the platform is designed to run in a stateless containerized environment (e.g., **Google Cloud Run**):
*   **HTTPS/TLS Termination (SEC-5)**: Express binds to HTTP inside the container; HTTPS termination is offloaded to the GCP Ingress or HTTPS Load Balancer.
*   **Access Control**: Integrate with **Google Cloud Identity-Aware Proxy (IAP)** to enforce personal Single Sign-On (SSO) before users access the clinical portal.
*   **Caching & State**: Static structures and UniProt queries should be backed by a **Google Cloud Storage (GCS)** bucket or **Google Memorystore (Redis)** cache rather than in-memory arrays.

---

## 📂 Documentation Directory Index
For deep-dives into specific product features and designs, refer to the `/doc` index:
*   **[Product Requirements Document (PRD)](./doc/PRD.md)**: Goals, user personas, and target workflows.
*   **[Technical Architecture Design](./doc/ARCHITECTURE.md)**: Network topology, API gateway routes, and database proxy mechanics.
*   **[Interactive Feature Catalog](./doc/FEATURES.md)**: 3D presets, secondary structure color themes, and residue properties sourcing.
*   **[Technical Limitations & Constraints](./doc/LIMITATIONS.md)**: Biophysical modeling boundaries, EBI rate limits, and GPU sandboxing constraints.
*   **[Documentation Index](./doc/README.md)**: Detailed navigation directory.