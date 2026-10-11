<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# 🔬 MissenseResolve® (Rare Disease Genomics)

> A clinical-grade 3D macromolecular visualizer, biophysical mutant modeling gateway, and AI-driven variant pathfinder tailored for rare disease diagnostics.

---

## 🧬 Overview

**MissenseResolve®** is a full-stack bioinformatics application designed to assist clinical geneticists and rare disease researchers in evaluating the biophysical impact of single-amino acid substitutions. 

By unifying GPU-accelerated **3D structural visualization (Molstar)**, **deterministic database grounding (ClinVar & gnomAD)**, **Ensembl VEP notation translation**, and **generative AI reasoning (Gemini 2.5 Flash)**, the platform streamlines the evaluation of genetic variants from VCF genomic coordinates down to molecular atomic contacts.

### 🌟 Key Capabilities
*   **WebGL 3D Viewer (Molstar Engine)**: Rotate, zoom, and analyze 3D structures fetched directly from the EBI AlphaFold Database. Toggle polar contacts and hydrogen bonding networks on the fly.
*   **Biophysical Mutant Modeling**: Query real-time molecular modeling (integrated with FoldX mechanics) to generate minimized mutant coordinate structures and compute stability changes ($\Delta\Delta G$).
*   **Clinical Database Grounding**: Automatically search the NCBI ClinVar API to fetch curated significance classifications, review statuses, traits, and population allele frequencies (sourced from gnomAD).
*   **VEP Translation Gateway**: Translate genomic VCF or transcript cDNA notations to HGVSp and UniProt accessions via the Ensembl VEP REST API.
*   **Generative AI Diagnostic Narrative**: Produce structured clinical narratives and candidate ACMG pathogenicity criteria using structured, type-safe schema outputs.
*   **Interactive Guided Onboarding**: A 5-step interactive workspace tour orienting users across the 4 primary analysis zones, sovereign zero-key biophysical capabilities vs. key-enhanced features, and safe API credential setup. Launchable at any time from the header compass icon (`🧭`), the Command Palette (`Ctrl/⌘+K` → `"tour"`), or the Search empty state.

---

## ⚠️ HIPAA & Data Privacy Disclaimer

> [!IMPORTANT]
> **RESEARCH USE ONLY — NOT HIPAA COMPLIANT**
> This application is built for research and educational purposes. It is **not** certified for clinical diagnostic use, nor is it HIPAA-compliant.
> 
> * **No Protected Health Information (PHI)**: You must not enter, upload, or process any patient-identifiable data (e.g., patient names, MRNs, patient-linked DNA profiles).
> * **Third-Party API Disclosures**: Genomic variants, protein designations, and transcript parameters are transmitted to third-party endpoints to perform lookup operations, including **Google Gemini AI**, **NCBI ClinVar**, **EBI AlphaFold**, **Ensembl VEP**, **Tamarind Bio (ThermoMPNN)**, and **Genos.us** APIs.
* **Audit Trails**: Backend security audit logs only record public genomic notations (such as HGVS or UniProt accession IDs) and never ingest patient-identifying data.

---

## 🗂️ Dynamic Clinical Variant Querying

Rather than relying on static, hardcoded variants, the application dynamically processes, folds, and analyzes user-submitted genes and missense mutations on-the-fly. For testing and demonstration, canonical rare disease variants can be directly queried:

1. **PAH (p.Arg408Trp)** — *Phenylketonuria (PKU)*: Catalytic domain substitution that abolishes crucial inter-subunit salt bridges with Asp315 and Asp320, disrupting quaternary tetramerization and causing enzyme aggregation.
2. **FGFR3 (p.Gly380Arg)** — *Achondroplasia*: Transmembrane domain mutation that stabilizes ligand-independent helix dimerization, leading to constitutive activation and severe growth plate inhibition (dwarfism).
3. **GBA1 (p.Leu483Pro)** — *Gaucher Disease*: Ig-like domain mutation where Proline acts as a beta-sheet breaker, triggering structural folding collapse and ER-associated degradation.

---

## 🚀 Local Quickstart

### Prerequisites
*   **Node.js** (>=22.5.0 required, matches runtime engine)
*   **Google Gemini API Key**: Anyone with a Google account can obtain a free API key from [Google AI Studio](https://aistudio.google.com/).
*   **FoldX Local Setup (Required for Biophysical Modeling)**:
    1. Register and download FoldX 5 from the [FoldX Suite](https://foldxsuite.crg.eu/) (Academic/Non-commercial license is free).
    2. Place the downloaded Windows executable (e.g. `foldx_1_20270131.exe`) inside the `tools/foldx/` folder.
    3. Copy the `molecules/` folder and the `rotabase.txt` file from your FoldX distribution directly into the `tools/foldx/` directory.
    4. (Optional) Alternatively, you can define `FOLDX_BINARY` in your `.env` pointing to the absolute path of the executable.
*   **Python 3 & uv tool (Required for local VESM sidecar predictions)**:
    1. Ensure Python 3 (v3.10+) is installed.
    2. Install the **uv** command-line manager (highly optimized package runner) by running `pip install uv`.
    3. The application spawns the sidecar in the background using `python -m uv run tools/model_server.py`.

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
    APP_SESSION_SECRET=32_character_random_string_here
    BIOHUB_API_TOKEN=your_biohub_api_token_here
    APP_API_TOKEN=optional_secret_api_token
    ```
4.  **Run Development Server**:
    ```bash
    npm run dev
    ```
    Open `http://localhost:3000` to view the explorer.

---

## 🧪 Verification & Testing

**Run this before you push:**

```bash
npm run verify
```

`verify` is exactly the gate set CI runs, in one command — there is one definition of which gates exist, and CI executes the same npm scripts on a clean clone, on another OS, against the commit rather than your working tree. `scripts/check-verify-parity.ts` enforces that as part of `npm run lint`: it fails if a workflow gates on a script `verify` does not reach, so the two cannot drift apart silently.

| Gate | What it covers |
| --- | --- |
| `npm run lint` | architectural boundaries · focus indicators · verify-parity · `tsc --noEmit` |
| `npm run test:coverage` | the Vitest suite, with coverage thresholds enforced |
| `npm run verify:geometry` | the variant header and Functional Domains layout harnesses, rendered in headless Chromium |
| `npm run build` | client, server, workers and proto assets |

The geometry harnesses need a Chromium-based browser. They search the usual locations per platform and honour `GEOMETRY_BROWSER` / `CHROME_PATH` as an override, failing with that instruction rather than a stack trace. Everything they assert — `getBBox`, computed styles, `:focus-visible`, the rendered effect of a filter — is geometry `jsdom` cannot see, which is why a green `vitest` run says nothing about them.

**Inner loop, while working:**

```bash
npm test          # the suite alone
npm run lint      # static gates alone
```

**Image builds run one gate, not the gate set:** `npm run verify:image` — the type-check alone. A Docker build context is the tree with `.dockerignore` applied, and that file excludes `.github/`, so `npm run lint` cannot pass inside one: its third step (`scripts/check-verify-parity.ts`) reads `.github/workflows/` and fails closed without it. `deploy/Dockerfile.oci` gated on `npm run lint` and failed CD run 36330245416 four minutes into an ARM build, on a revision whose CI had already passed that exact check. The rule is enforced for every Dockerfile in the tree — including the script chain behind an alias, so `verify:image` cannot be redefined into the gate set.

**Deliberately not in `verify`:** `npm run audit`. It resolves against a live advisory database, so its verdict depends on when it runs rather than on the tree, and no code change can fix a newly-published advisory. It stays in CI, where the answer is recorded against the commit; it is allow-listed in `scripts/check-verify-parity.ts` with that reason. It runs with `--omit=dev`, which is the same dependency set the runtime image installs (`deploy/Dockerfile.oci` uses `npm ci --omit=dev`), so the gate matches what ships: on 2026-10-06 four criticals arrived through `@zvec/zvec-grep`'s optional `node-llama-cpp` (`simple-git` `<= 4.0.1`, unfixable upstream) and turned `quality` red on three unrelated PRs at once, `main` included, while the one real production critical (`proxy-addr`) was fixed in this tree. Dev-only advisories are still reported, just not fatal.

> Do not skip a CI gate because it passed locally. A local run attests to your working tree; CI attests to the commit — that everything needed was staged, that it builds from a clean `npm ci`, and that it passes on a platform you are not developing on. Deployment is gated on CI success (`cd.yml`), so bypassing it deploys unverified code.

---

## 🏗️ Production Deployment Architecture
For production environments, the platform runs on an **Oracle Cloud Infrastructure (OCI) Always Free Ampere A1 (ARM64)** instance:
*   **Compute**: 2 OCPUs (ARM64 Neoverse-N1) / 12 GB RAM on `VM.Standard.A1.Flex` — free tier.
*   **Ingress & TLS**: **Caddy** (`Caddyfile`, `deploy/docker-compose.oci.yml`) answers on ports 80 and 443 at `missense-resolve.duckdns.org` and obtains its certificate from Let's Encrypt. There is no Cloudflare in front of the site; the compose file's `tunnel` profile is optional and not used.
*   **Access Control**: the app's own **invite-only accounts**, switched on with `AUTH_MODE` (`legacy` → `hybrid` → `accounts`). Until `AUTH_MODE=accounts`, anyone with the address can run jobs. Owner runbook: [`doc/ACCOUNTS.md`](./doc/ACCOUNTS.md).
*   **Deploys**: a blue/green handover that lets running jobs finish ([`deploy/ROLLOUT.md`](./deploy/ROLLOUT.md)). Apply an edited `deploy/.env.oci` with `python3 deploy/rollout.py --restart --commit "$(git rev-parse HEAD)"`, never `docker compose up` on the live app.
*   **Data Persistence**: SQLite databases (analyses and accounts) are stored on persistent NVMe block storage with daily automated backups (`deploy/backup-sqlite.sh`) and optional offsite sync to Cloudflare R2.
*   **Host provisioning guide**: `doc/DEPLOYMENT_OCI.md` is kept out of the repository on purpose (it describes the infrastructure); the owner holds it, and CD preserves the copy on the host.

---

## 📂 Documentation Directory Index
For deep-dives into specific product features and designs, refer to the `/doc` index:
*   **[Product Requirements Document (PRD)](./doc/PRD.md)**: Goals, user personas, and target workflows.
*   **[Technical Architecture Design](./doc/ARCHITECTURE.md)**: Network topology, API gateway routes, and database proxy mechanics.
*   **[Interactive Feature Catalog](./doc/FEATURES.md)**: 3D presets, secondary structure color themes, and residue properties sourcing.
*   **[Technical Limitations & Constraints](./doc/LIMITATIONS.md)**: Biophysical modeling boundaries, EBI rate limits, and GPU sandboxing constraints.
*   **[Future Work & Enhancements Roadmap](./doc/FUTURE_WORK.md)**: Alternative machine learning models, visualization upgrades, and technical roadmap items.
*   **[Documentation Index](./doc/README.md)**: Detailed navigation directory.